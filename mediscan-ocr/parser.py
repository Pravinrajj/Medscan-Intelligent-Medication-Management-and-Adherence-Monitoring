"""
MediScan OCR — Prescription Text Parser
=========================================
Parses raw OCR text to extract structured medicine information:
  - Medicine name
  - Dosage (e.g., 500mg)
  - Frequency (e.g., twice daily → 2 times/day)

Uses regex patterns and rule-based NLP. Includes a curated medicine
dictionary for basic name correction via fuzzy matching.
"""

import re
import logging
from dataclasses import dataclass
from typing import List, Optional

logger = logging.getLogger("mediscan.parser")


# ═══════════════════════════════════════════════════════════════════
# Data Models
# ═══════════════════════════════════════════════════════════════════

@dataclass
class MedicineEntry:
    """Structured representation of a single medicine extracted from text."""
    medicine: str
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    confidence: Optional[float] = None
    corrected_name: Optional[str] = None  # If dictionary-corrected

    def to_dict(self) -> dict:
        result = {
            "medicine": self.medicine,
            "dosage": self.dosage,
            "frequency": self.frequency,
        }
        if self.confidence is not None:
            result["confidence"] = round(self.confidence, 4)
        if self.corrected_name and self.corrected_name != self.medicine:
            result["corrected_name"] = self.corrected_name
        return result


# ═══════════════════════════════════════════════════════════════════
# Regex Patterns
# ═══════════════════════════════════════════════════════════════════

# Medicine prefix pattern: Tab, Cap, Syrup, Inj, etc.
MED_PREFIX_PATTERN = re.compile(
    r'\b(?:tab(?:let)?|cap(?:sule)?|syrup|syr|inj(?:ection)?|'
    r'cream|oint(?:ment)?|drop|susp(?:ension)?|gel|lotion|spray)'
    r'\.?\s+'
    r'([A-Za-z][A-Za-z\-]{1,}(?:\s+[A-Za-z\-]+)?)',
    re.IGNORECASE
)

# Dosage: 500mg, 250 mg, 10ml, 0.5g, 5%, 100mcg, etc.
DOSAGE_PATTERN = re.compile(
    r'\b(\d+(?:\.\d+)?)\s*(mg|ml|mcg|g|iu|%|units?)\b',
    re.IGNORECASE
)

# Frequency abbreviations: OD, BD, TDS, QID, PRN, etc.
FREQ_ABBREV_PATTERN = re.compile(
    r'\b(OD|BD|BID|TDS|TID|QID|QD|PRN|SOS|HS|AC|PC|STAT)\b',
    re.IGNORECASE
)

# Frequency numeric: 1-0-1, 1+0+1, 0-0-1, etc.
FREQ_NUMERIC_PATTERN = re.compile(
    r'\b(\d[\-\+]\d[\-\+]\d)\b'
)

# Frequency text: "once daily", "twice a day", "three times daily", etc.
FREQ_TEXT_PATTERN = re.compile(
    r'\b(once|twice|thrice|one\s+time|two\s+times?|three\s+times?|four\s+times?)'
    r'\s*(?:a\s+)?(?:daily|a\s+day|per\s+day)\b',
    re.IGNORECASE
)

# Full medicine line: "Tab Paracetamol 500mg BD" (captures all in one shot)
FULL_LINE_PATTERN = re.compile(
    r'\b(?:tab(?:let)?|cap(?:sule)?|syrup|syr|inj(?:ection)?|cream|oint(?:ment)?|drop|susp(?:ension)?|gel)'
    r'\.?\s+'
    r'([A-Za-z][A-Za-z\-]+(?:\s+[A-Za-z\-]+)?)'  # Medicine name
    r'(?:\s+(\d+(?:\.\d+)?\s*(?:mg|ml|mcg|g|iu|%|units?)))?'  # Optional dosage
    r'(?:\s+(OD|BD|BID|TDS|TID|QID|QD|PRN|SOS|HS|\d[\-\+]\d[\-\+]\d|'
    r'once\s+daily|twice\s+daily|thrice\s+daily))?',  # Optional frequency
    re.IGNORECASE
)


# ═══════════════════════════════════════════════════════════════════
# Frequency Normalization
# ═══════════════════════════════════════════════════════════════════

FREQUENCY_MAP = {
    # Abbreviations → human-readable
    "od":     "1 time/day",
    "qd":     "1 time/day",
    "bd":     "2 times/day",
    "bid":    "2 times/day",
    "tds":    "3 times/day",
    "tid":    "3 times/day",
    "qid":    "4 times/day",
    "prn":    "As needed",
    "sos":    "As needed",
    "hs":     "At bedtime",
    "ac":     "Before meals",
    "pc":     "After meals",
    "stat":   "Immediately",

    # Text forms
    "once daily":    "1 time/day",
    "twice daily":   "2 times/day",
    "thrice daily":  "3 times/day",
    "once a day":    "1 time/day",
    "twice a day":   "2 times/day",
    "two times":     "2 times/day",
    "three times":   "3 times/day",
    "four times":    "4 times/day",
    "one time":      "1 time/day",
}


