"""
MediScan — Stages 7 & 8: Confidence Fusion + Top-K Output
===========================================================
Merges OCR and CNN results using threshold-based decision logic.
Returns Top-K ranked candidates per region.
"""

import logging
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════
# Fusion Thresholds
# ═══════════════════════════════════════════════════════════════════
OCR_THRESHOLD = 0.75       # OCR considered "strong" above this
CNN_THRESHOLD = 0.80       # CNN considered "strong" above this
BOOST_FACTOR = 1.10        # Confidence boost when both agree
LOW_CUTOFF = 0.50          # Below this = very low confidence
TOP_K = 3                  # Number of final candidates to return


@dataclass
class Candidate:
    """A single medicine candidate with metadata."""
    name: str
    confidence: float
    source: str  # 'ocr', 'cnn', 'fusion', 'db_match'

    def to_dict(self):
        return {
            'name': self.name,
            'confidence': round(self.confidence, 4),
            'source': self.source,
        }


@dataclass
class FusionResult:
    """Result of confidence fusion for a single region."""
    region_id: int
    final_prediction: Optional[str] = None
    confidence: float = 0.0
    confidence_level: str = 'LOW'          # HIGH, MEDIUM, LOW, VERY_LOW
    source: str = 'none'                   # ocr, cnn, fusion, manual
    top_candidates: List[dict] = field(default_factory=list)
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    db_match: Optional[dict] = None

    def to_dict(self):
        result = {
            'region_id': self.region_id,
            'final_prediction': self.final_prediction,
            'confidence': round(self.confidence, 4),
            'confidence_level': self.confidence_level,
            'source': self.source,
            'top_candidates': self.top_candidates,
        }
        if self.dosage:
            result['dosage'] = self.dosage
        if self.frequency:
            result['frequency'] = self.frequency
        if self.db_match:
            result['db_match'] = self.db_match
        return result


def classify_confidence_level(confidence: float) -> str:
    """Map confidence score to human-readable level."""
    if confidence >= 0.90:
        return 'HIGH'
    elif confidence >= 0.75:
        return 'MEDIUM'
    elif confidence >= LOW_CUTOFF:
        return 'LOW'
    else:
        return 'VERY_LOW'


def fuse_results(
    region_id: int,
    ocr_name: Optional[str] = None,
    ocr_confidence: float = 0.0,
    cnn_predictions: Optional[List[dict]] = None,
    db_matches: Optional[List[dict]] = None,
    dosage: Optional[str] = None,
    frequency: Optional[str] = None,
    db_details: Optional[dict] = None,
) -> FusionResult:
    """
    Fuse OCR and CNN results using threshold-based decision logic.
    
    Strategy:
    - Both agree → BOOST confidence (high trust)
    - One strong, other weak → Trust the strong one
    - Both moderate, disagree → Return ranked candidate list
    - Both weak → Suggest manual entry
    
    Args:
        region_id: Identifier for the text region
        ocr_name: Best OCR match name
        ocr_confidence: OCR match confidence (0-1)
        cnn_predictions: CNN top-K predictions [{name, confidence}]
        db_matches: Database fuzzy match results [{name, score}]
        dosage: Extracted dosage string
        frequency: Extracted frequency string
        db_details: Full database record for matched drug
    
    Returns:
        FusionResult with final prediction, confidence, and ranked candidates
    """
    result = FusionResult(region_id=region_id, dosage=dosage, frequency=frequency)
    candidates = []

    cnn_name = None
    cnn_confidence = 0.0
    if cnn_predictions and len(cnn_predictions) > 0:
        cnn_name = cnn_predictions[0]['name']
        cnn_confidence = cnn_predictions[0]['confidence']

    # ── Case 1: Both OCR and CNN agree ─────────────────────────
    if ocr_name and cnn_name and ocr_name.lower() == cnn_name.lower():
        avg_conf = (ocr_confidence + cnn_confidence) / 2
        boosted = min(avg_conf * BOOST_FACTOR, 1.0)

        result.final_prediction = ocr_name
        result.confidence = boosted
        result.source = 'fusion'
        result.confidence_level = classify_confidence_level(boosted)

        candidates.append(Candidate(ocr_name, boosted, 'fusion').to_dict())
        logger.info(f"Region {region_id}: OCR+CNN agree on '{ocr_name}' → boosted {boosted:.3f}")

    # ── Case 2: Strong OCR, weak/no CNN ────────────────────────
    elif ocr_confidence >= OCR_THRESHOLD and cnn_confidence < CNN_THRESHOLD:
        result.final_prediction = ocr_name
        result.confidence = ocr_confidence
        result.source = 'ocr'
        result.confidence_level = classify_confidence_level(ocr_confidence)

        candidates.append(Candidate(ocr_name, ocr_confidence, 'ocr').to_dict())

    # ── Case 3: Strong CNN, weak/no OCR ────────────────────────
    elif cnn_confidence >= CNN_THRESHOLD and ocr_confidence < OCR_THRESHOLD:
        result.final_prediction = cnn_name
        result.confidence = cnn_confidence
        result.source = 'cnn'
        result.confidence_level = classify_confidence_level(cnn_confidence)

        candidates.append(Candidate(cnn_name, cnn_confidence, 'cnn').to_dict())

    # ── Case 4: Moderate disagreement ──────────────────────────
    elif ocr_confidence >= LOW_CUTOFF or cnn_confidence >= LOW_CUTOFF:
        # Pick the stronger one as primary
        if ocr_confidence >= cnn_confidence and ocr_name:
            result.final_prediction = ocr_name
            result.confidence = ocr_confidence
            result.source = 'ocr'
        elif cnn_name:
            result.final_prediction = cnn_name
            result.confidence = cnn_confidence
            result.source = 'cnn'

        result.confidence_level = 'LOW'

        # Add both as candidates
        if ocr_name:
            candidates.append(Candidate(ocr_name, ocr_confidence, 'ocr').to_dict())
        if cnn_name and cnn_name != ocr_name:
            candidates.append(Candidate(cnn_name, cnn_confidence, 'cnn').to_dict())

    # ── Case 5: Both weak → manual entry ───────────────────────
    else:
        result.final_prediction = None
        result.confidence = max(ocr_confidence, cnn_confidence)
        result.source = 'manual'
        result.confidence_level = 'VERY_LOW'

    # Add remaining CNN predictions as candidates
    if cnn_predictions:
        for pred in cnn_predictions[1:]:  # Skip first (already added)
            if not any(c['name'] == pred['name'] for c in candidates):
                candidates.append(Candidate(pred['name'], pred['confidence'], 'cnn').to_dict())

    # Add DB matches as candidates
    if db_matches:
        for match in db_matches[:TOP_K]:
            score = match['score'] / 100.0  # Normalize 0-100 → 0-1
            if not any(c['name'] == match['name'] for c in candidates):
                candidates.append(Candidate(match['name'], score, 'db_match').to_dict())

    # Sort candidates by confidence and take top K
    candidates.sort(key=lambda c: c['confidence'], reverse=True)
    result.top_candidates = candidates[:TOP_K]

    # Attach DB details if available
    result.db_match = db_details

    return result


def build_no_match_response(quality_info: dict, raw_text: str, model_version: str) -> dict:
    """Build response when no medicine is detected with sufficient confidence."""
    return {
        'status': 'no_match',
        'model_version': model_version,
        'message': 'Unable to identify medicine — please retake the image with clearer text.',
        'quality': quality_info,
        'raw_text': raw_text,
        'medicines': [],
        'processing_ms': 0,
    }
