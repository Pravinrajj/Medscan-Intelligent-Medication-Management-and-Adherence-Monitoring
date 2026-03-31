"""
MediScan OCR — Tablet Strip Medicine Name Extractor (v2)
=========================================================
Extracts the medicine/brand name from tablet strip (blister pack) images
using OCR + rule-based scoring and filtering.

Changes from v1:
  - Noise filtering is now WORD-LEVEL, not detection-level.
    A candidate is only discarded when nothing meaningful remains
    after stripping noise words.  This prevents "DOLO 650" from
    being dropped because "650mg" was merged into the same bbox.
  - Repetition bonus: text appearing on 2+ bboxes (one per blister cell)
    gets a score boost — the brand name is printed on every cell.
  - Rebalanced scoring weights:
      font_size 0.30 (was 0.15) — largest text IS the brand name
      position  0.20 (was 0.30) — Indian strips don't follow strict top-bias
      confidence 0.20 (was 0.15) — Azure gives reliable word-confidence
      length    0.15 (was 0.20)
      uppercase 0.15 (was 0.20)
  - DB match threshold lowered to 70 (was 75), bonus raised to 0.50 (was 0.40).

Strategy (unchanged at high level):
  1. Build candidates from OCR detections
  2. Merge horizontally adjacent split detections
  3. Word-level noise filtering (keep meaningful remainder)
  4. Repetition count per unique text
  5. Score candidates + apply repetition bonus
  6. Apply DB-match score bonus
  7. Rank and select top candidate
  8. Post-process display name
"""

import re
import logging
from collections import Counter
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger("mediscan.strip_reader")


# ═══════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════

# Noise keywords — text containing any of these (as substrings) is flagged
NOISE_KEYWORDS = {
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
}

# Common English words that are NEVER medicine names.
# TrOCR (handwriting model) hallucinates English prose from printed strips.
# Any candidate whose ALL words are in this set is rejected outright.
COMMON_ENGLISH_WORDS = {
    # Articles / prepositions / conjunctions
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to",
    "of", "for", "with", "by", "from", "as", "is", "was", "are",
    "were", "be", "been", "being", "have", "has", "had", "do",
    "does", "did", "will", "would", "could", "should", "may",
    "might", "shall", "can", "not", "no", "nor", "so", "yet",
    "if", "that", "this", "then", "than", "its", "it", "we",
    "he", "she", "they", "them", "their", "his", "her", "our",
    "your", "my", "me", "you", "us", "who", "which", "when",
    "where", "how", "what", "more", "most", "very", "also",
    "since", "until", "while", "after", "before", "about", "into",
    "over", "under", "again", "further", "once", "both", "each",
    "few", "same", "other", "such", "own", "just", "because",
    "save", "among", "maybe", "loan", "wages", "urged", "orderly",
    "increase", "decrease", "opposition", "defendants", "catherine",
    "vizits", "goodcommament", "since", "catherine", "among",
    # Verbs that TrOCR commonly hallucinates
    "said", "make", "made", "made", "take", "taken", "used",
    "used", "following", "found", "known", "given", "came",
    "come", "think", "know", "look", "looked", "see", "seen",
}

# Short unit/quality abbreviations — matched whole-word only
SHORT_ABBREVS = {"ip", "bp", "usp", "mg", "ml", "mcg", "gm", "iu"}

# Dosage pattern used during word-level filtering
_DOSAGE_WORD_RE = re.compile(
    r'^\d+(?:\.\d+)?\s*(?:mg|ml|mcg|g|iu|%|units?)$', re.IGNORECASE
)

# Suffix words stripped from the final display name
SUFFIX_WORDS = {
    "tablets", "tablet", "tab",
    "capsules", "capsule", "cap",
    "syrup", "syr", "suspension",
    "injection", "inj",
    "cream", "ointment", "gel", "lotion",
    "drops", "drop", "spray",
    "oral",
}

