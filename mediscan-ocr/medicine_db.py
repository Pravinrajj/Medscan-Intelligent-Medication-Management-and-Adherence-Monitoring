"""
MediScan OCR — Medicine Database Module
=========================================
Loads a CSV-based medicine dataset into memory and provides
fuzzy matching against OCR-extracted medicine names.

Features:
    - One-time CSV loading at startup (pandas DataFrame in memory)
    - Fuzzy matching via rapidfuzz against product_name AND salt_composition
    - Configurable similarity threshold (default: 75%)
    - Pre-matching text cleanup (remove dosage forms, units, etc.)
    - Returns full medicine details (composition, manufacturer, description,
      side effects, drug interactions, price)

Usage:
    from medicine_db import load_database, lookup_medicine
    load_database("medicine_data.csv")
    result = lookup_medicine("Paracetamol")
"""

import re
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field

logger = logging.getLogger("mediscan.medicine_db")

# ═══════════════════════════════════════════════════════════════════
# Global State
# ═══════════════════════════════════════════════════════════════════

_db = None            # Pandas DataFrame (loaded once)
_product_names = []   # Pre-extracted product name strings for matching
_salt_names = []      # Pre-extracted salt composition strings for matching
_db_loaded = False


# ═══════════════════════════════════════════════════════════════════
# Data Models
# ═══════════════════════════════════════════════════════════════════

@dataclass
class MedicineMatch:
    """Result of matching an OCR name against the medicine database."""
    extracted_name: str            # Original OCR-extracted name
    cleaned_name: str              # After pre-processing cleanup
    matched_name: Optional[str]    # Best match from database (or None)
    match_score: float             # Similarity score (0-100)
    match_field: Optional[str]     # Which field matched: "product_name" or "salt_composition"
    details: Optional[Dict[str, Any]]  # Full medicine details (or None if no match)

    def to_dict(self) -> dict:
        result = {
            "extracted_name": self.extracted_name,
            "matched_name": self.matched_name if self.matched_name else "Unknown",
            "match_score": round(self.match_score, 2),
        }
        if self.details:
            result["details"] = self.details
        return result


# ═══════════════════════════════════════════════════════════════════
# Database Loading
# ═══════════════════════════════════════════════════════════════════

def load_database(csv_path: str) -> bool:
    """
    Load the medicine CSV database into memory.
    Should be called ONCE at application startup.

    Args:
        csv_path: Path to medicine_data.csv

    Returns:
        True if loaded successfully, False otherwise
    """
    global _db, _product_names, _salt_names, _db_loaded

    try:
        import pandas as pd

        path = Path(csv_path)
        if not path.exists():
            logger.error(f"Medicine database not found: {csv_path}")
            return False

        _db = pd.read_csv(csv_path, encoding='utf-8')

        # Clean column names (strip whitespace)
        _db.columns = _db.columns.str.strip()

        # Fill NaN values with empty strings
        _db = _db.fillna("")

        # Pre-extract name columns for fast matching
        _product_names = _db['product_name'].astype(str).tolist()
        _salt_names = _db['salt_composition'].astype(str).tolist()

        _db_loaded = True

        logger.info(
            f"Medicine database loaded: {len(_db)} entries from '{csv_path}'"
        )
        logger.info(
            f"  Columns: {list(_db.columns)}"
        )

        return True

    except ImportError:
        logger.error("pandas is not installed. Run: pip install pandas")
        return False
    except Exception as e:
        logger.error(f"Failed to load medicine database: {e}")
        return False


def is_database_loaded() -> bool:
    """Check if the medicine database is loaded."""
    return _db_loaded


def get_database_size() -> int:
    """Get the number of entries in the database."""
    return len(_db) if _db is not None else 0


# ═══════════════════════════════════════════════════════════════════
# Name Pre-Processing (cleanup before matching)
# ═══════════════════════════════════════════════════════════════════

# Words to strip from OCR-extracted names before matching
STRIP_WORDS = {
    # Dosage forms
    "tablet", "tablets", "tab",
    "capsule", "capsules", "cap",
    "syrup", "syr", "suspension", "susp",
    "injection", "inj",
    "cream", "ointment", "oint", "gel", "lotion",
    "drops", "drop", "spray", "inhaler",

    # Dosage units
    "mg", "ml", "mcg", "gm", "iu",

    # Formulation types
    "forte", "plus", "sr", "xr", "cr", "er", "ds",
    "oral", "topical",

    # Common junk
    "ip", "bp", "usp",
}


