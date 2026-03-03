"""
MediScan — Stage 2: Image Orientation Correction
=================================================
Auto-rotates tilted images to horizontal alignment
before OCR processing for improved text extraction.
"""

import cv2
import numpy as np


def correct_orientation(image: np.ndarray) -> tuple:
    """
    Detect and correct image skew/rotation.
    
    Args:
        image: BGR image (OpenCV format)
    
    Returns:
        (corrected_image, was_corrected, angle)
    """
    if image is None or image.size == 0:
        return image, False, 0.0

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image

    angle = _detect_skew_angle(gray)

    # Only correct if skew is significant (>1 degree) but not too extreme (>45)
    if abs(angle) < 1.0 or abs(angle) > 45.0:
        return image, False, angle

    # Rotate image
    h, w = image.shape[:2]
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, angle, 1.0)

    # Calculate new bounding box to avoid cropping
    cos = np.abs(M[0, 0])
    sin = np.abs(M[0, 1])
    new_w = int(h * sin + w * cos)
    new_h = int(h * cos + w * sin)

    M[0, 2] += (new_w - w) / 2
    M[1, 2] += (new_h - h) / 2

    rotated = cv2.warpAffine(image, M, (new_w, new_h),
                              flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_CONSTANT,
                              borderValue=(255, 255, 255))

    return rotated, True, angle


def _detect_skew_angle(gray: np.ndarray) -> float:
    """
    Detect the skew angle of text in an image.
    Uses the minimum area rectangle of text regions.
    """
    # Method 1: minAreaRect on text pixels
    angle = _angle_from_text_coords(gray)
    if angle is not None:
        return angle

    # Method 2: Hough lines fallback
    return _angle_from_hough_lines(gray)


def _angle_from_text_coords(gray: np.ndarray) -> float:
    """Detect angle using minimum area rectangle of dark pixels (text)."""
    try:
        # Threshold to find text pixels
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        # Find coordinates of text pixels
        coords = np.column_stack(np.where(binary > 0))

        if coords.shape[0] < 100:  # Not enough text
            return None

        # Fit minimum area rectangle
        rect = cv2.minAreaRect(coords)
        angle = rect[-1]

        # Normalize angle to [-45, 45] range
        if angle < -45:
            angle = -(90 + angle)
        elif angle > 45:
            angle = -(angle - 90)
        else:
            angle = -angle

        return angle

    except Exception:
        return None


def _angle_from_hough_lines(gray: np.ndarray) -> float:
    """Fallback: detect angle using Hough line transform."""
    try:
        edges = cv2.Canny(gray, 50, 150, apertureSize=3)
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=100,
                                minLineLength=gray.shape[1] // 6,
                                maxLineGap=10)

        if lines is None or len(lines) == 0:
            return 0.0

        angles = []
        for line in lines:
            x1, y1, x2, y2 = line[0]
            angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
            if abs(angle) < 45:
                angles.append(angle)

        if not angles:
            return 0.0

        return float(np.median(angles))

    except Exception:
        return 0.0
