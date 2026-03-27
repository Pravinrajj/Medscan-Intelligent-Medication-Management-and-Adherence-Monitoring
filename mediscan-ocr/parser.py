"""
MediScan OCR — Prescription Text Parser (v3)
==============================================
Parses cleaned and grouped OCR text lines into structured medicine data.
Optimized for noisy handwritten prescription output:

  - Handles fragmented/garbled text after cleaning
  - Extracts medicine name, dosage, frequency from grouped lines
  - Preserves multiple medicines across different lines
  - Relaxed regex patterns for noisy input
  - Fuzzy medicine name correction via curated dictionary
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
    corrected_name: Optional[str] = None
    raw_line: Optional[str] = None  # Source line for debugging

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
        if self.raw_line:
            result["raw_line"] = self.raw_line
        return result


# ═══════════════════════════════════════════════════════════════════
# Regex Patterns (relaxed for noisy input)
# ═══════════════════════════════════════════════════════════════════

# Drug form prefix — also matches common OCR garble (T4b, C4p, etc.)
DRUG_PREFIX = (
    r'(?:tab(?:let)?|cap(?:sule)?|syrup|syr|inj(?:ection)?|'
    r'cream|oint(?:ment)?|drops?|susp(?:ension)?|gel|lotion|spray)'
)

# Medicine prefix pattern: "Tab " followed by medicine name
MED_PREFIX_PATTERN = re.compile(
    DRUG_PREFIX + r'\.?\s+([A-Za-z][A-Za-z\-]{1,}(?:\s+[A-Za-z\-]+)?)',
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

# Frequency text: "once daily", "twice a day", etc.
FREQ_TEXT_PATTERN = re.compile(
    r'\b(once|twice|thrice|one\s+time|two\s+times?|three\s+times?|four\s+times?)'
    r'\s*(?:a\s+)?(?:daily|a\s+day|per\s+day)\b',
    re.IGNORECASE
)

# Full medicine line (relaxed): "Tab Paracetamol 500mg BD"
FULL_LINE_PATTERN = re.compile(
    DRUG_PREFIX +
    r'\.?\s+'
    r'([A-Za-z][A-Za-z\-]+(?:\s+[A-Za-z\-]+)?)'        # Medicine name
    r'(?:\s+(\d+(?:\.\d+)?\s*(?:mg|ml|mcg|g|iu|%|units?)))?'  # Optional dosage
    r'(?:\s+(OD|BD|BID|TDS|TID|QID|QD|PRN|SOS|HS|STAT|'
    r'\d[\-\+]\d[\-\+]\d|'
    r'once\s+daily|twice\s+daily|thrice\s+daily))?',     # Optional frequency
    re.IGNORECASE
)

# Standalone medicine name pattern (no prefix required)
# Matches capitalized words that look like drug names (4+ chars, starts with uppercase)
STANDALONE_NAME_PATTERN = re.compile(
    r'\b([A-Z][a-z]{3,}(?:\s+[A-Z][a-z]+)?)\b'
)


# ═══════════════════════════════════════════════════════════════════
# Frequency Normalization
# ═══════════════════════════════════════════════════════════════════

FREQUENCY_MAP = {
    "od": "1 time/day", "qd": "1 time/day",
    "bd": "2 times/day", "bid": "2 times/day",
    "tds": "3 times/day", "tid": "3 times/day",
    "qid": "4 times/day",
    "prn": "As needed", "sos": "As needed",
    "hs": "At bedtime",
    "ac": "Before meals", "pc": "After meals",
    "stat": "Immediately",
    "once daily": "1 time/day", "twice daily": "2 times/day",
    "thrice daily": "3 times/day",
    "once a day": "1 time/day", "twice a day": "2 times/day",
    "two times": "2 times/day", "three times": "3 times/day",
    "four times": "4 times/day", "one time": "1 time/day",
}


def normalize_frequency(raw_freq: str) -> str:
    """Normalize frequency abbreviations to human-readable form."""
    if not raw_freq:
        return raw_freq
    cleaned = raw_freq.strip().lower()
    if cleaned in FREQUENCY_MAP:
        return FREQUENCY_MAP[cleaned]

    numeric_match = FREQ_NUMERIC_PATTERN.match(raw_freq)
    if numeric_match:
        pattern = numeric_match.group(1)
        parts = re.split(r'[\-\+]', pattern)
        total_doses = sum(int(p) for p in parts if p.isdigit())
        return f"{total_doses} times/day ({pattern})"

    return raw_freq


# ═══════════════════════════════════════════════════════════════════
# Medicine Name Dictionary
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
    "Cefpodoxime", "Ondansetron", "Spironolactone",
    "Metronidazole", "Ceftriaxone", "Ampicillin", "Clonazepam",
    "Diazepam", "Alprazolam", "Lorazepam", "Phenytoin",
    "Carbamazepine", "Valproate", "Levetiracetam", "Topiramate",
]


def correct_medicine_name(name: str) -> Optional[str]:
    """
    Correct OCR-garbled medicine name using curated dictionary.
    Uses relaxed matching (threshold 0.60) for noisy handwritten input.
    """
    if not name or len(name) < 3:
        return None
    name_lower = name.strip().lower()

    # Exact match
    for med in COMMON_MEDICINES:
        if med.lower() == name_lower:
            return med

    # Prefix match (3+ chars for noisy input)
    if len(name_lower) >= 3:
        for med in COMMON_MEDICINES:
            if med.lower().startswith(name_lower[:3]):
                sim = _similarity(name_lower, med.lower())
                if sim >= 0.55:
                    return med

    # Fuzzy match with relaxed threshold for noisy OCR
    best_match = None
    best_score = 0.0
    for med in COMMON_MEDICINES:
        score = _similarity(name_lower, med.lower())
        if score > best_score:
            best_score = score
            best_match = med

    if best_score >= 0.60:
        return best_match
    return None


def _similarity(a: str, b: str) -> float:
    """Bigram Jaccard similarity (0.0 to 1.0)."""
    if not a or not b:
        return 0.0
    bigrams_a = set(a[i:i+2] for i in range(len(a) - 1))
    bigrams_b = set(b[i:i+2] for i in range(len(b) - 1))
    if not bigrams_a or not bigrams_b:
        return 1.0 if a == b else 0.0
    intersection = bigrams_a & bigrams_b
    union = bigrams_a | bigrams_b
    return len(intersection) / len(union)


# ═══════════════════════════════════════════════════════════════════
# Main Parsing — Line-by-Line Strategy
# ═══════════════════════════════════════════════════════════════════

def parse_lines(lines: list) -> List[MedicineEntry]:
    """
    Parse grouped and cleaned text lines into structured medicine entries.

    PRIMARY entry point (v3) — processes each line independently so
    multiple medicines are preserved even from noisy OCR.

    Strategy per line:
        1. Try full-line regex (prefix + name + dosage + freq)
        2. Fall back to individual component extraction
        3. Fall back to standalone name matching + dictionary correction
        4. Extract dosage/frequency from anywhere in the line

    Args:
        lines: List of TextLine objects from cleaner.group_into_lines()

    Returns:
        List of MedicineEntry objects (one per medicine found)
    """
    if not lines:
        logger.warning("No lines to parse")
        return []

    all_medicines = []

    for line in lines:
        text = line.text
        confidence = line.avg_confidence

        logger.info(f"Parsing line: '{text}' (conf={confidence:.3f})")

        # Try parsing this line
        entries = _parse_single_line(text, confidence)

        if entries:
            for e in entries:
                e.raw_line = text
            all_medicines.extend(entries)

    # Deduplicate
    all_medicines = _deduplicate(all_medicines)

    logger.info(f"Parsing complete: {len(all_medicines)} medicine(s) from {len(lines)} lines")
    return all_medicines


def parse_filtered_results(filtered_detections: list,
                           filtered_text: str) -> List[MedicineEntry]:
    """
    LEGACY entry point — works with raw filtered detections.
    For backward compatibility; new pipeline should use parse_lines().
    """
    if not filtered_text or len(filtered_text.strip()) < 3:
        return []

    confidence_map = {}
    for det in filtered_detections:
        for word in det.text.split():
            word_clean = word.strip().lower()
            if word_clean:
                confidence_map[word_clean] = det.confidence

    medicines = _parse_text_legacy(filtered_text, confidence_map)
    return _deduplicate(medicines)


def _parse_single_line(text: str, confidence: float) -> List[MedicineEntry]:
    """Parse a single text line into medicine entries."""
    medicines = []

    # ─── Strategy 1: Full-line pattern ─────────────────────────
    for match in FULL_LINE_PATTERN.finditer(text):
        name = match.group(1).strip() if match.group(1) else None
        dosage = match.group(2).strip() if match.group(2) else None
        freq = match.group(3).strip() if match.group(3) else None

        if name and len(name) >= 3:
            corrected = correct_medicine_name(name)
            entry = MedicineEntry(
                medicine=corrected if corrected else name,
                dosage=dosage,
                frequency=normalize_frequency(freq) if freq else None,
                confidence=confidence,
                corrected_name=corrected,
            )
            medicines.append(entry)
            logger.info(f"  Full-line match: {entry.to_dict()}")

    if medicines:
        return medicines

    # ─── Strategy 2: Individual components ─────────────────────
    name_matches = MED_PREFIX_PATTERN.findall(text)
    dosage_matches = DOSAGE_PATTERN.findall(text)
    dosages = [f"{val}{unit}" for val, unit in dosage_matches]

    freq_abbrevs = FREQ_ABBREV_PATTERN.findall(text)
    freq_numerics = FREQ_NUMERIC_PATTERN.findall(text)
    freq_texts = FREQ_TEXT_PATTERN.findall(text)
    all_freqs = freq_abbrevs + freq_numerics + freq_texts

    if name_matches:
        for i, name in enumerate(name_matches):
            name = name.strip()
            if len(name) < 3:
                continue
            dosage = dosages[i] if i < len(dosages) else (dosages[0] if dosages else None)
            freq_raw = all_freqs[i] if i < len(all_freqs) else (all_freqs[0] if all_freqs else None)

            corrected = correct_medicine_name(name)
            entry = MedicineEntry(
                medicine=corrected if corrected else name,
                dosage=dosage,
                frequency=normalize_frequency(freq_raw) if freq_raw else None,
                confidence=confidence,
                corrected_name=corrected,
            )
            medicines.append(entry)
            logger.info(f"  Component match: {entry.to_dict()}")

        return medicines

    # ─── Strategy 3: Standalone name + dictionary match ────────
    # Look for capitalized words that match known medicines
    standalone_names = STANDALONE_NAME_PATTERN.findall(text)
    for name in standalone_names:
        name = name.strip()
        if len(name) < 4:
            continue
        corrected = correct_medicine_name(name)
        if corrected:
            dosage = dosages[0] if dosages else None
            freq_raw = all_freqs[0] if all_freqs else None
            entry = MedicineEntry(
                medicine=corrected,
                dosage=dosage,
                frequency=normalize_frequency(freq_raw) if freq_raw else None,
                confidence=confidence,
                corrected_name=corrected,
            )
            medicines.append(entry)
            logger.info(f"  Standalone match: {entry.to_dict()}")

    if medicines:
        return medicines

    # ─── Strategy 4: Significant word fallback ─────────────────
    if dosages or all_freqs:
        significant = _extract_significant_words(text)
        for word in significant[:2]:
            corrected = correct_medicine_name(word)
            entry = MedicineEntry(
                medicine=corrected if corrected else word,
                dosage=dosages[0] if dosages else None,
                frequency=normalize_frequency(all_freqs[0]) if all_freqs else None,
                confidence=confidence,
                corrected_name=corrected,
            )
            medicines.append(entry)
            logger.info(f"  Significant-word match: {entry.to_dict()}")

    return medicines


def _parse_text_legacy(text: str, confidence_map: dict) -> List[MedicineEntry]:
    """Legacy text parsing (for backward compat)."""
    medicines = []
    for match in FULL_LINE_PATTERN.finditer(text):
        name = match.group(1).strip() if match.group(1) else None
        dosage = match.group(2).strip() if match.group(2) else None
        freq = match.group(3).strip() if match.group(3) else None
        if name:
            corrected = correct_medicine_name(name)
            entry = MedicineEntry(
                medicine=corrected if corrected else name,
                dosage=dosage,
                frequency=normalize_frequency(freq) if freq else None,
                confidence=confidence_map.get(name.lower()),
                corrected_name=corrected,
            )
            medicines.append(entry)

    if not medicines:
        name_matches = MED_PREFIX_PATTERN.findall(text)
        dosage_matches = DOSAGE_PATTERN.findall(text)
        dosages = [f"{val}{unit}" for val, unit in dosage_matches]
        freq_all = FREQ_ABBREV_PATTERN.findall(text) + FREQ_NUMERIC_PATTERN.findall(text)

        for i, name in enumerate(name_matches):
            name = name.strip()
            corrected = correct_medicine_name(name)
            entry = MedicineEntry(
                medicine=corrected if corrected else name,
                dosage=dosages[i] if i < len(dosages) else None,
                frequency=normalize_frequency(freq_all[i]) if i < len(freq_all) else None,
                confidence=confidence_map.get(name.lower()),
                corrected_name=corrected,
            )
            medicines.append(entry)

    return medicines


def _extract_significant_words(text: str) -> List[str]:
    """Extract significant words that could be medicine names."""
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
    return [w for w in words if w.lower() not in STOP_WORDS and len(w) >= 4]


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