# Position scoring: ideal vertical band (fraction of image height)
# Widened vs v1 to better handle landscape/short strip images
IDEAL_Y_TOP    = 0.10
IDEAL_Y_BOTTOM = 0.70

# Max horizontal gap (px) for merging adjacent same-line detections
MERGE_X_GAP_THRESHOLD = 50

# DB match parameters
DB_MATCH_BONUS_THRESHOLD = 70.0   # was 75.0
DB_MATCH_BONUS           = 0.80   # raised: DB-verified names should dominate

# Repetition bonus per extra occurrence (capped at 0.30 total)
REPEAT_BONUS_PER_EXTRA = 0.10
REPEAT_BONUS_MAX       = 0.30


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
    is_db_match: bool = False

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "confidence": round(self.confidence, 4),
            "score": round(self.score, 4),
            "score_breakdown": self.score_breakdown,
            "is_db_match": self.is_db_match,
        }


@dataclass
class StripResult:
    """Result of tablet strip medicine name extraction."""
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
# Word-Level Noise Filtering  (replaces the old detection-level filter)
# ═══════════════════════════════════════════════════════════════════

def filter_noise_words(text: str) -> Optional[str]:
    """
    Remove noise words from a candidate text token by token.
    Returns the cleaned remainder, or None if nothing meaningful survives.

    Unlike the old is_noise() which discarded the entire detection when
    ANY noise word appeared, this function strips only the bad tokens.
    This means "DOLO 650mg" → "DOLO" (kept) instead of being dropped.

    A word is considered noise if it:
      - Matches a dosage pattern (e.g. "500mg", "10ml")
      - Is a short unit abbreviation standing alone (mg, ml, bp, ip …)
      - Is a pure number or date fragment
      - Contains a long noise keyword as a substring

    The entire detection is discarded only if fewer than 3 alphabetic
    characters remain after filtering.
    """
    text_lower = text.lower()

    # Fast rejection: if a long noise keyword appears as a substring,
    # discard the whole detection (these are never part of brand names)
    for keyword in NOISE_KEYWORDS:
        if keyword in text_lower:
            return None

    # Reject very short single-word candidates (≤3 chars, e.g. 'TEN', 'ACE')
    # These have high font_size scores but are almost never standalone brand names.
    # They will still survive if they appear as PART of a multi-word candidate.
    stripped_text = text.strip()
    if len(stripped_text.split()) == 1:
        alpha_only = re.sub(r'[^a-zA-Z]', '', stripped_text)
        if len(alpha_only) <= 3:
            return None

    # Reject candidates whose every word is a common English word
    # (TrOCR hallucinates English prose from printed strips)
    all_words_lower = [w.strip('.,;:()').lower() for w in text.split() if w.strip('.,;:()')]
    meaningful_words = [w for w in all_words_lower if w not in COMMON_ENGLISH_WORDS]
    if all_words_lower and not meaningful_words:
        return None

    # Date patterns → discard
    if re.search(r'\b\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}\b', text):
        return None
    if re.search(r'\b\d{1,2}[/\-\.]\d{2,4}\b', text):
        return None

    # Repetitive single-char pattern → discard (e.g. 'W.W.W.W.W.' or 'FIFAOUS'-style OCR hallucinations)
    # Matches patterns like X.X.X. or X+X+X where a single letter repeats 3+ times with separators
    if re.search(r'(?:^|\s)([A-Za-z])[^A-Za-z\s]\1[^A-Za-z\s]\1', text):
        return None
    # Discard if more than half the characters are non-alphanumeric (dots, dashes, symbols)
    alpha_num_chars = len(re.sub(r'[^a-zA-Z0-9]', '', text))
    total_chars = len(text.strip())
    if total_chars > 0 and alpha_num_chars / total_chars < 0.5:
        return None

    # Word-by-word filter
    clean_words = []
    for word in text.split():
        word_stripped = word.strip('.,;:()')
        word_lower    = word_stripped.lower()

        # Skip dosage patterns: "500mg", "250 mg"
        if _DOSAGE_WORD_RE.match(word_stripped):
            continue

        # Skip short unit abbreviations when they appear as standalone tokens
        if word_lower in SHORT_ABBREVS:
            continue

        # Skip pure numeric / date tokens
        if re.match(r'^[\d/\-\.]+$', word_stripped):
            continue

        # Skip standalone single non-vowel characters (OCR separator artifacts)
        if len(word_stripped) == 1 and word_stripped.lower() not in 'aeiou':
            continue

        clean_words.append(word)

    result = ' '.join(clean_words).strip()

    # Discard if fewer than 3 alphabetic characters remain
    if len(re.sub(r'[^a-zA-Z]', '', result)) < 3:
        return None

    return result


