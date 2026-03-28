"""
Medicine Extractor Module
Combines:
  1. Regex patterns  — dosage, frequency, expiry, tablet/cap/syrup prefixes
  2. MySQL DB lookup — fuzzy match against 2 lakh medicine names
"""

import re
import difflib
from typing import Optional
import mysql.connector


# ─────────────────────────────────────────────
# REGEX PATTERNS
# ─────────────────────────────────────────────

# Tablet/Capsule/Syrup prefix indicators
PREFIX_PATTERN = re.compile(
    r'\b(tab(?:let)?s?|cap(?:sule)?s?|syr(?:up)?|inj(?:ection)?|oint(?:ment)?|drop|cream|gel|spray)\b',
    re.IGNORECASE
)

# Dosage: 500mg, 10ml, 2.5mg, 250 mg
DOSAGE_PATTERN = re.compile(
    r'\b(\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|iu|%|units?))\b',
    re.IGNORECASE
)

# Frequency: 1-0-1, 1-1-1, 0-0-1, OD, BD, TDS, QID, SOS
FREQUENCY_PATTERN = re.compile(
    r'\b(\d-\d-\d|\d-\d-\d-\d|OD|BD|TDS|QID|SOS|PRN|once daily|twice daily|thrice daily|at night|morning)\b',
    re.IGNORECASE
)

# Expiry: Exp: 12/2026, EXP 06/25, Expiry: Jan 2025
EXPIRY_PATTERN = re.compile(
    r'\b(?:exp(?:iry)?\.?|expiration|use\s+before)[:\s]*'
    r'(\d{1,2}[\/\-]\d{2,4}|\w{3,9}[\s\-]\d{4})\b',
    re.IGNORECASE
)

# Capture word after prefix (likely medicine name)
MEDICINE_LINE_PATTERN = re.compile(
    r'\b(?:tab(?:let)?s?|cap(?:sule)?s?|syr(?:up)?|inj(?:ection)?)\s+([A-Za-z][\w\s\-]{2,30}?)(?=\s+\d|\s*$)',
    re.IGNORECASE
)


# ─────────────────────────────────────────────
# EXTRACTOR CLASS
# ─────────────────────────────────────────────

class MedicineExtractor:
    def __init__(self, db_connection):
        self.conn           = db_connection
        self.medicine_names = []          # in-memory list for fuzzy matching
        self.medicine_count = 0
        self._load_medicines()

    def _load_medicines(self):
        """Load all medicine names from MySQL into memory for fast fuzzy matching."""
        try:
            cursor = self.conn.cursor()
            # ── Update table/column name to match your schema ──
            cursor.execute("SELECT id, name, generic_name, category FROM medicines")
            rows = cursor.fetchall()
            self.medicine_map = {
                row[1].lower(): {
                    "id":           row[0],
                    "name":         row[1],
                    "generic_name": row[2],
                    "category":     row[3],
                }
                for row in rows
            }
            self.medicine_names = list(self.medicine_map.keys())
            self.medicine_count = len(self.medicine_names)
            cursor.close()
        except Exception as e:
            print(f"[DB ERROR] Could not load medicines: {e}")
            self.medicine_map   = {}
            self.medicine_names = []
            self.medicine_count = 0

    # ── Main extraction pipeline ──
    def extract_all(self, raw_text: str) -> list:
        """
        Full extraction on raw OCR text.
        Returns a list of dicts, one per medicine line found.
        """
        lines   = [l.strip() for l in raw_text.splitlines() if l.strip()]
        results = []

        for line in lines:
            entry = self._extract_line(line)
            if entry:
                results.append(entry)

        # If line-by-line found nothing, try whole-text extraction
        if not results:
            entry = self._extract_line(raw_text, strict=False)
            if entry:
                results.append(entry)

        return results

    def _extract_line(self, text: str, strict: bool = True) -> Optional[dict]:
        """Extract medicine info from a single line of text."""
        dosages     = DOSAGE_PATTERN.findall(text)
        frequencies = FREQUENCY_PATTERN.findall(text)
        expiries    = EXPIRY_PATTERN.findall(text)

        # Try to get candidate medicine name
        candidate = self._extract_candidate_name(text)
        if not candidate and strict:
            return None

        # Fuzzy match candidate against DB
        matched = self._fuzzy_match(candidate) if candidate else None

        # Only return if we found a medicine name or dosage
        if not matched and not dosages and strict:
            return None

        return {
            "raw_line":     text,
            "candidate":    candidate,
            "matched_medicine": matched,
            "dosage":       dosages[0]    if dosages     else None,
            "all_dosages":  dosages,
            "frequency":    frequencies[0].upper() if frequencies else None,
            "expiry":       expiries[0]   if expiries    else None,
        }

    def _extract_candidate_name(self, text: str) -> Optional[str]:
        """
        Extract the most likely medicine name from text.
        Strategy:
          1. Word after Tab/Cap/Syrup prefix (prescription format)
          2. Longest alphabetic token (tablet cover format)
        """
        # Strategy 1: prefix-based
        match = MEDICINE_LINE_PATTERN.search(text)
        if match:
            return match.group(1).strip()

        # Strategy 2: remove known non-name tokens, pick longest word
        cleaned = DOSAGE_PATTERN.sub("", text)
        cleaned = FREQUENCY_PATTERN.sub("", cleaned)
        cleaned = EXPIRY_PATTERN.sub("", cleaned)
        cleaned = PREFIX_PATTERN.sub("", cleaned)

        tokens = re.findall(r'[A-Za-z]{3,}', cleaned)
        if tokens:
            # Prefer longer tokens — medicine names tend to be longer
            tokens.sort(key=len, reverse=True)
            return tokens[0]

        return None

    def _fuzzy_match(self, candidate: str, threshold: float = 0.6) -> Optional[dict]:
        """
        Match candidate string against the 2-lakh medicine name list.
        Uses difflib for fast fuzzy matching.
        Returns best match above threshold.
        """
        if not candidate or not self.medicine_names:
            return None

        candidate_lower = candidate.lower().strip()

        # 1. Exact match (fastest)
        if candidate_lower in self.medicine_map:
            return self.medicine_map[candidate_lower]

        # 2. Starts-with match
        starters = [n for n in self.medicine_names if n.startswith(candidate_lower[:4])]

        # 3. Fuzzy match on narrowed list (or full list if no starters)
        search_space = starters if starters else self.medicine_names
        matches = difflib.get_close_matches(
            candidate_lower,
            search_space,
            n=1,
            cutoff=threshold
        )

        if matches:
            best = matches[0]
            score = difflib.SequenceMatcher(None, candidate_lower, best).ratio()
            result = dict(self.medicine_map[best])
            result["match_score"] = round(score * 100, 1)
            return result

        return None

    def search_by_name(self, query: str, limit: int = 10) -> list:
        """
        Search medicines by partial name — for manual lookup endpoint.
        Queries DB directly with LIKE for fresh results.
        """
        try:
            cursor = self.conn.cursor()
            cursor.execute(
                "SELECT id, name, generic_name, category "
                "FROM medicines WHERE name LIKE %s LIMIT %s",
                (f"%{query}%", limit)
            )
            rows = cursor.fetchall()
            cursor.close()
            return [
                {"id": r[0], "name": r[1], "generic_name": r[2], "category": r[3]}
                for r in rows
            ]
        except Exception as e:
            print(f"[DB ERROR] search_by_name: {e}")
            return []
