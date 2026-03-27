"""
MediScan OCR — Text Cleaning & Line Grouping Module
=====================================================
Handles noisy OCR output from handwritten prescriptions:

  1. Character-level OCR error correction (e.g., '|' → '1', 'L' → '1')
  2. Frequency normalization (e.g., 'Bid' → 'BID', 'b.d' → 'BD')
  3. Common drug form correction (e.g., 't4L' → 'tab', 'C4p' → 'cap')
  4. Bounding box line grouping — merge nearby detections into full lines
  5. Whitespace and junk character cleanup

Philosophy: maximize recall first — keep as much text as possible,
then improve precision via cleaning and downstream parsing.
"""

import re
import logging
from typing import List
from dataclasses import dataclass, field

logger = logging.getLogger("mediscan.cleaner")


# ═══════════════════════════════════════════════════════════════════
# Character-Level OCR Error Corrections
# ═══════════════════════════════════════════════════════════════════

# Single-character substitutions commonly seen in handwritten OCR
CHAR_REPLACEMENTS = {
    "|": "1",       # pipe misread as 1
    "!": "1",       # exclamation misread as 1
    "l": "1",       # lowercase L misread as 1 (context-dependent, applied carefully)
    "O": "0",       # capital O misread as zero (context-dependent)
    "o": "0",       # lowercase o misread as zero (context-dependent)
    "S": "5",       # S misread as 5 (context-dependent)
    "Z": "2",       # Z misread as 2 (context-dependent)
    "B": "8",       # B misread as 8 (context-dependent)
}

# Full-word / substring substitutions for common OCR garble
# format: (regex_pattern, replacement, description)
WORD_CORRECTIONS = [
    # Drug form prefix corrections
    (r'\bt[4a][bBLl]\b', 'Tab', 'tab misread'),
    (r'\bt[ae]b(?:let)?\.?\s', 'Tab ', 'tablet prefix'),
    (r'\bT[4a][bBLl]\b', 'Tab', 'Tab misread'),
    (r'\bc[4a][pP]\b', 'Cap', 'cap misread'),
    (r'\bC[4a][pP]\b', 'Cap', 'Cap misread'),
    (r'\bcap(?:sule)?\.?\s', 'Cap ', 'capsule prefix'),
    (r'\bsyr(?:up)?\.?\s', 'Syr ', 'syrup prefix'),
    (r'\b[iI]nj\.?\s', 'Inj ', 'injection prefix'),

    # Dosage unit corrections
    (r'(\d+)\s*[mM][gG9]', r'\1mg', 'mg unit'),
    (r'(\d+)\s*[mM][lLI|]', r'\1ml', 'ml unit'),
    (r'(\d+)\s*[mM][cC][gG9]', r'\1mcg', 'mcg unit'),

    # Common digit-in-word garble near numbers
    (r'\b(\d+)\s*rng\b', r'\1mg', 'mg typo'),
    (r'\b(\d+)\s*m9\b', r'\1mg', 'mg typo'),
    (r'\b(\d+)\s*rrg\b', r'\1mg', 'mg typo'),
]

# Frequency term corrections (case-variations and common garble)
FREQ_CORRECTIONS = {
    # Lowercase/mixed → standard uppercase
    "bid": "BID", "Bid": "BID", "b.i.d": "BID", "b.i.d.": "BID",
    "bd": "BD",   "Bd": "BD",   "b.d": "BD",    "b.d.": "BD",
    "od": "OD",   "Od": "OD",   "o.d": "OD",    "o.d.": "OD",
    "tds": "TDS", "Tds": "TDS", "t.d.s": "TDS", "t.d.s.": "TDS",
    "tid": "TID", "Tid": "TID", "t.i.d": "TID", "t.i.d.": "TID",
    "qid": "QID", "Qid": "QID", "q.i.d": "QID", "q.i.d.": "QID",
    "qd": "QD",   "Qd": "QD",
    "prn": "PRN", "Prn": "PRN", "p.r.n": "PRN",
    "sos": "SOS", "Sos": "SOS",
    "hs": "HS",   "Hs": "HS",   "h.s": "HS",
    "ac": "AC",   "Ac": "AC",   "a.c": "AC",
    "pc": "PC",   "Pc": "PC",   "p.c": "PC",
    "stat": "STAT", "Stat": "STAT",
}


# ═══════════════════════════════════════════════════════════════════
# Cleaning Functions
# ═══════════════════════════════════════════════════════════════════

def clean_text(text: str) -> str:
    """
    Apply all text cleaning steps to a single OCR text segment.

    Pipeline:
        1. Strip whitespace and junk characters
        2. Apply word-level regex corrections (drug forms, units)
        3. Normalize frequency abbreviations
        4. Fix digit/letter confusion in numeric contexts
        5. Remove stray special characters

    Args:
        text: Raw OCR text (possibly garbled)

    Returns:
        Cleaned text string
    """
    if not text:
        return text

    original = text

    # Step 1: Basic whitespace cleanup
    text = text.strip()
    text = re.sub(r'\s+', ' ', text)  # Collapse multiple spaces

    # Step 2: Remove stray special characters but keep medically relevant ones
    # Keep: letters, digits, spaces, periods, hyphens, plus, percent, slash
    text = re.sub(r'[^\w\s.\-+%/]', '', text)

    # Step 3: Apply word-level regex corrections
    for pattern, replacement, desc in WORD_CORRECTIONS:
        new_text = re.sub(pattern, replacement, text)
        if new_text != text:
            logger.debug(f"  Correction ({desc}): '{text}' → '{new_text}'")
            text = new_text

    # Step 4: Normalize frequency terms
    text = _normalize_freq_terms(text)

    # Step 5: Fix digit/letter confusion in numeric contexts
    text = _fix_numeric_context(text)

    if text != original:
        logger.debug(f"Cleaned: '{original}' → '{text}'")

    return text