def clean_name_for_matching(name: str) -> str:
    """
    Pre-process an OCR-extracted medicine name for database matching.

    Steps:
        1. Strip whitespace
        2. Remove dosage numbers and units (e.g., "500mg", "250 mg")
        3. Remove dosage form words (tablet, capsule, etc.)
        4. Normalize spacing and case

    Args:
        name: Raw OCR-extracted medicine name

    Returns:
        Cleaned name ready for fuzzy matching
    """
    if not name:
        return ""

    cleaned = name.strip()

    # Remove dosage patterns: "500mg", "250 mg", "10ml", etc.
    cleaned = re.sub(
        r'\b\d+(?:\.\d+)?\s*(?:mg|ml|mcg|g|iu|%|units?)\b',
        '', cleaned, flags=re.IGNORECASE
    )

    # Remove standalone numbers
    cleaned = re.sub(r'\b\d+\b', '', cleaned)

    # Remove strip words
    words = cleaned.split()
    filtered = [w for w in words if w.lower().strip('.,;:') not in STRIP_WORDS]
    cleaned = ' '.join(filtered)

    # Remove extra whitespace
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    return cleaned


# ═══════════════════════════════════════════════════════════════════
# Fuzzy Matching
# ═══════════════════════════════════════════════════════════════════

def lookup_medicine(
    extracted_name: str,
    threshold: float = 75.0
) -> MedicineMatch:
    """
    Look up a medicine name in the database using fuzzy matching.

    Matching strategy:
        1. Clean the extracted name (remove dosage, form words)
        2. Try exact match on product_name (case-insensitive)
        3. Try fuzzy match on product_name (rapidfuzz)
        4. Try fuzzy match on salt_composition (rapidfuzz)
        5. Return best match above threshold, or "Unknown"

    Args:
        extracted_name: OCR-extracted medicine name
        threshold: Minimum similarity score to accept (0-100, default: 75)

    Returns:
        MedicineMatch with full details if found, or empty details if not
    """
    if not _db_loaded or _db is None:
        logger.warning("Medicine database not loaded — cannot look up")
        return MedicineMatch(
            extracted_name=extracted_name,
            cleaned_name=extracted_name,
            matched_name=None,
            match_score=0.0,
            match_field=None,
            details=None,
        )

    cleaned = clean_name_for_matching(extracted_name)
    if not cleaned:
        cleaned = extracted_name.strip()

    logger.info(f"Looking up: '{extracted_name}' → cleaned: '{cleaned}'")

    try:
        from rapidfuzz import fuzz, process

        # ── Strategy 1: Exact match on product_name ───────────────
        cleaned_lower = cleaned.lower()
        for i, pname in enumerate(_product_names):
            if pname.strip().lower() == cleaned_lower:
                details = _get_details(i)
                logger.info(f"  Exact match: '{pname}' (score=100)")
                return MedicineMatch(
                    extracted_name=extracted_name,
                    cleaned_name=cleaned,
                    matched_name=pname.strip(),
                    match_score=100.0,
                    match_field="product_name",
                    details=details,
                )

        # ── Strategy 2: Fuzzy match on product_name (token_sort_ratio) ─
        # token_sort_ratio handles word-order differences well
        best_product = process.extractOne(
            cleaned,
            _product_names,
            scorer=fuzz.token_sort_ratio,
            score_cutoff=threshold,
        )

        # ── Strategy 3: Fuzzy match on salt_composition ───────────
        best_salt = process.extractOne(
            cleaned,
            _salt_names,
            scorer=fuzz.token_sort_ratio,
            score_cutoff=threshold,
        )

        # ── Strategy 4: partial_ratio fallback ────────────────────
        # partial_ratio checks whether the query is a SUBSTRING of a DB entry.
        # Tiered thresholds prevent false positives on short words:
        #   - Short words (4-6 alpha chars): require ≥95% — only near-exact
        #     substring matches accepted (e.g. 'DOLO' inside 'Dolo 650mg Tablet' = 100%)
        #   - Long words (≥7 alpha chars): require ≥88% — 'Paracetamol' inside
        #     'Paracetamol 500mg Tablets' = 100%
        # Words with <4 alpha chars are too short for any substring matching.
        PARTIAL_MIN_ALPHA = 4

        cleaned_alpha_len = len(re.sub(r'[^a-zA-Z]', '', cleaned))
        best_partial_product = None
        best_partial_salt    = None
        partial_cutoff       = 0.0  # will be set below if applicable

        if cleaned_alpha_len >= PARTIAL_MIN_ALPHA:
            # Tiered threshold: stricter for shorter queries
            partial_cutoff = 95.0 if cleaned_alpha_len < 7 else 88.0

            best_partial_product = process.extractOne(
                cleaned,
                _product_names,
                scorer=fuzz.partial_ratio,
                score_cutoff=partial_cutoff,
            )
            best_partial_salt = process.extractOne(
                cleaned,
                _salt_names,
                scorer=fuzz.partial_ratio,
                score_cutoff=partial_cutoff,
            )

        # Pick the best match across all strategies
        best_match = None
        best_score = 0.0
        best_field = None
        best_index = None

        if best_product and best_product[1] >= threshold:
            best_match = best_product[0]
            best_score = best_product[1]
            best_field = "product_name"
            best_index = best_product[2]

        if best_salt and best_salt[1] > best_score:
            best_match = best_salt[0]
            best_score = best_salt[1]
            best_field = "salt_composition"
            best_index = best_salt[2]

        # Accept partial match only if it beats the current best AND clears the partial threshold
        if best_partial_product and best_partial_product[1] > best_score:
            best_match = best_partial_product[0]
            best_score = best_partial_product[1]
            best_field = "product_name (partial)"
            best_index = best_partial_product[2]

        if best_partial_salt and best_partial_salt[1] > best_score:
            best_match = best_partial_salt[0]
            best_score = best_partial_salt[1]
            best_field = "salt_composition (partial)"
            best_index = best_partial_salt[2]

        if best_match and best_score >= threshold:
            details = _get_details(best_index)
            logger.info(
                f"  Fuzzy match: '{best_match}' "
                f"(score={best_score:.1f}, field={best_field})"
            )
            return MedicineMatch(
                extracted_name=extracted_name,
                cleaned_name=cleaned,
                matched_name=best_match.strip(),
                match_score=best_score,
                match_field=best_field,
                details=details,
            )

        # ── No match found ────────────────────────────────────────
        logger.info(
            f"  No match above threshold ({threshold}%) for '{cleaned}'"
        )
        return MedicineMatch(
            extracted_name=extracted_name,
            cleaned_name=cleaned,
            matched_name=None,
            match_score=best_score if best_product or best_salt else 0.0,
            match_field=None,
            details=None,
        )

    except ImportError:
        logger.error("rapidfuzz is not installed. Run: pip install rapidfuzz")
        return MedicineMatch(
            extracted_name=extracted_name,
            cleaned_name=cleaned,
            matched_name=None,
            match_score=0.0,
            match_field=None,
            details=None,
        )


