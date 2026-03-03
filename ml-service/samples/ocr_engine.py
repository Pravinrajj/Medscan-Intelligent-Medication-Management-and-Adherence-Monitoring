"""
OCR Engine Module
Handles image preprocessing and Tesseract OCR
"""

import cv2
import numpy as np
import pytesseract
import platform

# ── Set Tesseract path (Windows only) ──
if platform.system() == "Windows":
    pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

TESSERACT_CONFIG = r"--oem 3 --psm 6"


def preprocess_image(img: np.ndarray) -> np.ndarray:
    """
    Full preprocessing pipeline optimised for:
      - Handwritten prescriptions
      - Printed tablet/medicine covers
    """
    # 1. Upscale small images (helps OCR on low-res mobile captures)
    h, w = img.shape[:2]
    if max(h, w) < 1000:
        scale = 1000 / max(h, w)
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    # 2. Grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 3. CLAHE — improves contrast on uneven lighting (common in mobile shots)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    # 4. Denoise
    denoised = cv2.fastNlMeansDenoising(gray, h=10)

    # 5. Adaptive threshold
    thresh = cv2.adaptiveThreshold(
        denoised, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=11, C=2
    )

    # 6. Morphological cleanup
    kernel  = np.ones((1, 1), np.uint8)
    cleaned = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)

    # 7. Deskew
    cleaned = _deskew(cleaned)

    return cleaned


def _deskew(image: np.ndarray) -> np.ndarray:
    """Correct image tilt using image moments."""
    coords = np.column_stack(np.where(image < 128))
    if len(coords) < 10:
        return image
    angle = cv2.minAreaRect(coords)[-1]
    angle = -(90 + angle) if angle < -45 else -angle
    if abs(angle) < 0.5:
        return image
    h, w  = image.shape
    M     = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    return cv2.warpAffine(image, M, (w, h),
                          flags=cv2.INTER_CUBIC,
                          borderMode=cv2.BORDER_REPLICATE)


def run_ocr(image: np.ndarray) -> str:
    """Run Tesseract OCR and return cleaned text."""
    text = pytesseract.image_to_string(image, config=TESSERACT_CONFIG)
    return text.strip()


def run_ocr_with_confidence(image: np.ndarray) -> dict:
    """
    Returns OCR text + per-word confidence scores.
    Useful for filtering low-confidence words.
    """
    data = pytesseract.image_to_data(
        image, config=TESSERACT_CONFIG,
        output_type=pytesseract.Output.DICT
    )
    words = []
    for i, word in enumerate(data["text"]):
        word = word.strip()
        conf = int(data["conf"][i])
        if word and conf > 0:
            words.append({"word": word, "confidence": conf})

    full_text = " ".join(w["word"] for w in words)
    avg_conf  = round(sum(w["confidence"] for w in words) / len(words), 1) if words else 0

    return {
        "text":             full_text,
        "words":            words,
        "avg_confidence":   avg_conf
    }