# ═══════════════════════════════════════════════════════════════════
# Bbox Merging
# ═══════════════════════════════════════════════════════════════════

def merge_nearby_detections(
    candidates: List[StripCandidate],
    x_gap_threshold: int = MERGE_X_GAP_THRESHOLD,
) -> List[StripCandidate]:
    """
    Merge horizontally adjacent candidates on the same text line.
    EasyOCR / Azure often splits a printed name across multiple bboxes.
    """
    if not candidates:
        return candidates

    # Sort by y-band (quantised to 15px rows) then by left x
    candidates.sort(
        key=lambda c: (round(c.y_center / 15), c.bbox[0][0] if c.bbox else 0)
    )

    merged = []
    cur = candidates[0]

    for nxt in candidates[1:]:
        same_line = abs(nxt.y_center - cur.y_center) < 15

        try:
            cur_right = cur.bbox[1][0]
            nxt_left  = nxt.bbox[0][0]
            x_gap = nxt_left - cur_right
        except (IndexError, TypeError):
            x_gap = x_gap_threshold + 1

        if same_line and 0 <= x_gap <= x_gap_threshold:
            cur = StripCandidate(
                text=cur.text + " " + nxt.text,
                confidence=min(cur.confidence, nxt.confidence),
                bbox=cur.bbox,
                y_center=(cur.y_center + nxt.y_center) / 2,
            )
        else:
            merged.append(cur)
            cur = nxt

    merged.append(cur)
    return merged


# ═══════════════════════════════════════════════════════════════════
# Scoring
# ═══════════════════════════════════════════════════════════════════

def compute_font_size_score(
    candidate: StripCandidate,
    all_candidates: List[StripCandidate],
) -> float:
    """
    Score based on bounding-box area relative to the largest candidate.
    Larger printed text → more likely to be the brand name.
    """
    def _area(c: StripCandidate) -> float:
        if not c.bbox or len(c.bbox) < 4:
            return 0.0
        xs = [p[0] for p in c.bbox]
        ys = [p[1] for p in c.bbox]
        return (max(xs) - min(xs)) * (max(ys) - min(ys))

    my_area = _area(candidate)
    if my_area == 0:
        return 0.0

    max_area = max((_area(c) for c in all_candidates), default=1.0)
    if max_area == 0:
        return 0.0

    return min(1.0, my_area / max_area)


