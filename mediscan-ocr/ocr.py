"""
MediScan OCR — OCR Extraction Module
======================================
Uses EasyOCR for text extraction from preprocessed prescription images.
The EasyOCR Reader model is loaded once globally to avoid expensive
reinitialization on every API request.
"""

import numpy as np
import logging
from typing import Optional
from dataclasses import dataclass, field
from typing import List

logger = logging.getLogger("mediscan.ocr")

# ═══════════════════════════════════════════════════════════════════
# Global EasyOCR Reader (loaded once at startup)
# ═══════════════════════════════════════════════════════════════════

_reader = None  # Singleton EasyOCR Reader instance


@dataclass
class WordResult:
    """Individual word/phrase detected by OCR."""
    text: str
    confidence: float
    bounding_box: list = field(default_factory=list)


@dataclass
class OCRResult:
    """Complete OCR extraction result for a single image."""
    raw_text: str
    words: List[WordResult]
    avg_confidence: float
    min_confidence: float
    max_confidence: float
    word_count: int


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
            ['en'],           # Language(s) to support
            gpu=gpu,          # GPU acceleration flag
            verbose=False     # Suppress download/init logs
        )
        logger.info(f"EasyOCR Reader loaded successfully (GPU={'enabled' if gpu else 'disabled'})")
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
    Extract text from an image using EasyOCR.

    The function uses the globally loaded Reader instance to avoid
    model reloading per request. It returns both the combined raw text
    and per-word confidence scores.

    Args:
        image: Preprocessed image as numpy array (grayscale or BGR)

    Returns:
        OCRResult with raw text, word-level details, and confidence metrics.
        Returns None if the model is not loaded or extraction fails.
    """
    if _reader is None:
        logger.error("OCR model not loaded — call load_ocr_model() first")
        return None

    try:
        # EasyOCR readtext returns: list of (bbox, text, confidence)
        # detail=1 gives full results; paragraph=False keeps word-level output
        results = _reader.readtext(image, detail=1, paragraph=False)

        if not results:
            logger.warning("EasyOCR returned no text from image")
            return OCRResult(
                raw_text="",
                words=[],
                avg_confidence=0.0,
                min_confidence=0.0,
                max_confidence=0.0,
                word_count=0
            )

        # Parse individual word results
        words = []
        texts = []
        confidences = []

        for (bbox, text, confidence) in results:
            text = text.strip()
            if text:  # Skip empty detections
                words.append(WordResult(
                    text=text,
                    confidence=round(float(confidence), 4),
                    bounding_box=[list(map(int, point)) for point in bbox]
                ))
                texts.append(text)
                confidences.append(float(confidence))

        # Combine all text segments
        raw_text = " ".join(texts)
        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
        min_conf = min(confidences) if confidences else 0.0
        max_conf = max(confidences) if confidences else 0.0

        result = OCRResult(
            raw_text=raw_text,
            words=words,
            avg_confidence=round(avg_conf, 4),
            min_confidence=round(min_conf, 4),
            max_confidence=round(max_conf, 4),
            word_count=len(words)
        )

        logger.info(
            f"OCR extracted {result.word_count} words, "
            f"avg_confidence={result.avg_confidence:.3f}"
        )
        return result

    except Exception as e:
        logger.error(f"OCR extraction failed: {e}")
        return None