def normalize_frequency(raw_freq: str) -> str:
    """
    Convert frequency abbreviations/patterns to human-readable form.

    Examples:
        "BD"      → "2 times/day"
        "1-0-1"   → "Morning-Afternoon-Night: 1-0-1"
        "OD"      → "1 time/day"

    Args:
        raw_freq: Raw frequency string from OCR

    Returns:
        Normalized frequency string
    """
    if not raw_freq:
        return raw_freq

    cleaned = raw_freq.strip().lower()

    # Check abbreviation map
    if cleaned in FREQUENCY_MAP:
        return FREQUENCY_MAP[cleaned]

    # Handle numeric pattern (1-0-1, 1+0+1, etc.)
    numeric_match = FREQ_NUMERIC_PATTERN.match(raw_freq)
    if numeric_match:
        pattern = numeric_match.group(1)
        # Count total doses
        parts = re.split(r'[\-\+]', pattern)
        total_doses = sum(int(p) for p in parts if p.isdigit())
        return f"{total_doses} times/day ({pattern})"

    return raw_freq


# ═══════════════════════════════════════════════════════════════════
# Medicine Name Dictionary (for basic correction)
# ═══════════════════════════════════════════════════════════════════

COMMON_MEDICINES = [
    "Paracetamol", "Amoxicillin", "Azithromycin", "Cetirizine",
    "Ciprofloxacin", "Clopidogrel", "Diclofenac", "Doxycycline",
    "Enalapril", "Fluconazole", "Glimepiride", "Ibuprofen",
    "Levofloxacin", "Lisinopril", "Losartan", "Metformin",
    "Metoprolol", "Montelukast", "Omeprazole", "Pantoprazole",
    "Ranitidine", "Rosuvastatin", "Atorvastatin", "Simvastatin",
    "Telmisartan", "Amlodipine", "Aspirin", "Atenolol",
    "Cefixime", "Cephalexin", "Chlorpheniramine", "Clindamycin",
    "Dexamethasone", "Domperidone", "Erythromycin", "Famotidine",
    "Furosemide", "Gabapentin", "Hydroxychloroquine", "Ketoconazole",
    "Loperamide", "Mefenamic Acid", "Naproxen", "Norfloxacin",
    "Ofloxacin", "Prednisolone", "Prednisone", "Salbutamol",
    "Sertraline", "Tramadol", "Valsartan", "Warfarin",
    "Aceclofenac", "Rabeprazole", "Esomeprazole", "Lansoprazole",
    "Levocetrizine", "Fexofenadine", "Pregabalin", "Duloxetine",
    "Cefpodoxime", "Ondansetron", "Ranitidine", "Spironolactone",
]


def correct_medicine_name(name: str) -> Optional[str]:
    """
    Attempt to correct an OCR-extracted medicine name by matching
    against a curated dictionary of common medicines.

    Uses case-insensitive prefix matching and Levenshtein-like
    similarity (simple character-overlap ratio).

    Args:
        name: Raw medicine name from OCR

    Returns:
        Corrected medicine name, or None if no close match found
    """
    if not name or len(name) < 3:
        return None

    name_lower = name.strip().lower()

    # Exact match (case-insensitive)
    for med in COMMON_MEDICINES:
        if med.lower() == name_lower:
            return med

    # Prefix match (at least 4 characters)
    if len(name_lower) >= 4:
        for med in COMMON_MEDICINES:
            if med.lower().startswith(name_lower[:4]):
                # Ensure reasonable similarity
                similarity = _similarity(name_lower, med.lower())
                if similarity >= 0.70:
                    return med

    # Fuzzy similarity match
    best_match = None
    best_score = 0.0

    for med in COMMON_MEDICINES:
        score = _similarity(name_lower, med.lower())
        if score > best_score:
            best_score = score
            best_match = med

    if best_score >= 0.75:
        return best_match

    return None


def _similarity(a: str, b: str) -> float:
    """
    Simple character-overlap similarity ratio (0.0 to 1.0).
    No external dependency needed — basic Jaccard on character bigrams.
    """
    if not a or not b:
        return 0.0

    # Generate character bigrams
    bigrams_a = set(a[i:i+2] for i in range(len(a) - 1))
    bigrams_b = set(b[i:i+2] for i in range(len(b) - 1))

    if not bigrams_a or not bigrams_b:
        return 1.0 if a == b else 0.0

    intersection = bigrams_a & bigrams_b
    union = bigrams_a | bigrams_b

    return len(intersection) / len(union)


# ═══════════════════════════════════════════════════════════════════
# Main Parsing Functions
# ═══════════════════════════════════════════════════════════════════

