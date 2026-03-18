"""
MediScan OCR — Image Preprocessing Module
==========================================
Applies OpenCV-based preprocessing to enhance prescription images
before OCR extraction. Handles grayscale conversion, noise reduction,
contrast enhancement, thresholding, and resizing.
"""

import cv2
import numpy as np
import logging

logger = logging.getLogger("mediscan.preprocess")

# ═══════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════

# Minimum dimension (px) — images smaller than this are upscaled
MIN_DIMENSION = 300

# CLAHE parameters for contrast enhancement
CLAHE_CLIP_LIMIT = 2.0
CLAHE_TILE_SIZE = (8, 8)

# Gaussian blur kernel size (must be odd)
BLUR_KERNEL = (3, 3)

# Denoising strength
DENOISE_STRENGTH = 10

# Adaptive threshold block size (must be odd, > 1)
THRESHOLD_BLOCK_SIZE = 11
THRESHOLD_CONSTANT = 2

# Maximum dimension for processing (resize if larger to save time)
MAX_DIMENSION = 2000


# ═══════════════════════════════════════════════════════════════════
# Core Preprocessing Functions
# ═══════════════════════════════════════════════════════════════════

def convert_to_grayscale(image: np.ndarray) -> np.ndarray:
    """
    Convert a BGR image to grayscale.

    Args:
        image: Input image in BGR or grayscale format

    Returns:
        Grayscale image
    """
    if len(image.shape) == 3 and image.shape[2] == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        logger.debug("Converted BGR → Grayscale")
    elif len(image.shape) == 2:
        gray = image.copy()
        logger.debug("Image already grayscale")
    else:
        # Handle BGRA or other formats
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return gray


def reduce_noise(image: np.ndarray) -> np.ndarray:
    """
    Apply noise reduction using Gaussian blur followed by
    Non-Local Means denoising for clean text edges.

    Args:
        image: Grayscale image

    Returns:
        Denoised grayscale image
    """
    # Light Gaussian blur to remove high-frequency noise
    blurred = cv2.GaussianBlur(image, BLUR_KERNEL, 0)

    # Non-Local Means denoising — preserves edges while removing noise
    denoised = cv2.fastNlMeansDenoising(
        blurred,
        h=DENOISE_STRENGTH,
        templateWindowSize=7,
        searchWindowSize=21
    )
    logger.debug("Noise reduction applied (Gaussian + NLM)")
    return denoised


def enhance_contrast(image: np.ndarray) -> np.ndarray:
    """
    Apply CLAHE (Contrast Limited Adaptive Histogram Equalization)
    to improve contrast for faded or low-quality prescriptions.

    Args:
        image: Grayscale image

    Returns:
        Contrast-enhanced grayscale image
    """
    clahe = cv2.createCLAHE(
        clipLimit=CLAHE_CLIP_LIMIT,
        tileGridSize=CLAHE_TILE_SIZE
    )
    enhanced = clahe.apply(image)
    logger.debug(f"CLAHE applied (clip={CLAHE_CLIP_LIMIT})")
    return enhanced


def apply_threshold(image: np.ndarray) -> np.ndarray:
    """
    Apply adaptive Gaussian thresholding to create a binary image.
    This makes text stand out sharply against the background.

    Args:
        image: Grayscale image

    Returns:
        Binary (thresholded) image
    """
    binary = cv2.adaptiveThreshold(
        image,
        maxValue=255,
        adaptiveMethod=cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        thresholdType=cv2.THRESH_BINARY,
        blockSize=THRESHOLD_BLOCK_SIZE,
        C=THRESHOLD_CONSTANT
    )
    logger.debug("Adaptive Gaussian threshold applied")
    return binary


def resize_image(image: np.ndarray) -> np.ndarray:
    """
    Resize image if too small (upscale) or too large (downscale).
    Small images produce poor OCR; very large images waste processing time.

    Args:
        image: Input image (any channel count)

    Returns:
        Resized image (or original if already within bounds)
    """
    h, w = image.shape[:2]
    current_max = max(h, w)

    # Upscale small images for better OCR accuracy
    if current_max < MIN_DIMENSION:
        scale = MIN_DIMENSION / current_max
        new_w, new_h = int(w * scale), int(h * scale)
        resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
        logger.info(f"Upscaled image: {w}x{h} → {new_w}x{new_h}")
        return resized

    # Downscale very large images to avoid excessive processing time
    if current_max > MAX_DIMENSION:
        scale = MAX_DIMENSION / current_max
        new_w, new_h = int(w * scale), int(h * scale)
        resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)
        logger.info(f"Downscaled image: {w}x{h} → {new_w}x{new_h}")
        return resized

    return image


# ═══════════════════════════════════════════════════════════════════
# Full Preprocessing Pipeline
# ═══════════════════════════════════════════════════════════════════

def preprocess_image(image: np.ndarray) -> np.ndarray:
    """
    Full preprocessing pipeline for prescription images.

    Pipeline:
        1. Resize (upscale small / downscale large)
        2. Grayscale conversion
        3. Contrast enhancement (CLAHE)
        4. Noise reduction (Gaussian + NLM)
        5. Adaptive thresholding (binary)

    Args:
        image: Raw input image (BGR format from cv2.imread)

    Returns:
        Preprocessed binary image ready for OCR
    """
    logger.info(f"Starting preprocessing — input size: {image.shape[1]}x{image.shape[0]}")

    # Step 1: Resize if needed
    image = resize_image(image)

    # Step 2: Convert to grayscale
    gray = convert_to_grayscale(image)

    # Step 3: Enhance contrast
    enhanced = enhance_contrast(gray)

    # Step 4: Reduce noise
    denoised = reduce_noise(enhanced)

    # Step 5: Apply thresholding
    binary = apply_threshold(denoised)

    logger.info(f"Preprocessing complete — output size: {binary.shape[1]}x{binary.shape[0]}")
    return binary