def lookup_multiple(names: List[str], threshold: float = 75.0) -> List[MedicineMatch]:
    """
    Look up multiple medicine names at once.

    Args:
        names: List of OCR-extracted medicine names
        threshold: Minimum similarity score (0-100)

    Returns:
        List of MedicineMatch results (one per name)
    """
    return [lookup_medicine(name, threshold) for name in names]


def process_prescription_lines(
    lines: list,
    threshold: float = 75.0,
) -> List[Dict[str, Any]]:
    """
    Process multiple medicine lines from a prescription.

    This is the PRIMARY entry point for multi-medicine extraction.
    Each line is independently cleaned, matched against the DB,
    and deduplicated.

    Pipeline per line:
        1. Clean text (lowercase, remove noise words, special chars)
        2. Skip if too short or irrelevant
        3. Fuzzy match against product_name and salt_composition
        4. Accept match if score >= threshold
        5. Deduplicate by matched_name

    Args:
        lines: List of TextLine objects (from cleaner.group_into_lines)
        threshold: Minimum match score to accept (default: 75)

    Returns:
        List of medicine dicts (deduplicated) in the format:
        [{
            "extracted_text": "...",
            "matched_name": "...",
            "match_score": ...,
            "details": { ... }
        }]
    """
    if not lines:
        return []

    results = []
    seen_matches = set()  # For deduplication by matched_name

    logger.info(f"Processing {len(lines)} lines for multi-medicine extraction")

    for line in lines:
        text = line.text if hasattr(line, 'text') else str(line)
        confidence = line.avg_confidence if hasattr(line, 'avg_confidence') else 0.0

        # Clean the line text for matching
        cleaned = _clean_line_for_extraction(text)

        # Skip very short / irrelevant cleaned text
        alpha_chars = re.sub(r'[^a-zA-Z]', '', cleaned)
        if len(alpha_chars) < 3:
            logger.debug(f"  Skipping short line: '{text}' → '{cleaned}'")
            continue

        logger.info(f"  Line: '{text}' → cleaned: '{cleaned}'")

        # Match against DB
        match = lookup_medicine(cleaned, threshold=threshold)

        if match.matched_name and match.match_score >= threshold:
            # Dedup key: lowercase matched_name
            dedup_key = match.matched_name.lower()
            if dedup_key in seen_matches:
                logger.debug(f"  Duplicate skipped: '{match.matched_name}'")
                continue

            seen_matches.add(dedup_key)

            entry = {
                "extracted_text": text,
                "matched_name": match.matched_name,
                "match_score": round(match.match_score, 2),
                "details": match.details if match.details else {},
            }
            results.append(entry)

            logger.info(
                f"  ✅ Matched: '{text}' → '{match.matched_name}' "
                f"(score={match.match_score:.1f})"
            )
        else:
            logger.debug(
                f"  ❌ No match: '{text}' (best_score={match.match_score:.1f})"
            )

    logger.info(
        f"Multi-medicine result: {len(results)} unique medicine(s) "
        f"from {len(lines)} lines"
    )
    return results