def score_candidate(
    candidate: StripCandidate,
    image_height: int,
    all_candidates: List[StripCandidate],
) -> float:
    """
    Compute a composite score for a strip candidate.

    Weights (v2):
        font_size   0.30  — largest bbox is most likely the brand name
        position    0.20  — upper-mid region preferred but not dominant
        confidence  0.20  — Azure gives reliable word confidence
        length      0.15  — prefer longer names (brand names > 5 chars)
        uppercase   0.15  — brand names are usually ALL-CAPS on strips
    """
    text = candidate.text

    # ── Length score ────────────────────────────────────────────────
    alpha_len = len(re.sub(r'[^a-zA-Z]', '', text))
    if alpha_len <= 3:
        length_score = 0.1
    elif alpha_len <= 6:
        length_score = 0.4 + (alpha_len - 3) * 0.1
    elif alpha_len <= 12:
        length_score = 0.7 + (alpha_len - 6) * 0.05
    else:
        length_score = 1.0

    # ── Uppercase score ─────────────────────────────────────────────
    alpha_chars = re.findall(r'[a-zA-Z]', text)
    if alpha_chars:
        upper_ratio = sum(1 for c in alpha_chars if c.isupper()) / len(alpha_chars)
        uppercase_score = upper_ratio
    else:
        uppercase_score = 0.0

    # ── Position score ──────────────────────────────────────────────
    if image_height > 0:
        y_frac = candidate.y_center / image_height
        if IDEAL_Y_TOP <= y_frac <= IDEAL_Y_BOTTOM:
            position_score = 1.0
        elif y_frac < IDEAL_Y_TOP:
            position_score = max(0.0, 1.0 - (IDEAL_Y_TOP - y_frac) * 10)
        else:
            position_score = max(0.0, 1.0 - (y_frac - IDEAL_Y_BOTTOM) * 5)
    else:
        position_score = 0.5

    # ── Confidence score ────────────────────────────────────────────
    confidence_score = min(1.0, candidate.confidence)

    # ── Font-size score ─────────────────────────────────────────────
    font_size_score = compute_font_size_score(candidate, all_candidates)

    # ── Weighted combination (v2 weights) ───────────────────────────
    weights = {
        "length":     0.15,
        "uppercase":  0.15,
        "position":   0.20,
        "confidence": 0.20,
        "font_size":  0.30,
    }

    total = (
        weights["length"]     * length_score +
        weights["uppercase"]  * uppercase_score +
        weights["position"]   * position_score +
        weights["confidence"] * confidence_score +
        weights["font_size"]  * font_size_score
    )

    candidate.score = total
    candidate.score_breakdown = {
        "length":     round(length_score, 3),
        "uppercase":  round(uppercase_score, 3),
        "position":   round(position_score, 3),
        "confidence": round(confidence_score, 3),
        "font_size":  round(font_size_score, 3),
        "total":      round(total, 3),
    }
    return total


# ═══════════════════════════════════════════════════════════════════
# Post-Processing
# ═══════════════════════════════════════════════════════════════════

def post_process_name(text: str) -> str:
    """
    Clean up the extracted medicine name:
      1. Remove suffix words (Tablets, Capsules, etc.)
      2. Remove stray non-alphabetic characters from edges
      3. Remove isolated single characters (OCR artifacts)
      4. Normalize spacing and capitalize appropriately

    Formulation modifiers (SR, XR, Forte, DS …) are intentionally kept
    in the display name — they are meaningful to the patient.
    They are stripped only inside clean_name_for_matching() in medicine_db.
    """
    if not text:
        return text

    words = text.split()
    filtered_words = [
        word for word in words
        if word.lower().strip('.,;:') not in SUFFIX_WORDS
    ]
    name = ' '.join(filtered_words).strip()

    name = re.sub(r'^[\s\-_.,;:]+|[\s\-_.,;:]+$', '', name)
    name = re.sub(r'\b(?![aAiI]\b)[a-zA-Z]\b', '', name)
    name = re.sub(r'\s+', ' ', name).strip()

    alpha_chars = re.findall(r'[a-zA-Z]', name)
    if alpha_chars:
        upper_ratio = sum(1 for c in alpha_chars if c.isupper()) / len(alpha_chars)
        name = name.upper() if upper_ratio >= 0.6 else name.title()

    return name


# ═══════════════════════════════════════════════════════════════════
# Main Extraction Pipeline
# ═══════════════════════════════════════════════════════════════════

