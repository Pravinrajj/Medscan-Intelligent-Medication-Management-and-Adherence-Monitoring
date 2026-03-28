"""
MediScan OCR — OCR Extraction Module (v3)
==========================================
Uses EasyOCR for text extraction from prescription images.
The EasyOCR Reader model is loaded once globally to avoid expensive
reinitialization on every API request.

Optimized for handwritten prescriptions:
  - LOW confidence threshold (0.1) to maximize recall
  - Returns all detections with bounding boxes for downstream filtering
  - No premature text joining — individual segments preserved
"""

import numpy as np
import logging
from typing import Optional, List
from dataclasses import dataclass, field

from filter import OCRDetection

logger = logging.getLogger("mediscan.ocr")

# ═══════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════

# Minimum OCR confidence to include a detection.
# Set LOW (0.1) to maximize recall from noisy handwritten text.
# Precision is improved via downstream cleaning + keyword filtering.
MIN_CONFIDENCE = 0.1

# Global EasyOCR Reader (loaded once at startup)
_reader = None


@dataclass
class OCRResult:
    """
    Complete OCR extraction result for a single image.
    Contains structured per-detection data with bounding boxes.
    """
    raw_text: str                          # All text joined (unfiltered)
    detections: List[OCRDetection]         # Per-detection with bbox
    avg_confidence: float
    min_confidence: float
    max_confidence: float
    detection_count: int


# ═══════════════════════════════════════════════════════════════════
# Model Management
# ═══════════════════════════════════════════════════════════════════

def load_ocr_model(gpu: bool = False) -> bool:
    """
    Load the EasyOCR Reader model globally.
    Should be called once at application startup.

    Args:
        gpu: Whether to use GPU acceleration (requires CUDA)

    Returns:
        True if model loaded successfully, False otherwise
    """
    global _reader
    try:
        import easyocr
        _reader = easyocr.Reader(
            ['en'],
            gpu=gpu,
            verbose=False
        )
        logger.info(
            f"EasyOCR Reader loaded (GPU={'enabled' if gpu else 'disabled'}, "
            f"min_confidence={MIN_CONFIDENCE})"
        )
        return True
    except ImportError:
        logger.error("EasyOCR is not installed. Run: pip install easyocr")
        return False
    except Exception as e:
        logger.error(f"Failed to load EasyOCR model: {e}")
        return False


def is_model_loaded() -> bool:
    """Check if the OCR model is currently loaded."""
    return _reader is not None


# ═══════════════════════════════════════════════════════════════════
# Text Extraction
# ═══════════════════════════════════════════════════════════════════

def extract_text(image: np.ndarray) -> Optional[OCRResult]:
    """
    Extract text from an image using EasyOCR with a low confidence
    threshold to maximize recall from handwritten prescriptions.

    Args:
        image: Image as numpy array (BGR or grayscale)

    Returns:
        OCRResult with all detections above MIN_CONFIDENCE threshold.
        Returns None if model not loaded or extraction fails.
    """
    if _reader is None:
        logger.error("OCR model not loaded — call load_ocr_model() first")
        return None

    try:
        # Run EasyOCR with low_text threshold for better handwriting detection
        results = _reader.readtext(
            image,
            detail=1,           # Full results with bboxes
            paragraph=False,    # Keep individual segments
            low_text=0.3,       # Lower text detection threshold
        )

        if not results:
            logger.warning("EasyOCR returned no text from image")
            return OCRResult(
                raw_text="", detections=[],
                avg_confidence=0.0, min_confidence=0.0,
                max_confidence=0.0, detection_count=0
            )

        # Build detection list — keep ALL detections above MIN_CONFIDENCE
        detections = []
        texts = []
        confidences = []

        for (bbox, text, confidence) in results:
            text = text.strip()
            confidence = float(confidence)

            # Skip empty detections and very low confidence garbage
            if not text or confidence < MIN_CONFIDENCE:
                logger.debug(
                    f"  Skipped: '{text}' (conf={confidence:.3f} < {MIN_CONFIDENCE})"
                )
                continue

            bbox_int = [
                [int(point[0]), int(point[1])]
                for point in bbox
            ]

            detection = OCRDetection(
                text=text,
                confidence=round(confidence, 4),
                bbox=bbox_int,
                y_center=0.0  # Computed by filter module
            )
            detections.append(detection)
            texts.append(text)
            confidences.append(confidence)

        raw_text = " ".join(texts)
        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
        min_conf = min(confidences) if confidences else 0.0
        max_conf = max(confidences) if confidences else 0.0

        result = OCRResult(
            raw_text=raw_text,
            detections=detections,
            avg_confidence=round(avg_conf, 4),
            min_confidence=round(min_conf, 4),
            max_confidence=round(max_conf, 4),
            detection_count=len(detections)
        )

        logger.info(
            f"OCR extracted {result.detection_count} detections "
            f"(min_conf_threshold={MIN_CONFIDENCE}, "
            f"avg_conf={result.avg_confidence:.3f})"
        )
        return result

    except Exception as e:
        logger.error(f"OCR extraction failed: {e}")
        return None
