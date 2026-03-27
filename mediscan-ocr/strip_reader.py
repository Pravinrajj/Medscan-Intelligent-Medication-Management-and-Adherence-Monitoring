"""
MediScan OCR — Tablet Strip Medicine Name Extractor
=====================================================
Extracts the medicine/brand name from tablet strip (blister pack) images
using OCR + rule-based scoring and filtering.

Strategy:
    1. Run EasyOCR on the strip image
    2. Remove noise (dosage, batch info, manufacturer details)
    3. Score each remaining text candidate:
       - Length score (prefer >8 characters)
       - Case score (prefer UPPERCASE — brand names are usually uppercase)
       - Position score (prefer upper-middle region, 20%-60% of image height)
       - Confidence score (OCR confidence)
    4. Rank candidates and pick the highest scorer
    5. Post-process: remove suffix words (Tablets, Capsules, etc.), normalize

No heavy ML models — purely OCR + rules.
"""

import re
import logging
from dataclasses import dataclass
from typing import List, Optional, Tuple

logger = logging.getLogger("mediscan.strip_reader")


# ═══════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════

# Noise keywords — text containing any of these is filtered out
NOISE_KEYWORDS = {
    "mg", "ml", "mcg", "gm", "iu",
    "batch", "b.no", "b.n", "lot",
    "mfg", "mfd", "manufactured", "manufacturer",
    "exp", "expiry", "expd", "use before",
    "date", "d.o.m",
    "store", "stored", "storage", "protect",
    "warning", "caution", "keep",
    "composition", "each", "contains",
    "dosage", "dose", "indications",
    "schedule", "sch", "rx", "prescription",
    "approved", "drug", "licence", "license",
    "price", "mrp", "incl", "gst", "rs", "inr",
    "for oral use", "for external use",
    "not for", "children", "away from",
    "marketed", "distributed",
    "ip", "bp", "usp",  # pharmacopoeia abbreviations
}

# Suffix words to strip from the final medicine name
SUFFIX_WORDS = {
    "tablets", "tablet", "tab",
    "capsules", "capsule", "cap",
    "syrup", "syr", "suspension",
    "injection", "inj",
    "cream", "ointment", "gel", "lotion",
    "drops", "drop", "spray",
    "forte", "plus", "sr", "xr", "cr", "er", "ds",
    "oral",
}

# Position scoring: ideal vertical region (fraction of image height)
IDEAL_Y_TOP = 0.20     # 20% from top
IDEAL_Y_BOTTOM = 0.60  # 60% from top


# ═══════════════════════════════════════════════════════════════════
# Data Models
# ═══════════════════════════════════════════════════════════════════

@dataclass
class StripCandidate:
    """A candidate text detected from a tablet strip image."""
    text: str
    confidence: float
    bbox: list
    y_center: float
    score: float = 0.0
    score_breakdown: dict = None

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "confidence": round(self.confidence, 4),
            "score": round(self.score, 4),
            "score_breakdown": self.score_breakdown,
        }


@dataclass
class StripResult:
    """Result of tablet strip medicine name extraction."""
    medicine_name: Optional[str]
    confidence: float
    all_candidates: List[StripCandidate]
    raw_text: str

    def to_dict(self) -> dict:
        result = {
            "medicine_name": self.medicine_name,
            "confidence": round(self.confidence, 4),
        }
        return result


# ═══════════════════════════════════════════════════════════════════
# Noise Filtering
# ═══════════════════════════════════════════════════════════════════

def is_noise(text: str) -> bool:
    """
    Check if text is noise (dosage info, batch details, etc.)
    that should be excluded from medicine name candidates.

    Returns True if text contains any noise keyword.
    """
    text_lower = text.lower()

    # Check for noise keywords
    for keyword in NOISE_KEYWORDS:
        if keyword in text_lower:
            return True

    # Pure numbers or very short text (< 3 chars) → noise
    stripped = re.sub(r'[^a-zA-Z]', '', text)
    if len(stripped) < 3:
        return True

    # Dates (dd/mm/yyyy, mm-yyyy, etc.)
    if re.search(r'\b\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}\b', text):
        return True
    if re.search(r'\b\d{1,2}[/\-\.]\d{2,4}\b', text):
        return True

    # Pure numeric strings (batch numbers, prices)
    if re.match(r'^[\d\s\.\-/,]+$', text):
        return True

    return False


