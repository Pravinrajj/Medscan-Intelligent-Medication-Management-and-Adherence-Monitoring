"""
MediScan OCR — OCR Extraction Module (TrOCR — offline, free)
=============================================================
Uses Microsoft TrOCR (trocr-large-handwritten) — a free, offline
transformer model purpose-built for handwritten text recognition.
No API key, no billing, no internet connection required after the
first run (model is cached locally ~1.3GB).
"""

import os
import logging
from typing import Optional, List
from dataclasses import dataclass, field

import numpy as np
from filter import OCRDetection

logger = logging.getLogger("mediscan.ocr")

MIN_CONFIDENCE = 0.1
_processor = None
_model = None


@dataclass
class OCRResult:
    raw_text: str
    detections: List[OCRDetection]
    avg_confidence: float
    min_confidence: float
    max_confidence: float
    detection_count: int


def load_ocr_model(gpu: bool = False) -> bool:
    global _processor, _model

    try:
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel

        logger.info("Loading TrOCR model (first run downloads ~1.3GB, cached after)...")

        _processor = TrOCRProcessor.from_pretrained(
            "microsoft/trocr-large-handwritten"
        )
        _model = VisionEncoderDecoderModel.from_pretrained(
            "microsoft/trocr-large-handwritten"
        )
        _model.eval()
        logger.info("TrOCR model loaded successfully (offline, no billing required)")
        return True

    except ImportError:
        logger.error("Run: pip install transformers torch torchvision Pillow")
        return False
    except Exception as e:
        logger.error(f"Failed to load TrOCR model: {e}")
        return False


def is_model_loaded() -> bool:
    return _processor is not None and _model is not None


def extract_text(image: np.ndarray) -> Optional[OCRResult]:
    if not is_model_loaded():
        logger.error("TrOCR model not loaded — call load_ocr_model() first")
        return None

    try:
        import cv2
        import torch
        from PIL import Image

        # Convert numpy array to PIL RGB
        if len(image.shape) == 2:
            pil_image = Image.fromarray(image).convert("RGB")
        else:
            pil_image = Image.fromarray(
                cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            ).convert("RGB")

        img_width, img_height = pil_image.size

        # ── Slice image into horizontal strips ──────────────────────
        # TrOCR processes one line at a time. We slice the image into
        # overlapping horizontal bands and run OCR on each strip,
        # then combine results into OCRDetection objects with bboxes.
        detections: List[OCRDetection] = []
        texts: List[str] = []
        confidences: List[float] = []

        strip_height = max(60, img_height // 20)
        overlap      = strip_height // 3
        step         = strip_height - overlap

        y = 0
        while y < img_height:
            y_end = min(y + strip_height, img_height)
            strip = pil_image.crop((0, y, img_width, y_end))

            # Skip nearly blank strips
            import numpy as np_inner
            strip_arr = np_inner.array(strip.convert("L"))
            if strip_arr.std() < 8:
                y += step
                continue

            pixel_values = _processor(
                images=strip, return_tensors="pt"
            ).pixel_values

            with torch.no_grad():
                generated_ids = _model.generate(
                    pixel_values,
                    max_new_tokens=64,
                )

            text = _processor.batch_decode(
                generated_ids, skip_special_tokens=True
            )[0].strip()

            if not text or len(text) < 2:
                y += step
                continue

            # Assign a synthetic confidence (TrOCR doesn't return one)
            confidence = 0.85

            # Build a full-width bbox for this strip
            bbox = [
                [0,        y],
                [img_width, y],
                [img_width, y_end],
                [0,        y_end],
            ]

            # Split the line text into individual word detections
            # so downstream filter/cleaner work at word granularity
            words = text.split()
            if not words:
                y += step
                continue

            word_width = img_width // max(len(words), 1)
            for i, word in enumerate(words):
                wx      = i * word_width
                wx_end  = wx + word_width
                word_bbox = [
                    [wx,     y],
                    [wx_end, y],
                    [wx_end, y_end],
                    [wx,     y_end],
                ]
                det = OCRDetection(
                    text=word,
                    confidence=confidence,
                    bbox=word_bbox,
                    y_center=(y + y_end) / 2,
                )
                detections.append(det)
                texts.append(word)
                confidences.append(confidence)

            y += step

        raw_text      = " ".join(texts)
        avg_conf      = sum(confidences) / len(confidences) if confidences else 0.0

        result = OCRResult(
            raw_text=raw_text,
            detections=detections,
            avg_confidence=round(avg_conf, 4),
            min_confidence=round(min(confidences), 4) if confidences else 0.0,
            max_confidence=round(max(confidences), 4) if confidences else 0.0,
            detection_count=len(detections),
        )

        logger.info(
            f"TrOCR: {result.detection_count} word detections "
            f"(avg_conf={result.avg_confidence:.3f})"
        )
        return result

    except Exception as e:
        logger.error(f"TrOCR extraction failed: {e}", exc_info=True)
        return None