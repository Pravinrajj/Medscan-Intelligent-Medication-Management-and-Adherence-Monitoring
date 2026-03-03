"""
MediScan — Stage 1: Image Quality Assessment
=============================================
Detects blur, brightness issues, and skew.
Rejects unusable images with user-friendly feedback.
"""

import cv2
import numpy as np
from dataclasses import dataclass, field
from typing import List


@dataclass
class QualityResult:
    """Result of image quality assessment."""
    is_usable: bool = True
    issues: List[str] = field(default_factory=list)
    blur_score: float = 0.0
    brightness: float = 0.0
    skew_angle: float = 0.0

    def to_dict(self):
        return {
            'is_usable': self.is_usable,
            'issues': self.issues,
            'blur_score': round(self.blur_score, 2),
            'brightness': round(self.brightness, 2),
            'skew_angle': round(self.skew_angle, 2),
        }


# Thresholds (tuned for medicine images)
BLUR_THRESHOLD = 50.0        # Laplacian variance below this = blurry
BRIGHTNESS_LOW = 40.0        # Mean pixel below this = too dark
BRIGHTNESS_HIGH = 220.0      # Mean pixel above this = overexposed
MIN_IMAGE_SIZE = 50          # Minimum dimension in pixels


def assess_quality(image: np.ndarray) -> QualityResult:
    """
    Assess image quality for OCR/classification suitability.
    
    Args:
        image: BGR image (OpenCV format)
    
    Returns:
        QualityResult with usability flag and detected issues
    """
    result = QualityResult()

    if image is None or image.size == 0:
        result.is_usable = False
        result.issues.append("Image is empty or could not be loaded")
        return result

    h, w = image.shape[:2]

    # Check minimum size
    if h < MIN_IMAGE_SIZE or w < MIN_IMAGE_SIZE:
        result.is_usable = False
        result.issues.append(f"Image too small ({w}x{h}px) — minimum {MIN_IMAGE_SIZE}px")
        return result

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image

    # 1. Blur detection (Laplacian variance)
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    blur_score = laplacian.var()
    result.blur_score = blur_score

    if blur_score < BLUR_THRESHOLD:
        result.issues.append(
            f"Image appears blurry (score={blur_score:.1f}, min={BLUR_THRESHOLD}) — please retake with steady hands"
        )

    # 2. Brightness check (mean pixel intensity)
    brightness = float(np.mean(gray))
    result.brightness = brightness

    if brightness < BRIGHTNESS_LOW:
        result.issues.append(
            f"Image is too dark (brightness={brightness:.0f}) — try better lighting"
        )
    elif brightness > BRIGHTNESS_HIGH:
        result.issues.append(
            f"Image is overexposed (brightness={brightness:.0f}) — reduce flash/glare"
        )

    # 3. Skew estimation (angle of dominant lines via Hough transform)
    skew_angle = _estimate_skew(gray)
    result.skew_angle = skew_angle

    # Mark as unusable if critical issues found
    if blur_score < BLUR_THRESHOLD * 0.3:  # Extremely blurry
        result.is_usable = False
    if brightness < BRIGHTNESS_LOW * 0.5 or brightness > 250:  # Extremely dark/white
        result.is_usable = False

    return result


def _estimate_skew(gray: np.ndarray) -> float:
    """Estimate skew angle using Hough line transform."""
    try:
        edges = cv2.Canny(gray, 50, 150, apertureSize=3)
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=80,
                                minLineLength=gray.shape[1] // 4,
                                maxLineGap=10)

        if lines is None or len(lines) == 0:
            return 0.0

        angles = []
        for line in lines:
            x1, y1, x2, y2 = line[0]
            angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
            # Only consider near-horizontal lines
            if abs(angle) < 45:
                angles.append(angle)

        if not angles:
            return 0.0

        return float(np.median(angles))
    except Exception:
        return 0.0