# ═══════════════════════════════════════════════════════════════════
# Scoring System
# ═══════════════════════════════════════════════════════════════════

def score_candidate(candidate: StripCandidate, image_height: int) -> float:
    """
    Score a text candidate for likelihood of being the medicine name.

    Scoring factors (weighted sum):
        1. Length score      (0-1, weight=0.25) — prefer longer text (>8 chars)
        2. Uppercase score   (0-1, weight=0.30) — prefer UPPERCASE (brand names)
        3. Position score    (0-1, weight=0.25) — prefer upper-middle region
        4. Confidence score  (0-1, weight=0.20) — OCR confidence

    Args:
        candidate: Text candidate with bbox and confidence
        image_height: Image height in pixels for position scoring

    Returns:
        Combined weighted score (0.0 to 1.0)
    """
    text = candidate.text

    # ── Length Score ─────────────────────────────────────────────
    # Ideal: 8+ characters. Linear ramp from 3 to 8.
    alpha_len = len(re.sub(r'[^a-zA-Z]', '', text))
    if alpha_len >= 8:
        length_score = 1.0
    elif alpha_len >= 3:
        length_score = (alpha_len - 3) / 5.0
    else:
        length_score = 0.0

    # ── Uppercase Score ─────────────────────────────────────────
    # Medicine brand names on strips are usually UPPERCASE
    alpha_chars = re.findall(r'[a-zA-Z]', text)
    if alpha_chars:
        upper_count = sum(1 for c in alpha_chars if c.isupper())
        uppercase_score = upper_count / len(alpha_chars)
    else:
        uppercase_score = 0.0

    # ── Position Score ──────────────────────────────────────────
    # Ideal: 20%-60% of image height (upper-middle region)
    if image_height > 0:
        y_frac = candidate.y_center / image_height
        if IDEAL_Y_TOP <= y_frac <= IDEAL_Y_BOTTOM:
            position_score = 1.0
        elif y_frac < IDEAL_Y_TOP:
            position_score = max(0.0, y_frac / IDEAL_Y_TOP)
        else:
            # Linearly decrease from IDEAL_Y_BOTTOM to 1.0
            position_score = max(0.0, 1.0 - (y_frac - IDEAL_Y_BOTTOM) / (1.0 - IDEAL_Y_BOTTOM))
    else:
        position_score = 0.5

    # ── Confidence Score ────────────────────────────────────────
    confidence_score = min(1.0, candidate.confidence)

    # ── Weighted combination ────────────────────────────────────
    weights = {
        "length": 0.25,
        "uppercase": 0.30,
        "position": 0.25,
        "confidence": 0.20,
    }

    total = (
        weights["length"] * length_score +
        weights["uppercase"] * uppercase_score +
        weights["position"] * position_score +
        weights["confidence"] * confidence_score
    )

    candidate.score = total
    candidate.score_breakdown = {
        "length": round(length_score, 3),
        "uppercase": round(uppercase_score, 3),
        "position": round(position_score, 3),
        "confidence": round(confidence_score, 3),
        "total": round(total, 3),
    }

    return total


# ═══════════════════════════════════════════════════════════════════
# Post-Processing
# ═══════════════════════════════════════════════════════════════════

