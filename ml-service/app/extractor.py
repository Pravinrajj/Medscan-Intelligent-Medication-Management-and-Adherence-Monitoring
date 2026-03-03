"""
MediScan — Stage 5: Candidate Extraction + Fuzzy Matching
==========================================================
Regex extraction of dosage, frequency, expiry, name candidates.
RapidFuzz 4-tier matching against 195K DrugLookup DB.
"""

import re
import logging
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════
# Regex Patterns (medical text extraction)
# ═══════════════════════════════════════════════════════════════════

# Dosage: 500mg, 250 mg, 10ml, 5ML, etc.
DOSAGE_PATTERN = re.compile(
    r'\b(\d+(?:\.\d+)?)\s*(mg|ml|mcg|g|iu|%)\b', re.IGNORECASE
)

# Frequency: 1-0-1, OD, BD, TDS, 1+0+1, etc.
FREQUENCY_PATTERN = re.compile(
    r'\b(\d[\-\+]\d[\-\+]\d)\b'              # 1-0-1, 1+0+1
    r'|\b(OD|BD|TDS|QID|PRN|BID|TID)\b'      # abbreviations
    r'|\b(once|twice|thrice)\s+(daily|a\s+day)\b',  # text form
    re.IGNORECASE
)

# Expiry: Exp 12/2026, Exp: 12-2026, EXP:01/25
EXPIRY_PATTERN = re.compile(
    r'\b(?:exp(?:iry)?\.?:?\s*)(\d{1,2}[/\-]\d{2,4})\b', re.IGNORECASE
)

# Medicine name candidates: word after Tab/Cap/Syrup/Inj etc.
MED_PREFIX_PATTERN = re.compile(
    r'\b(?:tab(?:let)?|cap(?:sule)?|syrup|syr|inj(?:ection)?|cream|oint(?:ment)?|drop|susp(?:ension)?)'
    r'\.?\s+([A-Za-z][A-Za-z\-]{2,}(?:\s+[A-Za-z\-]+)?)',
    re.IGNORECASE
)

# Minimum match threshold for medical safety
FUZZY_MATCH_THRESHOLD = 75


@dataclass
class ExtractionResult:
    """Extracted information from OCR text."""
    name_candidates: List[str] = field(default_factory=list)
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    expiry: Optional[str] = None
    db_matches: List[dict] = field(default_factory=list)
    best_match: Optional[dict] = None


def extract_candidates(text: str) -> ExtractionResult:
    """
    Extract medicine information from OCR text using regex.
    
    Args:
        text: Raw OCR text
    
    Returns:
        ExtractionResult with name candidates, dosage, frequency, expiry
    """
    result = ExtractionResult()

    if not text or len(text.strip()) < 2:
        return result

    # Extract dosage
    dosage_match = DOSAGE_PATTERN.search(text)
    if dosage_match:
        result.dosage = dosage_match.group(0).strip()

    # Extract frequency
    freq_match = FREQUENCY_PATTERN.search(text)
    if freq_match:
        result.frequency = freq_match.group(0).strip()

    # Extract expiry
    exp_match = EXPIRY_PATTERN.search(text)
    if exp_match:
        result.expiry = exp_match.group(1).strip()

    # Extract name candidates
    # Method 1: After medicine prefixes (Tab, Cap, Syrup, etc.)
    prefix_matches = MED_PREFIX_PATTERN.findall(text)
    for match in prefix_matches:
        name = match.strip()
        if len(name) >= 2 and name not in result.name_candidates:
            result.name_candidates.append(name)

    # Method 2: Significant words (capitalized, >3 chars, not common words)
    common_words = {
        'tablet', 'capsule', 'syrup', 'cream', 'dose', 'take',
        'after', 'before', 'food', 'meals', 'daily', 'times',
        'days', 'morning', 'night', 'every', 'hours', 'with',
        'water', 'doctor', 'patient', 'date', 'name', 'prescription',
        'medicine', 'drug', 'pharmacy', 'store', 'from', 'the',
    }
    words = re.findall(r'\b[A-Za-z][A-Za-z\-]{2,}\b', text)
    for word in words:
        if (word.lower() not in common_words
                and word not in result.name_candidates
                and len(word) >= 3):
            result.name_candidates.append(word)

    return result


def match_against_database(candidates: List[str],
                            drug_names: List[str],
                            brand_to_generic: dict = None) -> List[dict]:
    """
    Match extracted candidates against DrugLookup database using RapidFuzz.
    4-tier matching: Exact → Prefix → Token similarity → Synonym lookup.
    
    Args:
        candidates: List of medicine name candidates from OCR
        drug_names: List of known drug names from database (lowercase)
        brand_to_generic: Optional brand → generic mapping for synonym lookup
    
    Returns:
        List of match results sorted by score (descending)
    """
    try:
        from rapidfuzz import fuzz, process
    except ImportError:
        logger.warning("RapidFuzz not installed — fuzzy matching unavailable")
        return []

    all_matches = []
    seen_names = set()

    for candidate in candidates:
        candidate_clean = candidate.strip().lower()
        if not candidate_clean or len(candidate_clean) < 2:
            continue

        # Tier 1: Exact match
        if candidate_clean in [d.lower() for d in drug_names]:
            exact = next(d for d in drug_names if d.lower() == candidate_clean)
            if exact not in seen_names:
                all_matches.append({
                    'name': exact,
                    'score': 100.0,
                    'match_tier': 'exact',
                    'source_candidate': candidate,
                })
                seen_names.add(exact)
            continue

        # Tier 2: Prefix match (starts-with)
        prefix_matches = [d for d in drug_names if d.lower().startswith(candidate_clean)]
        for pm in prefix_matches[:3]:  # Top 3 prefix matches
            if pm not in seen_names:
                score = fuzz.ratio(candidate_clean, pm.lower())
                if score >= FUZZY_MATCH_THRESHOLD:
                    all_matches.append({
                        'name': pm,
                        'score': float(score),
                        'match_tier': 'prefix',
                        'source_candidate': candidate,
                    })
                    seen_names.add(pm)

        # Tier 3: Token set similarity (handles partial matches)
        results = process.extract(
            candidate_clean,
            drug_names,
            scorer=fuzz.token_set_ratio,
            limit=5,
            score_cutoff=FUZZY_MATCH_THRESHOLD,
        )
        for name, score, _ in results:
            if name not in seen_names:
                all_matches.append({
                    'name': name,
                    'score': float(score),
                    'match_tier': 'fuzzy',
                    'source_candidate': candidate,
                })
                seen_names.add(name)

        # Tier 4: Synonym lookup (brand ↔ generic)
        if brand_to_generic:
            for brand, generic in brand_to_generic.items():
                if brand.lower() not in seen_names:
                    gen_score = fuzz.ratio(candidate_clean, generic.lower())
                    if gen_score >= FUZZY_MATCH_THRESHOLD:
                        all_matches.append({
                            'name': brand,
                            'score': float(gen_score),
                            'match_tier': 'synonym',
                            'source_candidate': candidate,
                            'matched_generic': generic,
                        })
                        seen_names.add(brand.lower())

    # Sort by score (descending)
    all_matches.sort(key=lambda m: m['score'], reverse=True)

    return all_matches
