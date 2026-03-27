"""
MediScan OCR — Prescription Text Filter (v3)
==============================================
Two-phase filtering for noisy handwritten prescriptions:

  Phase 1 — POSITIONAL ONLY (before cleaning):
    Keep text in the 25%–85% vertical band of the image.
    Removes header (hospital/doctor) and footer (signatures/stamps).
    NO keyword check here — maximize recall first.

  Phase 2 — KEYWORD FILTERING (after cleaning):
    Applied AFTER OCR error correction and line grouping.
    Keep only lines containing medicine-related keywords or patterns.

Philosophy: recall first → clean → then precision.
"""

import re
import logging
from dataclasses import dataclass, field
from typing import List

logger = logging.getLogger("mediscan.filter")


# ═══════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════

# Positional filter: keep text between these fractions of image height
HEADER_CUTOFF = 0.25   # Ignore top 25% (hospital name, doctor info)
FOOTER_CUTOFF = 0.85   # Ignore bottom 15% (signatures, stamps, footer)

# Medicine-related keywords for Phase 2 (case-insensitive)
MEDICINE_KEYWORDS = {
    # Drug form prefixes
    "tab", "tablet", "cap", "capsule", "syr", "syrup",
    "inj", "injection", "cream", "oint", "ointment",
    "drop", "drops", "susp", "suspension", "gel", "lotion",
    "spray", "inhaler", "patch", "suppository",

    # Dosage units
    "mg", "ml", "mcg", "iu", "gm",

    # Frequency terms
    "od", "bd", "bid", "tds", "tid", "qid", "prn", "sos",
    "hs", "stat", "ac", "pc",
    "daily", "twice", "thrice",

    # Route of administration
    "oral", "topical", "iv", "im", "sc",

    # Common prescription terms
    "dose", "dosage",
}

# Dosage pattern: matches "500mg", "250 mg", "10ml", "0.5g", "5%"
DOSAGE_REGEX = re.compile(
    r'\b\d+(?:\.\d+)?\s*(?:mg|ml|mcg|g|iu|%|units?)\b',
    re.IGNORECASE
)

# Frequency pattern: matches "1-0-1", "1+0+1", "0-1-0"
FREQ_NUMERIC_REGEX = re.compile(r'\b\d[\-\+]\d[\-\+]\d\b')


# ═══════════════════════════════════════════════════════════════════
# Data Models
# ═══════════════════════════════════════════════════════════════════

@dataclass
class OCRDetection:
    """
    A single text detection from EasyOCR with bounding box.

    Attributes:
        text: Detected text string
        confidence: OCR confidence score (0.0 - 1.0)
        bbox: Bounding box as [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
        y_center: Vertical center of the bounding box (computed)
    """
    text: str
    confidence: float
    bbox: list = field(default_factory=list)
    y_center: float = 0.0

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "confidence": round(self.confidence, 4),
            "bbox": self.bbox,
        }


@dataclass
class FilterResult:
    """Result of the filtering pipeline."""
    filtered_detections: List[OCRDetection]
    removed_detections: List[OCRDetection]
    filtered_text: str          # Joined text from filtered detections
    raw_text: str               # Joined text from ALL detections
    total_detections: int       # Total before filtering
    kept_count: int             # Kept after filtering
    removed_count: int          # Removed by filtering
    image_height: int           # Image height used for spatial calc


# ═══════════════════════════════════════════════════════════════════
# Spatial Helpers
# ═══════════════════════════════════════════════════════════════════

def compute_y_center(bbox: list) -> float:
    """
    Compute the vertical center of a bounding box.
    bbox format: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
    """
    if not bbox or len(bbox) < 4:
        return 0.0
    y_values = [point[1] for point in bbox]
    return sum(y_values) / len(y_values)


# ═══════════════════════════════════════════════════════════════════
# Phase 1: Positional Filter (BEFORE cleaning)
# ═══════════════════════════════════════════════════════════════════