def _normalize_freq_terms(text: str) -> str:
    """
    Normalize frequency abbreviations within text.
    Replaces variations like 'Bid', 'b.d', 'b.i.d.' with standard forms.
    """
    words = text.split()
    normalized = []

    for word in words:
        # Check exact match in corrections map
        clean_word = word.strip('.,;:')
        if clean_word in FREQ_CORRECTIONS:
            normalized.append(FREQ_CORRECTIONS[clean_word])
        else:
            normalized.append(word)

    return ' '.join(normalized)


def _fix_numeric_context(text: str) -> str:
    """
    Fix character misreads that only apply in numeric contexts.
    E.g., '|' and 'l' should become '1' only when adjacent to digits.
    """
    # Fix pipe/L as 1 in frequency patterns like "|−0−|" → "1-0-1"
    text = re.sub(r'[|lI](\s*[\-\+]\s*\d\s*[\-\+]\s*)[|lI1]', r'1\g<1>1', text)
    text = re.sub(r'(\d\s*[\-\+]\s*\d\s*[\-\+]\s*)[|lI]', r'\g<1>1', text)
    text = re.sub(r'[|lI](\s*[\-\+]\s*\d\s*[\-\+]\s*\d)', r'1\g<1>', text)

    # Fix O/o as 0 in frequency patterns like "1-O-1" → "1-0-1"
    text = re.sub(r'(\d\s*[\-\+]\s*)[oO](\s*[\-\+]\s*\d)', r'\g<1>0\2', text)

    # Fix pipe/L as 1 before dosage units: "|00mg" → "100mg", "5O0mg" → "500mg"
    text = re.sub(r'[|lI](\d{1,2}\s*(?:mg|ml|mcg))', r'1\1', text, flags=re.IGNORECASE)
    text = re.sub(r'(\d)[oO](\d\s*(?:mg|ml|mcg))', r'\g<1>0\2', text, flags=re.IGNORECASE)

    return text


def clean_detections(detections: list) -> list:
    """
    Apply text cleaning to a list of OCR detections (in-place).

    Args:
        detections: List of OCRDetection objects

    Returns:
        Same list with cleaned text fields
    """
    cleaned_count = 0
    for det in detections:
        original = det.text
        det.text = clean_text(det.text)
        if det.text != original:
            cleaned_count += 1

    logger.info(f"Cleaned {cleaned_count}/{len(detections)} detections")
    return detections


# ═══════════════════════════════════════════════════════════════════
# Bounding Box Line Grouping
# ═══════════════════════════════════════════════════════════════════

@dataclass
class TextLine:
    """A grouped line of text composed of nearby OCR detections."""
    text: str
    detections: list = field(default_factory=list)
    y_center: float = 0.0
    avg_confidence: float = 0.0

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "confidence": round(self.avg_confidence, 4),
        }


def group_into_lines(detections: list, line_threshold_ratio: float = 0.025) -> List[TextLine]:
    """
    Group nearby OCR detections into full text lines based on vertical
    proximity of their bounding boxes.

    Handwritten prescriptions often produce fragmented detections:
      ["Tab", "Para", "cetamol", "500", "mg", "BD"]
    This function groups them into logical lines:
      ["Tab Paracetamol 500mg BD"]

    Algorithm:
        1. Compute y_center for each detection
        2. Sort by y_center (top → bottom)
        3. Group detections whose y_centers are within threshold
        4. Within each group, sort left-to-right by x position
        5. Join text within each group

    Args:
        detections: List of OCRDetection objects with bounding boxes
        line_threshold_ratio: Max y-distance (as fraction of image height)
                              to consider two detections on the same line.
                              Default: 0.025 (2.5% of image height)

    Returns:
        List of TextLine objects ordered top-to-bottom
    """
    if not detections:
        return []

    # Compute y_center for each detection if not already done
    for det in detections:
        if det.y_center == 0.0 and det.bbox:
            y_vals = [p[1] for p in det.bbox]
            det.y_center = sum(y_vals) / len(y_vals)

    # Estimate image height from max y coordinate
    all_y = []
    for det in detections:
        for point in det.bbox:
            all_y.append(point[1])
    max_y = max(all_y) if all_y else 1
    line_threshold = max_y * line_threshold_ratio

    # Sort detections by y_center (top to bottom)
    sorted_dets = sorted(detections, key=lambda d: d.y_center)

    # Group into lines
    lines = []
    current_group = [sorted_dets[0]]
    current_y = sorted_dets[0].y_center

    for det in sorted_dets[1:]:
        if abs(det.y_center - current_y) <= line_threshold:
            # Same line — add to current group
            current_group.append(det)
        else:
            # New line — finalize current group and start new
            lines.append(_build_text_line(current_group))
            current_group = [det]
            current_y = det.y_center

    # Don't forget the last group
    if current_group:
        lines.append(_build_text_line(current_group))

    logger.info(
        f"Grouped {len(detections)} detections into {len(lines)} lines"
    )

    return lines


def _build_text_line(group: list) -> TextLine:
    """
    Build a TextLine from a group of detections on the same line.
    Sorts detections left-to-right by x position and joins text.
    """
    # Sort left-to-right by the x-coordinate of the first bbox point
    group.sort(key=lambda d: d.bbox[0][0] if d.bbox else 0)

    text = " ".join(d.text for d in group)
    y_center = sum(d.y_center for d in group) / len(group)
    avg_conf = sum(d.confidence for d in group) / len(group)

    return TextLine(
        text=text.strip(),
        detections=group,
        y_center=y_center,
        avg_confidence=avg_conf,
    )