def extract_medicine_name(detections: list, image_height: int) -> StripResult:
    """
    Extract the medicine brand name from tablet strip OCR detections.

    Pipeline (v2):
        1. Build candidates from OCR detections
        2. Merge horizontally adjacent split detections
        3. Word-level noise filtering (preserve partial names)
        4. Count per-text repetitions for the repetition bonus
        5. Score candidates (rebalanced weights)
        6. Apply repetition bonus (text on multiple cells = brand name)
        7. Apply DB-match score bonus (threshold 70, bonus 0.50)
        8. Rank and select top candidate
        9. Post-process the display name

    Args:
        detections: List of OCRDetection objects from Azure/EasyOCR
        image_height: Height of the source image in pixels

    Returns:
        StripResult with brand_name, composition, confidence, candidates
    """
    if not detections:
        logger.warning("No detections to process for strip reading")
        return StripResult(
            brand_name=None, composition=[], confidence=0.0,
            all_candidates=[], raw_text=""
        )

    raw_text = " ".join(d.text for d in detections)

    # ── Step 1: Build candidates ──────────────────────────────────
    candidates: List[StripCandidate] = []
    for det in detections:
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

    # ── Step 2: Merge adjacent split detections ───────────────────
    candidates = merge_nearby_detections(candidates)
    logger.info(f"After merge: {len(candidates)} candidates")

    # ── Step 3: Word-level noise filtering ───────────────────────
    # (replaces the old detection-level is_noise() call)
    filtered: List[StripCandidate] = []
    for c in candidates:
        cleaned_text = filter_noise_words(c.text)
        if cleaned_text is None:
            logger.debug(f"  Fully noise: '{c.text}'")
        else:
            if cleaned_text != c.text:
                logger.debug(
                    f"  Partial clean: '{c.text}' → '{cleaned_text}'"
                )
            c.text = cleaned_text
            filtered.append(c)

    logger.info(
        f"After word-level noise filter: "
        f"{len(filtered)}/{len(candidates)} candidates remain"
    )

    if not filtered:
        logger.warning("All candidates filtered as noise")
        return StripResult(
            brand_name=None, composition=[], confidence=0.0,
            all_candidates=candidates, raw_text=raw_text
        )

    # ── Step 4: Repetition count ──────────────────────────────────
    # Brand names appear once per blister cell; count per normalised text
    text_counts = Counter(c.text.upper() for c in filtered)

    # ── Step 5: Score candidates ──────────────────────────────────
    for c in filtered:
        score_candidate(c, image_height, filtered)

    # ── Step 6: Repetition bonus ──────────────────────────────────
    for c in filtered:
        repeat_count = text_counts.get(c.text.upper(), 1)
        if repeat_count >= 2:
            bonus = min(REPEAT_BONUS_MAX, REPEAT_BONUS_PER_EXTRA * (repeat_count - 1))
            c.score = min(1.0, c.score + bonus)
            if c.score_breakdown:
                c.score_breakdown["repeat_bonus"] = round(bonus, 3)
                c.score_breakdown["repeat_count"] = repeat_count
                c.score_breakdown["total"] = round(c.score, 3)
            logger.debug(
                f"  Repeat bonus: '{c.text}' ×{repeat_count} +{bonus:.2f}"
            )

    # ── Step 7: DB-match score bonus ──────────────────────────────
    # Strategy:
    #   1. Try the full candidate text (e.g. "Ornidazole Tablets")
    #   2. If that misses, try each individual word (≥4 chars) in the text
    #      so "Paracetamol Propyphenazine" → tries "Paracetamol" separately
    #   3. Also try the first word alone (often the brand name on multi-word results)
    # This ensures a DB-verified word inside a noisy multi-word OCR result
    # still earns the DB bonus and rises above short high-font-score noise.
    try:
        from medicine_db import lookup_medicine, is_database_loaded
        if is_database_loaded():
            for c in filtered:
                db_hit = False
                matched_word = None

                # --- 7a: full-string lookup ---
                # For full-string matches, matched_word stays None so Step 9
                # uses post_process_name(candidate.text) — the OCR text IS the
                # brand name already. Only per-word matches (7b) need a separate
                # display word.
                match = lookup_medicine(c.text)
                if match.matched_name and match.match_score >= DB_MATCH_BONUS_THRESHOLD:
                    db_hit = True
                    logger.info(
                        f"  DB bonus (full): '{c.text}' → '{match.matched_name}' "
                        f"(score={match.match_score:.1f})"
                    )

                # --- 7b: per-word fallback ---
                if not db_hit:
                    words = c.text.split()
                    # Try each word that:
                    #   - has ≥4 alphabetic chars (rules out 'Tab', 'mg', 'IP')
                    #   - is NOT a common English word (TrOCR hallucination)
                    # The tiered partial_ratio thresholds in medicine_db
                    # handle the rest: short words need ≥95% match score.
                    for word in words:
                        word_clean = re.sub(r'[^a-zA-Z]', '', word)
                        if len(word_clean) < 4:
                            continue
                        if word_clean.lower() in COMMON_ENGLISH_WORDS:
                            continue
                        w_match = lookup_medicine(word_clean)
                        if w_match.matched_name and w_match.match_score >= DB_MATCH_BONUS_THRESHOLD:
                            db_hit = True
                            # Store the QUERIED WORD for display, not the full DB entry
                            matched_word = word_clean
                            logger.info(
                                f"  DB bonus (word): '{word_clean}' inside "
                                f"'{c.text}' → '{w_match.matched_name}' "
                                f"(score={w_match.match_score:.1f})"
                            )
                            break

                if db_hit:
                    c.score = min(1.0, c.score + DB_MATCH_BONUS)
                    c.is_db_match = True
                    # Store the matched DB word so post-processing can use it
                    c.score_breakdown = c.score_breakdown or {}
                    c.score_breakdown["db_bonus"] = DB_MATCH_BONUS
                    c.score_breakdown["db_matched_word"] = matched_word
                    c.score_breakdown["total"] = round(c.score, 3)
    except ImportError:
        logger.debug("medicine_db not available — skipping DB bonus step")

    # ── Step 8: Rank by score (descending) ───────────────────────
    filtered.sort(key=lambda c: c.score, reverse=True)

    for i, c in enumerate(filtered[:5]):
        bd = c.score_breakdown or {}
        logger.info(
            f"  Rank {i+1}: '{c.text}' "
            f"(score={c.score:.3f}, "
            f"font={bd.get('font_size', 0):.2f}, "
            f"pos={bd.get('position', 0):.2f}, "
            f"conf={bd.get('confidence', 0):.2f}, "
            f"rep=×{bd.get('repeat_count', 1)}"
            f"{', DB✓' if c.is_db_match else ''})"
        )

    # ── Step 9: Select top and post-process ───────────────────────
    # Walk down the ranked list until we find a candidate whose post-processed
    # name has at least 3 alphabetic characters (guards against OCR garbage
    # like 'W.W.W.W.' that somehow survives filtering and scores high).
    # If the candidate was matched via a per-word DB lookup, use the verified
    # DB word as the brand_name source (cleaner than the full noisy OCR text).
    best = None
    brand_name = None
    for candidate in filtered:
        # If a specific DB word was verified, use it directly
        db_word = (candidate.score_breakdown or {}).get("db_matched_word")
        if db_word and candidate.is_db_match:
            best = candidate
            brand_name = post_process_name(db_word)
            break

        processed = post_process_name(candidate.text)
        alpha_count = len(re.sub(r'[^a-zA-Z]', '', processed))
        if alpha_count >= 3:
            best = candidate
            brand_name = processed
            break

    if best is None:
        logger.warning("No valid candidate survived post-processing — returning None")
        return StripResult(
            brand_name=None, composition=[], confidence=0.0,
            all_candidates=filtered, raw_text=raw_text
        )

    confidence = best.confidence

    composition: List[str] = []
    if best.is_db_match:
        try:
            from medicine_db import lookup_medicine
            match = lookup_medicine(best.text)
            if match.details and match.details.get("salt_composition"):
                composition = [match.details["salt_composition"]]
        except ImportError:
            pass

    logger.info(
        f"Selected: '{best.text}' → '{brand_name}' "
        f"(conf={confidence:.3f}, db_match={best.is_db_match})"
    )

    return StripResult(
        brand_name=brand_name,
        composition=composition,
        confidence=confidence,
        all_candidates=filtered,
        raw_text=raw_text,
    )
