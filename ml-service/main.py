"""
MediScan — ML Service (FastAPI)
================================
8-Stage Medicine Identification Pipeline:
  1. Image Quality Assessment
  2. Orientation Correction
  3. Text Region Detection
  4. OCR Text Extraction (EasyOCR + Tesseract)
  5. Candidate Extraction + Fuzzy Matching (RapidFuzz)
  6. CNN Classification (EfficientNet-B0)
  7. Confidence Fusion
  8. Top-K Ranking + Output

Endpoints:
  POST /ocr/scan     — Full pipeline scan
  GET  /health       — Health check + model status
"""

import io
import os
import time
import logging
from pathlib import Path
from datetime import datetime
from contextlib import asynccontextmanager

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

# Pipeline modules
from app.quality import assess_quality
from app.orientation import correct_orientation
from app.detector import detect_text_regions, crop_regions
from app.ocr_engine import extract_text
from app.extractor import extract_candidates, match_against_database
from app.classifier import (
    load_model, classify_batch, is_model_loaded,
    get_model_version, get_brand_generic
)
from app.fusion import fuse_results, build_no_match_response, classify_confidence_level
from app import db

# ═══════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════

MODEL_VERSION = "v1.0"
LOG_DIR = Path("logs")
FAILED_DIR = LOG_DIR / "failed"
SCAN_LOG_DIR = LOG_DIR / "scans"

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(name)-20s | %(levelname)-7s | %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger("medscan.pipeline")


# ═══════════════════════════════════════════════════════════════════
# Application Lifecycle
# ═══════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: load model + warm up drug cache."""
    logger.info("=" * 60)
    logger.info("  MediScan ML Service — Starting Up")
    logger.info("=" * 60)

    # Create log directories
    FAILED_DIR.mkdir(parents=True, exist_ok=True)
    SCAN_LOG_DIR.mkdir(parents=True, exist_ok=True)

    # Load CNN model
    model_loaded = load_model()
    if model_loaded:
        logger.info(f"✅ CNN model loaded (version={get_model_version()})")
    else:
        logger.warning("⚠️  CNN model not loaded — OCR-only mode")

    # Load drug names into cache
    try:
        drug_names = db.load_drug_names()
        logger.info(f"✅ Drug cache: {len(drug_names):,} names loaded")
    except Exception as e:
        logger.warning(f"⚠️  Drug cache unavailable: {e}")

    logger.info("🚀 ML Service ready!")
    logger.info("=" * 60)
    yield
    logger.info("ML Service shutting down")


# ═══════════════════════════════════════════════════════════════════
# FastAPI App
# ═══════════════════════════════════════════════════════════════════

