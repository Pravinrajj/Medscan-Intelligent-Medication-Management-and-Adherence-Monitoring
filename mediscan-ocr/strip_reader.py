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
from medicine_db import lookup_medicine

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
    "approved", "drug", "pharma", "pharmaceutical",
    "pharmaceuticals", "ltd", "limited", "pvt",
    "private", "industries", "company", "division",
    "licence", "license", "search", "inside", "image", "amazon", "visit",
    "fashion", "stock", "share", "save",
    "pack", "blister",
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
    brand_name: Optional[str]
    composition: List[str]
    confidence: float
    all_candidates: List[StripCandidate]
    raw_text: str

    def to_dict(self) -> dict:
        return {
            "brand_name": self.brand_name,
            "composition": self.composition,
            "confidence": round(self.confidence, 4),
        }


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

    # ❌ Reject web / UI garbage
    if any(x in text_lower for x in [
        "google", "amazon", "search", "visit", "www", "http"
    ]):
        return True

    # ❌ Reject storage / instructions
    if any(x in text_lower for x in [
        "store", "cool", "dry", "place", "keep", "away"
    ]):
        return True

    # Check for noise keywords
    for keyword in NOISE_KEYWORDS:
        if keyword in text_lower:
            return True

    # Pure numbers or very short text (< 3 chars) → noise
    stripped = re.sub(r'[^a-zA-Z]', '', text)
    if len(stripped) < 3:
        return True
    
    # ❌ Reject non-medical phrases (VERY IMPORTANT)
    words = text.split()

    if len(words) >= 2:
        medical_keywords = [
            "paracetamol", "tablet", "capsule", "mg",
            "caffeine", "ip", "usp"
        ]

        if not any(m in text_lower for m in medical_keywords):
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
    word_count = len(text.split())

    # Medicine names are usually short (1–3 words)
    if word_count == 1:
        length_score = 0.4   # penalize single words
    elif word_count <= 3:
        length_score = 1.0   # ideal brand length
    elif word_count <= 6:
        length_score = 0.6
    else:
        length_score = 0.2

    # ── Uppercase Score ─────────────────────────────────────────
    # Medicine brand names on strips are usually UPPERCASE
    alpha_chars = re.findall(r'[a-zA-Z]', text)
    if alpha_chars:
        upper_count = sum(1 for c in alpha_chars if c.isupper())
        uppercase_ratio = upper_count / len(alpha_chars)

    # Penalize full uppercase (manufacturer text)
        if uppercase_ratio > 0.8:
            uppercase_score = 0.3
        elif uppercase_ratio > 0.5:
            uppercase_score = 0.6
        else:
            uppercase_score = 1.0
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
    "length": 0.35,
    "uppercase": 0.15,
    "position": 0.25,
    "confidence": 0.25,
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
        # ✅ Step 1: Compute y_center FIRST
        y_center = 0.0
        if det.bbox and len(det.bbox) >= 4:
            y_vals = [p[1] for p in det.bbox]
            y_center = sum(y_vals) / len(y_vals)

        det_text = det.text.strip()
        if not det_text:
            continue

        # ✅ Step 2: Split composition text safely
        parts = re.split(r',| and ', det_text)

        for part in parts:
            part = part.strip()

            if len(part) < 3:
                continue

            # ✅ NEW: split further into individual words
            # Keep full phrase instead of breaking into words
            clean_part = part.strip()

            if len(clean_part) < 4:
                continue

            candidates.append(StripCandidate(
                text=clean_part,
                confidence=det.confidence,
                bbox=det.bbox,
                y_center=y_center,
            ))

    logger.info(f"Strip reader: {len(candidates)} raw candidates from OCR")

    # ── Step 2: Filter noise ──────────────────────────────────
    filtered = []
    for c in candidates:
        text_lower = c.text.lower()

        if is_noise(c.text):
            continue

        #  Reject manufacturer/company names
        if any(word in text_lower for word in [
            "pharma", "pharmaceutical", "ltd", "limited",
            "industries", "pvt", "private", "division", "manufactured"
        ]):
            continue

        #  Reject very long sentences
        if len(c.text.split()) > 6:
            continue

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

    # ── STEP A: Identify composition using DB ─────────────────

    composition = []

    for c in filtered:
        match = lookup_medicine(c.text, threshold=60.0)

        if match.match_score >= 70:
            name = match.matched_name

            # ❌ Reject generic dosage/form words
            if any(word in c.text.lower() for word in ["tablet", "tablets", "capsule", "dose"]):
                continue

            # ❌ Reject non-salt matches (cream, lotion, etc.)
            if match.details:
                salt = match.details.get("salt_composition", "")
                if not salt:
                    continue

            if name and name.lower() not in [m.lower() for m in composition]:
                composition.append(name)

    # ── STEP B: Identify brand (fallback logic) ───────────────

    brand_candidates = []

    for c in filtered:
        text_lower = c.text.lower()

        # Skip composition words
        if any(comp.lower().split()[0] in text_lower for comp in composition):
            continue

        # Skip noise
        if is_noise(c.text):
            continue

        word_count = len(c.text.split())

        # ❌ reject instruction-like phrases
        if any(x in text_lower for x in [
            "tablet", "tablets", "twice", "day", "dose"
        ]):
            continue

        # ✅ allow only clean alphabetic short names
        if 1 <= word_count <= 2 and re.match(r'^[A-Za-z\s]+$', c.text):
            brand_candidates.append(c)

    # Score brand candidates separately
    for c in brand_candidates:
        score_candidate(c, image_height)

    brand_candidates.sort(key=lambda c: c.score, reverse=True)

    brand_name = None
    if brand_candidates:
        brand_name = post_process_name(brand_candidates[0].text)

    for i, c in enumerate(filtered[:5]):
        logger.info(
            f"  Rank {i+1}: '{c.text}' "
            f"(score={c.score:.3f}, "
            f"len={c.score_breakdown['length']:.2f}, "
            f"upper={c.score_breakdown['uppercase']:.2f}, "
            f"pos={c.score_breakdown['position']:.2f}, "
            f"conf={c.score_breakdown['confidence']:.2f})"
        )


    logger.info(f"Selected: '{best.text}' → '{medicine_name}' (conf={confidence:.3f})")

    # ── FINAL DECISION LOGIC ─────────────────────────────

    # 1. If we found composition → trust that
    if composition:
        return StripResult(
            brand_name=brand_name,
            composition=composition,
            confidence=0.9,
            all_candidates=filtered,
            raw_text=raw_text,
        )

    # 2. Else fallback to best brand candidate
    if brand_candidates:
        return StripResult(
            brand_name=brand_name,
            composition=[],
            confidence=brand_candidates[0].confidence,
            all_candidates=filtered,
            raw_text=raw_text,
        )

    # 3. Else nothing useful
    return StripResult(
        brand_name=None,
        composition=[],
        confidence=0.0,
        all_candidates=filtered,
        raw_text=raw_text,
    )
