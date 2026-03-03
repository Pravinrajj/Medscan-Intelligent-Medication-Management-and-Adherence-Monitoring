"""
MediScan — Stage 3: Text Region Detection
==========================================
Detects text regions in images using CRAFT or fallback methods.
Returns bounding boxes for word/line regions.
"""

import cv2
import numpy as np
from typing import List, Tuple
import logging

logger = logging.getLogger(__name__)

# Region detection config
MIN_REGION_AREA = 200       # Minimum bounding box area in pixels
PADDING = 5                 # Padding around detected regions
USE_CRAFT = True            # Set False to use fallback (MSER)


def detect_text_regions(image: np.ndarray) -> List[Tuple[int, int, int, int]]:
    """
    Detect text regions in an image.
    
    Tries CRAFT if available, falls back to contour-based detection.
    
    Args:
        image: BGR image (OpenCV format)
    
    Returns:
        List of bounding boxes as (x, y, w, h)
    """
    regions = []

    if USE_CRAFT:
        try:
            regions = _detect_with_craft(image)
        except Exception as e:
            logger.warning(f"CRAFT detection failed: {e}, falling back to contour detection")
            regions = []

    # Fallback: contour-based detection
    if not regions:
        regions = _detect_with_contours(image)

    # If still nothing, return full image as single region
    if not regions:
        h, w = image.shape[:2]
        regions = [(0, 0, w, h)]
        logger.info("No text regions detected — using full image")

    return regions


def _detect_with_craft(image: np.ndarray) -> List[Tuple[int, int, int, int]]:
    """
    Detect text regions using CRAFT text detector.
    Requires: pip install craft-text-detector
    """
    from craft_text_detector import Craft

    craft = Craft(
        output_dir=None,
        crop_type="poly",
        cuda=False,  # CPU inference
        text_threshold=0.7,
        link_threshold=0.4,
        low_text=0.4,
    )

    # Run prediction
    prediction_result = craft.detect_text(image)
    boxes = prediction_result["boxes"]

    regions = []
    h, w = image.shape[:2]

    for box in boxes:
        # box is a polygon (4 points), convert to bounding rect
        box = np.array(box).astype(int)
        x_min = max(0, box[:, 0].min() - PADDING)
        y_min = max(0, box[:, 1].min() - PADDING)
        x_max = min(w, box[:, 0].max() + PADDING)
        y_max = min(h, box[:, 1].max() + PADDING)

        bw, bh = x_max - x_min, y_max - y_min
        if bw * bh >= MIN_REGION_AREA:
            regions.append((x_min, y_min, bw, bh))

    # Clean up
    craft.unload_craftnet_model()
    craft.unload_refinenet_model()

    logger.info(f"CRAFT detected {len(regions)} text regions")
    return regions


def _detect_with_contours(image: np.ndarray) -> List[Tuple[int, int, int, int]]:
    """
    Fallback text region detection using morphological operations + contours.
    Works without external dependencies.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image.copy()
    h, w = gray.shape[:2]

    # Preprocess: enhance text regions
    # Adaptive threshold to create binary image
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 5
    )

    # Morphological operations to merge nearby text into regions
    # Horizontal kernel to connect characters in a word/line
    kernel_h = cv2.getStructuringElement(cv2.MORPH_RECT, (max(w // 15, 15), 3))
    dilated = cv2.dilate(binary, kernel_h, iterations=2)

    # Vertical kernel to merge very close lines
    kernel_v = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 5))
    dilated = cv2.dilate(dilated, kernel_v, iterations=1)

    # Find contours
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    regions = []
    for contour in contours:
        x, y, bw, bh = cv2.boundingRect(contour)
        area = bw * bh

        # Filter: reasonable text region size
        if area >= MIN_REGION_AREA and bw > 20 and bh > 8:
            # Apply padding
            x = max(0, x - PADDING)
            y = max(0, y - PADDING)
            bw = min(w - x, bw + 2 * PADDING)
            bh = min(h - y, bh + 2 * PADDING)
            regions.append((x, y, bw, bh))

    # Sort top-to-bottom, left-to-right
    regions.sort(key=lambda r: (r[1], r[0]))

    # Merge overlapping regions
    regions = _merge_overlapping(regions)

    logger.info(f"Contour detection found {len(regions)} text regions")
    return regions


def _merge_overlapping(regions: List[Tuple[int, int, int, int]],
                        overlap_threshold: float = 0.3) -> List[Tuple[int, int, int, int]]:
    """Merge overlapping bounding boxes."""
    if not regions:
        return regions

    merged = []
    used = set()

    for i, r1 in enumerate(regions):
        if i in used:
            continue

        x1, y1, w1, h1 = r1
        # Check against all remaining
        for j, r2 in enumerate(regions[i + 1:], start=i + 1):
            if j in used:
                continue

            x2, y2, w2, h2 = r2
            # Calculate overlap
            ox = max(0, min(x1 + w1, x2 + w2) - max(x1, x2))
            oy = max(0, min(y1 + h1, y2 + h2) - max(y1, y2))
            overlap_area = ox * oy
            min_area = min(w1 * h1, w2 * h2)

            if min_area > 0 and overlap_area / min_area > overlap_threshold:
                # Merge regions
                nx = min(x1, x2)
                ny = min(y1, y2)
                nw = max(x1 + w1, x2 + w2) - nx
                nh = max(y1 + h1, y2 + h2) - ny
                x1, y1, w1, h1 = nx, ny, nw, nh
                used.add(j)

        merged.append((x1, y1, w1, h1))

    return merged


def crop_regions(image: np.ndarray,
                 regions: List[Tuple[int, int, int, int]]) -> List[np.ndarray]:
    """Crop image into individual text region images."""
    crops = []
    for (x, y, w, h) in regions:
        crop = image[y:y + h, x:x + w]
        if crop.size > 0:
            crops.append(crop)
    return crops