def positional_filter(
    detections: List[OCRDetection],
    image_height: int,
    header_cutoff: float = HEADER_CUTOFF,
    footer_cutoff: float = FOOTER_CUTOFF,
) -> FilterResult:
    """
    Keep only detections in the body region of the prescription
    (between header_cutoff and footer_cutoff of image height).

    NO keyword filtering here — this is a recall-maximizing first pass.
    Removes:
      - Top 25%: hospital name, doctor info, address, logo
      - Bottom 15%: signatures, stamps, disclaimers

    Args:
        detections: Raw OCR detections with bounding boxes
        image_height: Height of the source image in pixels
        header_cutoff: Top fraction to skip (default: 0.25)
        footer_cutoff: Bottom fraction to keep up to (default: 0.85)

    Returns:
        FilterResult with positionally-filtered detections
    """
    if not detections:
        logger.warning("No detections to filter")
        return FilterResult(
            filtered_detections=[], removed_detections=[],
            filtered_text="", raw_text="",
            total_detections=0, kept_count=0, removed_count=0,
            image_height=image_height,
        )

    # Compute y_center for each detection
    for det in detections:
        det.y_center = compute_y_center(det.bbox)

    top_y = image_height * header_cutoff
    bottom_y = image_height * footer_cutoff

    filtered = []
    removed = []

    logger.info(
        f"Positional filter: {len(detections)} detections, "
        f"keep y=[{top_y:.0f}, {bottom_y:.0f}] "
        f"(image_height={image_height}px)"
    )

    for det in detections:
        if top_y <= det.y_center <= bottom_y:
            filtered.append(det)
            logger.debug(f"  ✅ KEEP: '{det.text}' (y={det.y_center:.0f})")
        else:
            removed.append(det)
            region = "header" if det.y_center < top_y else "footer"
            logger.debug(f"  ❌ SKIP: '{det.text}' (y={det.y_center:.0f}, {region})")

    raw_text = " ".join(d.text for d in detections)
    filtered_text = " ".join(d.text for d in filtered)

    result = FilterResult(
        filtered_detections=filtered,
        removed_detections=removed,
        filtered_text=filtered_text,
        raw_text=raw_text,
        total_detections=len(detections),
        kept_count=len(filtered),
        removed_count=len(removed),
        image_height=image_height,
    )

    logger.info(
        f"Positional result: {result.kept_count}/{result.total_detections} kept, "
        f"{result.removed_count} removed (header+footer)"
    )
    return result


# ═══════════════════════════════════════════════════════════════════
# Phase 2: Keyword Filter (AFTER cleaning and line grouping)
# ═══════════════════════════════════════════════════════════════════

def keyword_filter_lines(lines: list) -> list:
    """
    Filter grouped text lines by medicine-related keywords.
    Applied AFTER OCR error correction and line grouping.

    A line is kept if ANY of these conditions are true:
      1. Contains a medicine keyword (tab, cap, syrup, mg, bd, etc.)
      2. Contains a dosage pattern (500mg, 10ml, 0.5g, etc.)
      3. Contains a numeric frequency pattern (1-0-1, 0-1-0, etc.)

    Args:
        lines: List of TextLine objects (from cleaner.group_into_lines)

    Returns:
        List of TextLine objects that passed keyword filtering
    """
    kept = []
    removed_count = 0

    for line in lines:
        if _passes_keyword_check(line.text):
            kept.append(line)
            logger.debug(f"  ✅ LINE KEEP: '{line.text}'")
        else:
            removed_count += 1
            logger.debug(f"  ❌ LINE SKIP: '{line.text}' (no med keyword)")

    logger.info(
        f"Keyword filter: {len(kept)}/{len(lines)} lines kept, "
        f"{removed_count} removed"
    )
    return kept


def _passes_keyword_check(text: str) -> bool:
    """Check if text contains medicine-related content."""
    text_lower = text.lower()

    # Check 1: Medicine keywords
    words = set(re.findall(r'[a-z]+', text_lower))
    if words & MEDICINE_KEYWORDS:
        return True

    # Check 2: Dosage pattern (e.g., "500mg", "250 mg")
    if DOSAGE_REGEX.search(text):
        return True

    # Check 3: Numeric frequency (e.g., "1-0-1")
    if FREQ_NUMERIC_REGEX.search(text):
        return True

    return False


# ═══════════════════════════════════════════════════════════════════
# Legacy Combined Filter (backward compatibility)
# ═══════════════════════════════════════════════════════════════════

def filter_ocr_results(
    detections: List[OCRDetection],
    image_height: int,
    spatial_cutoff: float = HEADER_CUTOFF
) -> FilterResult:
    """
    Legacy combined filter — kept for backward compatibility.
    New pipeline should use positional_filter() + keyword_filter_lines() separately.
    """
    return positional_filter(
        detections, image_height,
        header_cutoff=spatial_cutoff,
        footer_cutoff=FOOTER_CUTOFF,
    )
