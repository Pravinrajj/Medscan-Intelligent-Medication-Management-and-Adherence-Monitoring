"""
MediScan — Stage 4: OCR Text Extraction
========================================
Primary: EasyOCR (handles stylized fonts, multi-language)
Fallback: Tesseract (if EasyOCR returns <3 chars or confidence <40%)
Includes preprocessing: grayscale, CLAHE, denoise, threshold, deskew.
"""

import cv2
import numpy as np
from dataclasses import dataclass
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# Lazy-loaded OCR engines (loaded on first use)
_easyocr_reader = None
_easyocr_available = None

# OCR config
EASYOCR_MIN_CHARS = 3
EASYOCR_MIN_CONFIDENCE = 0.40
FALLBACK_TO_TESSERACT = True


@dataclass
class OcrResult:
    """Result of OCR text extraction for a single region."""
    text: str
    confidence: float
    engine: str  # 'easyocr' or 'tesseract'

    def to_dict(self):
        return {
            'text': self.text,
            'confidence': round(self.confidence, 4),
            'engine': self.engine,
        }


def _get_easyocr_reader():
    """Lazy-load EasyOCR reader (heavy initialization)."""
    global _easyocr_reader, _easyocr_available
    if _easyocr_available is None:
        try:
            import easyocr
            _easyocr_reader = easyocr.Reader(['en'], gpu=False, verbose=False)
            _easyocr_available = True
            logger.info("EasyOCR reader initialized (CPU mode)")
        except ImportError:
            _easyocr_available = False
            logger.warning("EasyOCR not installed — will use Tesseract only")
    return _easyocr_reader


def preprocess_for_ocr(image: np.ndarray) -> np.ndarray:
    """
    Preprocess image for better OCR accuracy.
    Pipeline: grayscale → CLAHE → denoise → threshold
    """
    # Convert to grayscale
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image.copy()

    # Upscale small images
    h, w = gray.shape[:2]
    if max(h, w) < 200:
        scale = 200 / max(h, w)
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    # CLAHE (Contrast Limited Adaptive Histogram Equalization)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    # Denoise
    gray = cv2.fastNlMeansDenoising(gray, h=10, templateWindowSize=7, searchWindowSize=21)

    # Adaptive threshold
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
    )

    return binary


def extract_text(image: np.ndarray) -> OcrResult:
    """
    Extract text from an image region using OCR.
    
    Strategy:
    1. Try EasyOCR first (better with stylized fonts)
    2. Fallback to Tesseract if EasyOCR fails or has low confidence
    
    Args:
        image: BGR or grayscale image region
    
    Returns:
        OcrResult with extracted text, confidence, and engine name
    """
    # Preprocess
    processed = preprocess_for_ocr(image)

    # Try EasyOCR first
    easyocr_result = _try_easyocr(image, processed)

    if easyocr_result and easyocr_result.confidence >= EASYOCR_MIN_CONFIDENCE \
            and len(easyocr_result.text.strip()) >= EASYOCR_MIN_CHARS:
        return easyocr_result

    # Fallback to Tesseract
    if FALLBACK_TO_TESSERACT:
        tess_result = _try_tesseract(processed)
        if tess_result:
            # Return better of the two, or Tesseract if EasyOCR failed
            if easyocr_result and easyocr_result.confidence > tess_result.confidence:
                return easyocr_result
            return tess_result

    # Return EasyOCR result even if low confidence (better than nothing)
    if easyocr_result:
        return easyocr_result

    return OcrResult(text="", confidence=0.0, engine="none")


def _try_easyocr(original: np.ndarray, processed: np.ndarray) -> Optional[OcrResult]:
    """Try EasyOCR text extraction."""
    reader = _get_easyocr_reader()
    if reader is None:
        return None

    try:
        # EasyOCR works better on original (color) images for stylized text
        results = reader.readtext(original, detail=1, paragraph=False)

        if not results:
            # Try on preprocessed image
            results = reader.readtext(processed, detail=1, paragraph=False)

        if not results:
            return None

        # Combine all detected text
        texts = []
        confidences = []
        for (bbox, text, conf) in results:
            texts.append(text)
            confidences.append(conf)

        combined_text = ' '.join(texts)
        avg_confidence = float(np.mean(confidences)) if confidences else 0.0

        return OcrResult(
            text=combined_text,
            confidence=avg_confidence,
            engine='easyocr'
        )
    except Exception as e:
        logger.warning(f"EasyOCR error: {e}")
        return None


def _try_tesseract(processed: np.ndarray) -> Optional[OcrResult]:
    """Try Tesseract OCR text extraction."""
    try:
        import pytesseract

        # Use LSTM engine + assume block of text
        custom_config = r'--oem 3 --psm 6'
        data = pytesseract.image_to_data(processed, config=custom_config, output_type=pytesseract.Output.DICT)

        texts = []
        confidences = []
        for i, conf in enumerate(data['conf']):
            conf_val = int(conf) if conf != '' else 0
            if conf_val > 20:  # Minimum Tesseract confidence
                word = data['text'][i].strip()
                if word:
                    texts.append(word)
                    confidences.append(conf_val / 100.0)

        if not texts:
            return None

        combined_text = ' '.join(texts)
        avg_confidence = float(np.mean(confidences)) if confidences else 0.0

        return OcrResult(
            text=combined_text,
            confidence=avg_confidence,
            engine='tesseract'
        )
    except ImportError:
        logger.warning("pytesseract not installed — Tesseract fallback unavailable")
        return None
    except Exception as e:
        logger.warning(f"Tesseract error: {e}")
        return None


def extract_text_batch(images: list) -> list:
    """Extract text from multiple image regions."""
    return [extract_text(img) for img in images]