def post_process_name(text: str) -> str:
    """
    Clean up the extracted medicine name:
      1. Remove suffix words (Tablets, Capsules, etc.)
      2. Remove stray non-alphabetic characters
      3. Normalize spacing and capitalize properly

    Args:
        text: Raw candidate text

    Returns:
        Cleaned medicine name
    """
    if not text:
        return text

    # Remove suffix words
    words = text.split()
    filtered_words = []
    for word in words:
        if word.lower().strip('.,;:') not in SUFFIX_WORDS:
            filtered_words.append(word)

    name = ' '.join(filtered_words).strip()

    # Remove stray special characters from edges
    name = re.sub(r'^[\s\-_.,;:]+|[\s\-_.,;:]+$', '', name)

    # Remove isolated single characters (OCR artifacts)
    name = re.sub(r'\b[^aAiI]\b', '', name)
    name = re.sub(r'\s+', ' ', name).strip()

    # Capitalize: if mostly uppercase, keep it; otherwise title case
    alpha_chars = re.findall(r'[a-zA-Z]', name)
    if alpha_chars:
        upper_ratio = sum(1 for c in alpha_chars if c.isupper()) / len(alpha_chars)
        if upper_ratio >= 0.6:
            name = name.upper()
        else:
            name = name.title()

    return name


# ═══════════════════════════════════════════════════════════════════
# Main Extraction Pipeline
# ═══════════════════════════════════════════════════════════════════

def extract_medicine_name(detections: list, image_height: int) -> StripResult:
    """
    Extract the medicine name from tablet strip OCR detections.

    Pipeline:
        1. Build candidates from OCR detections
        2. Filter noise (dosage, batch, manufacturer, etc.)
        3. Score candidates (length, case, position, confidence)
        4. Rank and select top candidate
        5. Post-process the name

    Args:
        detections: List of OCRDetection objects from EasyOCR
        image_height: Height of the source image in pixels

    Returns:
        StripResult with extracted medicine name and confidence
    """
    if not detections:
        logger.warning("No detections to process for strip reading")
        return StripResult(
            medicine_name=None, confidence=0.0,
            all_candidates=[], raw_text=""
        )

    raw_text = " ".join(d.text for d in detections)

    # ── Step 1: Build candidates ──────────────────────────────
    candidates = []
    for det in detections:
        # Compute y_center
        y_center = 0.0
        if det.bbox and len(det.bbox) >= 4:
            y_vals = [p[1] for p in det.bbox]
            y_center = sum(y_vals) / len(y_vals)

        candidates.append(StripCandidate(
            text=det.text.strip(),
            confidence=det.confidence,
            bbox=det.bbox,
            y_center=y_center,
        ))

    logger.info(f"Strip reader: {len(candidates)} raw candidates from OCR")

    # ── Step 2: Filter noise ──────────────────────────────────
    filtered = []
    for c in candidates:
        if is_noise(c.text):
            logger.debug(f"  Noise filtered: '{c.text}'")
        else:
            filtered.append(c)

    logger.info(
        f"After noise filter: {len(filtered)}/{len(candidates)} candidates remain"
    )

    if not filtered:
        logger.warning("All candidates filtered as noise")
        return StripResult(
            medicine_name=None, confidence=0.0,
            all_candidates=candidates, raw_text=raw_text
        )

    # ── Step 3: Score candidates ──────────────────────────────
    for c in filtered:
        score_candidate(c, image_height)

    # ── Step 4: Rank by score (descending) ────────────────────
    filtered.sort(key=lambda c: c.score, reverse=True)

    for i, c in enumerate(filtered[:5]):
        logger.info(
            f"  Rank {i+1}: '{c.text}' "
            f"(score={c.score:.3f}, "
            f"len={c.score_breakdown['length']:.2f}, "
            f"upper={c.score_breakdown['uppercase']:.2f}, "
            f"pos={c.score_breakdown['position']:.2f}, "
            f"conf={c.score_breakdown['confidence']:.2f})"
        )

    # ── Step 5: Select top and post-process ───────────────────
    best = filtered[0]
    medicine_name = post_process_name(best.text)
    confidence = best.confidence

    logger.info(f"Selected: '{best.text}' → '{medicine_name}' (conf={confidence:.3f})")

    return StripResult(
        medicine_name=medicine_name,
        confidence=confidence,
        all_candidates=filtered,
        raw_text=raw_text,
    )