def _clean_line_for_extraction(text: str) -> str:
    """
    Clean a raw OCR line for medicine name extraction.

    Steps:
        1. Convert to lowercase
        2. Remove special characters (~, |, etc.)
        3. Remove noise words (tablet, mg, capsule, etc.)
        4. Remove dosage numbers + units
        5. Normalize spacing

    Args:
        text: Raw OCR line text

    Returns:
        Cleaned text for DB matching
    """
    if not text:
        return ""

    cleaned = text.strip()

    # Remove special characters but keep letters, digits, spaces, hyphens
    cleaned = re.sub(r'[~|\\@#$%^&*()_+=\[\]{}<>?/,;:!\"\']+', ' ', cleaned)

    # Remove dosage patterns: "500mg", "250 mg", "10ml", etc.
    cleaned = re.sub(
        r'\b\d+(?:\.\d+)?\s*(?:mg|ml|mcg|g|iu|%|units?)\b',
        '', cleaned, flags=re.IGNORECASE
    )

    # Remove frequency patterns: "1-0-1", "BD", "TDS", etc.
    cleaned = re.sub(
        r'\b(?:OD|BD|BID|TDS|TID|QID|QD|PRN|SOS|HS|AC|PC|STAT)\b',
        '', cleaned, flags=re.IGNORECASE
    )
    cleaned = re.sub(r'\b\d[\-\+]\d[\-\+]\d\b', '', cleaned)

    # Remove standalone numbers
    cleaned = re.sub(r'\b\d+\b', '', cleaned)

    # Remove noise/form words
    words = cleaned.split()
    filtered = [w for w in words if w.lower().strip('.,;:') not in STRIP_WORDS]
    cleaned = ' '.join(filtered)

    # Normalize whitespace
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    return cleaned


# ═══════════════════════════════════════════════════════════════════
# Internal Helpers
# ═══════════════════════════════════════════════════════════════════

def _get_details(index: int) -> Dict[str, Any]:
    """
    Extract full medicine details from the DataFrame at the given index.

    Returns a dictionary with all relevant columns.
    """
    if _db is None or index < 0 or index >= len(_db):
        return {}

    row = _db.iloc[index]

    return {
        "sub_category": str(row.get("sub_category", "")).strip(),
        "salt_composition": str(row.get("salt_composition", "")).strip(),
        "product_manufactured": str(row.get("product_manufactured", "")).strip(),
        "medicine_desc": str(row.get("medicine_desc", "")).strip(),
        "side_effects": str(row.get("side_effects", "")).strip(),
        "drug_interactions": str(row.get("drug_interactions", "")).strip(),
        "product_price": str(row.get("product_price", "")).strip(),
    }