app = FastAPI(
    title="MediScan ML Service",
    description="Medicine identification from images using OCR + CNN + NLP",
    version=MODEL_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════════

@app.get("/health")
async def health_check():
    """Health check with model and cache status."""
    drug_count = len(db._drug_names_cache) if db._drug_names_cache else 0
    return {
        "status": "healthy",
        "model_loaded": is_model_loaded(),
        "model_version": get_model_version(),
        "drug_cache_size": drug_count,
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/ocr/scan")
async def scan_image(file: UploadFile = File(...)):
    """
    Full 8-stage medicine identification pipeline.
    
    Accepts: image file (JPEG, PNG)
    Returns: structured JSON with medicine predictions, confidence, DB metadata
    """
    start_time = time.time()
    request_id = datetime.now().strftime("%Y%m%d_%H%M%S_%f")

    logger.info(f"[{request_id}] === New scan request: {file.filename} ===")

    # ── Read Image ─────────────────────────────────────────────
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image is None:
            raise ValueError("Could not decode image")
    except Exception as e:
        logger.error(f"[{request_id}] Image load failed: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid image file: {e}")

    logger.info(f"[{request_id}] Image loaded: {image.shape[1]}x{image.shape[0]}px")

    # ── STAGE 1: Quality Assessment ────────────────────────────
    quality = assess_quality(image)
    logger.info(f"[{request_id}] Quality: usable={quality.is_usable}, "
                f"blur={quality.blur_score:.1f}, brightness={quality.brightness:.0f}")

    if not quality.is_usable:
        elapsed = int((time.time() - start_time) * 1000)
        logger.warning(f"[{request_id}] Image rejected: {quality.issues}")
        _save_failed_image(contents, request_id, "quality_rejected")
        return {
            "status": "rejected",
            "model_version": get_model_version() if is_model_loaded() else MODEL_VERSION,
            "quality": quality.to_dict(),
            "message": "; ".join(quality.issues),
            "medicines": [],
            "processing_ms": elapsed,
        }

    # ── STAGE 2: Orientation Correction ────────────────────────
    image, was_corrected, skew_angle = correct_orientation(image)
    if was_corrected:
        logger.info(f"[{request_id}] Orientation corrected: {skew_angle:.1f}°")

    quality_dict = quality.to_dict()
    quality_dict['orientation_corrected'] = was_corrected

    # ── STAGE 3: Text Region Detection ─────────────────────────
    regions = detect_text_regions(image)
    crops = crop_regions(image, regions)
    logger.info(f"[{request_id}] Detected {len(regions)} text regions")

    # ── STAGE 4: OCR Text Extraction ───────────────────────────
    all_ocr_results = []
    raw_texts = []
    for i, crop in enumerate(crops):
        ocr_result = extract_text(crop)
        all_ocr_results.append(ocr_result)
        raw_texts.append(ocr_result.text)
        logger.info(f"[{request_id}] Region {i+1} OCR ({ocr_result.engine}): "
                     f"'{ocr_result.text[:50]}...' conf={ocr_result.confidence:.3f}")

    combined_raw_text = " | ".join(raw_texts)
    ocr_engine_used = all_ocr_results[0].engine if all_ocr_results else "none"

    # ── STAGE 5: Candidate Extraction + Fuzzy Matching ─────────
    drug_names = db.load_drug_names()
    brand_to_generic = db.get_brand_to_generic()

    all_extractions = []
    for ocr_result in all_ocr_results:
        extraction = extract_candidates(ocr_result.text)

        if extraction.name_candidates and drug_names:
            extraction.db_matches = match_against_database(
                extraction.name_candidates, drug_names, brand_to_generic
            )
            if extraction.db_matches:
                extraction.best_match = extraction.db_matches[0]
                logger.info(f"[{request_id}] Best DB match: {extraction.best_match['name']} "
                            f"(score={extraction.best_match['score']:.1f})")

        all_extractions.append(extraction)

    # ── STAGE 6: CNN Classification ────────────────────────────
    cnn_results = []
    if is_model_loaded():
        cnn_results = classify_batch(crops)
        for i, cnn_r in enumerate(cnn_results):
            if cnn_r:
                logger.info(f"[{request_id}] Region {i+1} CNN: "
                            f"{cnn_r.top_prediction} ({cnn_r.top_confidence:.3f})")
    else:
        cnn_results = [None] * len(crops)

    # ── STAGE 7 + 8: Confidence Fusion + Top-K ─────────────────
    medicines = []
    for i in range(len(crops)):
        ocr_result = all_ocr_results[i]
        extraction = all_extractions[i]
        cnn_result = cnn_results[i]

        # Determine best OCR match
        ocr_name = None
        ocr_confidence = ocr_result.confidence

        if extraction.best_match:
            ocr_name = extraction.best_match['name']
            ocr_confidence = extraction.best_match['score'] / 100.0

        # Get CNN predictions
        cnn_preds = cnn_result.predictions if cnn_result else None

        # Get DB details for top match
        db_details = None
        if ocr_name:
            db_details = db.get_drug_details(ocr_name)
            if db_details:
                # Keep only relevant fields
                db_details = {
                    'id': db_details.get('id'),
                    'manufacturer': db_details.get('manufacturer'),
                    'composition': db_details.get('composition'),
                    'price': db_details.get('price'),
                }

        # Fuse
        fused = fuse_results(
            region_id=i + 1,
            ocr_name=ocr_name,
            ocr_confidence=ocr_confidence,
            cnn_predictions=cnn_preds,
            db_matches=extraction.db_matches[:5] if extraction.db_matches else None,
            dosage=extraction.dosage,
            frequency=extraction.frequency,
            db_details=db_details,
        )

        medicines.append(fused.to_dict())
        logger.info(f"[{request_id}] Region {i+1} FUSED: "
                     f"{fused.final_prediction} ({fused.confidence:.3f}, "
                     f"{fused.confidence_level}, {fused.source})")

    # ── Build Response ─────────────────────────────────────────
    elapsed_ms = int((time.time() - start_time) * 1000)
    model_ver = get_model_version() if is_model_loaded() else MODEL_VERSION

    # Check if any medicine has sufficient confidence
    has_results = any(m.get('final_prediction') is not None and m.get('confidence', 0) >= 0.50
                      for m in medicines)

    if not has_results and medicines:
        # No match response
        logger.warning(f"[{request_id}] No confident matches found")
        _save_failed_image(contents, request_id, "no_match")
        response = build_no_match_response(quality_dict, combined_raw_text, model_ver)
        response['processing_ms'] = elapsed_ms
        return response

    response = {
        "status": "success",
        "model_version": model_ver,
        "quality": quality_dict,
        "raw_text": combined_raw_text,
        "ocr_engine": ocr_engine_used,
        "medicines": medicines,
        "processing_ms": elapsed_ms,
    }

    logger.info(f"[{request_id}] ✅ Scan complete: {len(medicines)} medicines, {elapsed_ms}ms")

    # Log result
    _save_scan_log(request_id, response)

    return response


# ═══════════════════════════════════════════════════════════════════
# User Correction Endpoint (for dataset scalability)
# ═══════════════════════════════════════════════════════════════════

@app.post("/feedback/correction")
async def submit_correction(
    predicted: str = "",
    actual: str = "",
    file: UploadFile = File(None),
):
    """
    Accept user correction feedback for future retraining.
    Saves: predicted vs actual label + image (if provided).
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    corrections_dir = LOG_DIR / "corrections"
    corrections_dir.mkdir(parents=True, exist_ok=True)

    # Save correction log
    import json
    correction = {
        "timestamp": timestamp,
        "predicted": predicted,
        "actual": actual,
        "has_image": file is not None,
    }

    with open(corrections_dir / f"{timestamp}.json", "w") as f:
        json.dump(correction, f, indent=2)

    # Save image if provided
    if file:
        contents = await file.read()
        img_path = corrections_dir / f"{timestamp}.png"
        with open(img_path, "wb") as f:
            f.write(contents)

    logger.info(f"Correction saved: predicted='{predicted}' → actual='{actual}'")

    return {"status": "correction_saved", "id": timestamp}


# ═══════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════

def _save_failed_image(image_bytes: bytes, request_id: str, reason: str):
    """Save failed/rejected images for future analysis."""
    try:
        path = FAILED_DIR / f"{request_id}_{reason}.png"
        with open(path, "wb") as f:
            f.write(image_bytes)
        logger.info(f"Failed image saved: {path}")
    except Exception as e:
        logger.warning(f"Could not save failed image: {e}")


def _save_scan_log(request_id: str, response: dict):
    """Save structured scan log."""
    try:
        import json
        log_path = SCAN_LOG_DIR / f"{request_id}.json"
        with open(log_path, "w") as f:
            json.dump(response, f, indent=2, default=str)
    except Exception as e:
        logger.warning(f"Could not save scan log: {e}")


# ═══════════════════════════════════════════════════════════════════
# Run
# ═══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