def parse_prescription_text(raw_text: str) -> List[MedicineEntry]:
    """
    Parse raw OCR text into structured medicine entries.

    Strategy:
        1. Try full-line pattern matching first (most accurate)
        2. Fall back to individual component extraction
        3. Apply medicine name dictionary correction
        4. Normalize frequency abbreviations

    Args:
        raw_text: Combined raw text from OCR extraction

    Returns:
        List of MedicineEntry objects with structured data
    """
    if not raw_text or len(raw_text.strip()) < 3:
        logger.warning("Empty or very short text — nothing to parse")
        return []

    logger.info(f"Parsing text ({len(raw_text)} chars): '{raw_text[:80]}...'")
    medicines = []
    used_spans = []  # Track already-matched text spans to avoid duplicates

    # ─── Strategy 1: Full-line pattern matching ───────────────
    for match in FULL_LINE_PATTERN.finditer(raw_text):
        name = match.group(1).strip() if match.group(1) else None
        dosage = match.group(2).strip() if match.group(2) else None
        frequency = match.group(3).strip() if match.group(3) else None

        if name:
            # Normalize frequency
            if frequency:
                frequency = normalize_frequency(frequency)

            # Try dictionary correction
            corrected = correct_medicine_name(name)

            entry = MedicineEntry(
                medicine=corrected if corrected else name,
                dosage=dosage,
                frequency=frequency,
                corrected_name=corrected
            )
            medicines.append(entry)
            used_spans.append(match.span())
            logger.info(f"Parsed (full-line): {entry.to_dict()}")

    # ─── Strategy 2: Individual component fallback ────────────
    # If full-line didn't find anything, try extracting components separately
    if not medicines:
        medicines = _parse_individual_components(raw_text)

    # Remove duplicates (same medicine name)
    medicines = _deduplicate(medicines)

    logger.info(f"Parsing complete: {len(medicines)} medicine(s) found")
    return medicines


def _parse_individual_components(raw_text: str) -> List[MedicineEntry]:
    """
    Extract medicine info by matching individual components
    (name, dosage, frequency) separately from the text.
    Used as fallback when full-line matching fails.
    """
    medicines = []

    # Extract all medicine names (after prefixes)
    name_matches = MED_PREFIX_PATTERN.findall(raw_text)

    # Extract dosages
    dosage_matches = DOSAGE_PATTERN.findall(raw_text)
    dosages = [f"{val}{unit}" for val, unit in dosage_matches]

    # Extract frequencies
    freq_abbrevs = FREQ_ABBREV_PATTERN.findall(raw_text)
    freq_numerics = FREQ_NUMERIC_PATTERN.findall(raw_text)
    freq_texts = FREQ_TEXT_PATTERN.findall(raw_text)
    all_freqs = freq_abbrevs + freq_numerics + freq_texts

    if name_matches:
        for i, name in enumerate(name_matches):
            name = name.strip()
            dosage = dosages[i] if i < len(dosages) else None
            freq_raw = all_freqs[i] if i < len(all_freqs) else None
            frequency = normalize_frequency(freq_raw) if freq_raw else None

            corrected = correct_medicine_name(name)
            entry = MedicineEntry(
                medicine=corrected if corrected else name,
                dosage=dosage,
                frequency=frequency,
                corrected_name=corrected
            )
            medicines.append(entry)
            logger.info(f"Parsed (component): {entry.to_dict()}")

    elif dosages or all_freqs:
        # We have dosage/frequency but no recognized medicine name
        # Try to find significant words as potential medicine names
        significant = _extract_significant_words(raw_text)
        for word in significant[:3]:  # Limit to top 3 candidates
            corrected = correct_medicine_name(word)
            entry = MedicineEntry(
                medicine=corrected if corrected else word,
                dosage=dosages[0] if dosages else None,
                frequency=normalize_frequency(all_freqs[0]) if all_freqs else None,
                corrected_name=corrected
            )
            medicines.append(entry)

    return medicines


def _extract_significant_words(text: str) -> List[str]:
    """
    Extract significant words that could be medicine names.
    Filters out common English words and prescription boilerplate.
    """
    STOP_WORDS = {
        "tablet", "capsule", "syrup", "cream", "gel", "lotion", "spray",
        "injection", "drop", "suspension", "ointment", "dose", "take",
        "after", "before", "food", "meals", "daily", "times", "days",
        "morning", "night", "evening", "every", "hours", "with", "water",
        "doctor", "patient", "date", "name", "prescription", "medicine",
        "drug", "pharmacy", "the", "and", "for", "from", "this", "that",
        "per", "day", "oral", "route", "qty", "quantity", "refill",
        "tab", "cap", "syr", "inj",
    }

    words = re.findall(r'\b[A-Za-z][A-Za-z\-]{2,}\b', text)
    significant = []

    for word in words:
        if (word.lower() not in STOP_WORDS
                and len(word) >= 4
                and word not in significant):
            significant.append(word)

    return significant


def _deduplicate(medicines: List[MedicineEntry]) -> List[MedicineEntry]:
    """Remove duplicate medicine entries (same name, case-insensitive)."""
    seen = set()
    unique = []
    for m in medicines:
        key = m.medicine.lower()
        if key not in seen:
            seen.add(key)
            unique.append(m)
    return unique
