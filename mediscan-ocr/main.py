"""
MediScan OCR — FastAPI Entry Point (v4.2 — Google Cloud Vision)
===============================================================
Production-ready API for prescription text extraction powered by
Google Cloud Vision DOCUMENT_TEXT_DETECTION — a handwriting-optimised
OCR endpoint that handles mixed handwritten + printed prescriptions.

Endpoints:
    POST /extract-text/          — Extract structured data from prescription images
    POST /extract-medicine-name/ — Extract medicine name from tablet strip images
    GET  /health                 — Service health check

Authentication (set ONE of the following before starting):

  Option 1 — Service account key file (recommended):
      export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

  Option 2 — Inline JSON credentials via env var (Docker-friendly):
      export GCP_VISION_CREDENTIALS_JSON='{"type":"service_account",...}'

  Option 3 — Application Default Credentials (Cloud Run / GCE / gcloud CLI):
      gcloud auth application-default login   # local dev only
      (no env var needed on managed GCP infrastructure)

Usage:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

import os
import uuid
import time
import logging
from pathlib import Path
from datetime import datetime
from contextlib import asynccontextmanager

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from preprocess import preprocess_image, crop_header, enhance_contrast, convert_to_grayscale, resize_image
from ocr import load_ocr_model, extract_text, is_model_loaded
from filter import positional_filter, keyword_filter_lines
from cleaner import clean_detections, group_into_lines
from parser import parse_lines
from strip_reader import extract_medicine_name
from medicine_db import (
    load_database, is_database_loaded, get_database_size,
    lookup_medicine, lookup_multiple, process_prescription_lines,
)

MEDICINE_DB_CSV = Path(__file__).resolve().parent.parent / "medicine_data.csv"

# ═══════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════

TEMP_DIR = Path("temp")
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}
MAX_FILE_SIZE_MB = 10

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)-22s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("mediscan.main")


# ═══════════════════════════════════════════════════════════════════
# Application Lifecycle
# ═══════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: initialise GCP Vision client + load medicine DB. Shutdown: cleanup."""
    logger.info("=" * 60)
    logger.info("  MediScan OCR Service — Starting Up (v4.3 — TrOCR offline)")
    logger.info("=" * 60)

    # Optional: load .env file if python-dotenv is installed
    try:
        from dotenv import load_dotenv
        load_dotenv()
        logger.info("Loaded environment from .env file")
    except ImportError:
        pass

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Temp directory: {TEMP_DIR.absolute()}")

    # Initialise Google Cloud Vision client
    logger.info("Loading TrOCR handwriting model")
    model_loaded = load_ocr_model()
    if model_loaded:
        logger.info("✅ TrOCR model loaded successfully (offline, no billing)")
    else:
        logger.error(
            "❌ Failed to initialise TrOCR model — "
            "check credentials and ensure google-cloud-vision is installed"
        )

    # Load medicine database
    logger.info(f"Loading medicine database from: {MEDICINE_DB_CSV}")
    db_loaded = load_database(str(MEDICINE_DB_CSV))
    if db_loaded:
        logger.info(f"✅ Medicine database loaded ({get_database_size()} entries)")
    else:
        logger.warning("⚠️  Medicine database not loaded — DB lookups will be unavailable")

    logger.info("🚀 MediScan OCR Service ready!")
    logger.info("   Docs: http://localhost:8000/docs")
    logger.info("=" * 60)

    yield

    logger.info("Shutting down — cleaning temp files...")
    _cleanup_temp_dir()
    logger.info("MediScan OCR Service stopped")


# ═══════════════════════════════════════════════════════════════════
# FastAPI Application
# ═══════════════════════════════════════════════════════════════════

app = FastAPI(
    title="MediScan OCR API",
    description=(
        "Prescription text extraction API using Google Cloud Vision "
        "(DOCUMENT_TEXT_DETECTION) with intelligent filtering optimized "
        "for handwritten prescriptions.\n\n"
        "**Endpoints:**\n"
        "- `POST /extract-text/` — Prescription image → structured medicine data\n"
        "- `POST /extract-medicine-name/` — Tablet strip image → medicine name\n\n"
        "Matched against a 195K-entry medicine database. "
        "Returns composition, manufacturer, side effects, interactions."
    ),
    version="4.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════════

@app.get("/health")
async def health_check():
    """Service health check."""
    return {
        "status": "healthy",
        "version": "4.2.0",
        "ocr_backend": "Google Cloud Vision (DOCUMENT_TEXT_DETECTION)",
        "model_loaded": is_model_loaded(),
        "database_loaded": is_database_loaded(),
        "database_size": get_database_size(),
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/extract-text/")
async def extract_text_from_prescription(file: UploadFile = File(...)):
    """
    Extract medicine-related text from a prescription image.

    **Pipeline (v4.2 — Google Cloud Vision):**
    1. Validate + save uploaded image
    2. Optional header crop (top 10%)
    3. GCP Vision DOCUMENT_TEXT_DETECTION (handwriting model)
    4. Positional filter — keep text in 25%–85% vertical band
    5. OCR error correction
    6. Group bounding boxes into full lines
    7. Keyword filter — keep only medicine-related lines
    8. Parse structured medicine data:
         a. DB-first lookup (no prefix required)
         b. Full-line regex fallback
         c. Component / standalone / significant-word fallbacks
    9. Return JSON response
    """
    start_time = time.time()
    request_id = str(uuid.uuid4())[:8]
    temp_path = None

    logger.info(f"[{request_id}] New prescription request: filename={file.filename}")

    try:
        _validate_file(file)
        temp_path = await _save_temp_file(file, request_id)

        image = cv2.imread(str(temp_path))
        if image is None:
            raise HTTPException(
                status_code=400,
                detail="Could not decode image — file may be corrupted"
            )

        image_height, image_width = image.shape[:2]
        logger.info(f"[{request_id}] Image: {image_width}x{image_height}px")

        cropped_image = crop_header(image, crop_ratio=0.10)
        cropped_height = cropped_image.shape[0]

        if not is_model_loaded():
            raise HTTPException(
                status_code=503,
                detail="Google Cloud Vision client not initialised — check credentials"
            )

        ocr_result = extract_text(cropped_image)
        if ocr_result is None:
            raise HTTPException(status_code=500, detail="OCR extraction failed")

        logger.info(
            f"[{request_id}] OCR: {ocr_result.detection_count} detections, "
            f"raw='{ocr_result.raw_text[:100]}...'"
        )

        pos_result = positional_filter(
            detections=ocr_result.detections,
            image_height=cropped_height,
            header_cutoff=0.25,
            footer_cutoff=0.85,
        )
        logger.info(
            f"[{request_id}] Positional: {pos_result.kept_count}/"
            f"{pos_result.total_detections} kept"
        )

        cleaned_detections = clean_detections(pos_result.filtered_detections)
        text_lines = group_into_lines(cleaned_detections)
        logger.info(f"[{request_id}] Grouped into {len(text_lines)} lines")

        med_lines = keyword_filter_lines(text_lines)
        logger.info(
            f"[{request_id}] Keyword filter: {len(med_lines)}/{len(text_lines)} lines kept"
        )

        medicines = parse_lines(med_lines)

        elapsed_ms = int((time.time() - start_time) * 1000)

        structured_data = [m.to_dict() for m in medicines]

        # Enrich each parsed medicine with a DB lookup
        db_enriched = []
        for entry in structured_data:
            med_name = entry.get("corrected_name") or entry.get("medicine", "")
            db_match = lookup_medicine(med_name) if med_name else None
            enriched = dict(entry)
            if db_match and db_match.matched_name and db_match.match_score >= 70:
                enriched["db_match"] = db_match.to_dict()
            db_enriched.append(enriched)

        response = {
            "filename": file.filename,
            "raw_text": ocr_result.raw_text,
            "structured_data": db_enriched,
            "confidence": {
                "average": ocr_result.avg_confidence,
                "min": ocr_result.min_confidence,
                "max": ocr_result.max_confidence,
            },
            "word_count": ocr_result.detection_count,
            "ocr_backend": "Google Cloud Vision (DOCUMENT_TEXT_DETECTION)",
            "pipeline_stats": {
                "total_detections": pos_result.total_detections,
                "after_positional_filter": pos_result.kept_count,
                "grouped_lines": len(text_lines),
                "after_keyword_filter": len(med_lines),
                "medicines_found": len(medicines),
            },
            "processing_time_ms": elapsed_ms,
        }

        logger.info(
            f"[{request_id}] ✅ Complete: {len(structured_data)} medicine(s), {elapsed_ms}ms"
        )
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[{request_id}] Unexpected error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
    finally:
        if temp_path and temp_path.exists():
            try:
                temp_path.unlink()
            except Exception as e:
                logger.warning(f"[{request_id}] Failed to clean up temp: {e}")


@app.post("/extract-medicine-name/")
async def extract_medicine_name_from_strip(file: UploadFile = File(...)):
    """
    Extract the medicine/brand name from a tablet strip (blister pack) image.

    **Pipeline (v4.2):**
    1. Validate + save uploaded image
    2. Preprocess (grayscale + CLAHE contrast enhancement)
    3. GCP Vision DOCUMENT_TEXT_DETECTION
    4. Word-level noise filtering (preserves brand name when merged with dosage)
    5. Repetition bonus (brand name printed on every blister cell)
    6. Rebalanced scoring (font_size 30%, position 20%, confidence 20%)
    7. DB-match bonus (threshold 70, bonus 0.50)
    8. Select top candidate + post-process
    9. Return enriched JSON response
    """
    start_time = time.time()
    request_id = str(uuid.uuid4())[:8]
    temp_path = None

    logger.info(f"[{request_id}] Strip reader request: filename={file.filename}")

    try:
        _validate_file(file)
        temp_path = await _save_temp_file(file, request_id)

        image = cv2.imread(str(temp_path))
        if image is None:
            raise HTTPException(
                status_code=400,
                detail="Could not decode image — file may be corrupted"
            )

        image_height, image_width = image.shape[:2]
        logger.info(f"[{request_id}] Strip image: {image_width}x{image_height}px")

        # Grayscale + CLAHE only — skip binarisation to keep coloured text legible
        resized      = resize_image(image)
        gray         = convert_to_grayscale(resized)
        preprocessed = enhance_contrast(gray)
        logger.info(f"[{request_id}] Strip preprocessed (grayscale + CLAHE)")

        if not is_model_loaded():
            raise HTTPException(
                status_code=503,
                detail="Google Cloud Vision client not initialised — check credentials"
            )

        ocr_result = extract_text(preprocessed)
        if ocr_result is None:
            raise HTTPException(status_code=500, detail="OCR extraction failed")

        logger.info(
            f"[{request_id}] OCR: {ocr_result.detection_count} detections from strip"
        )

        strip_result = extract_medicine_name(
            detections=ocr_result.detections,
            image_height=image_height,
        )

        db_match = None
        if strip_result.brand_name:
            db_match = lookup_medicine(strip_result.brand_name)
            if db_match and db_match.matched_name:
                logger.info(
                    f"[{request_id}] DB lookup: '{strip_result.brand_name}' → "
                    f"'{db_match.matched_name}' (score={db_match.match_score:.1f})"
                )

        elapsed_ms = int((time.time() - start_time) * 1000)

        response = {
            "brand_name": strip_result.brand_name,
            "composition": strip_result.composition,
            "confidence": round(strip_result.confidence, 4),
            "raw_text": strip_result.raw_text,
            "ocr_backend": "Google Cloud Vision (DOCUMENT_TEXT_DETECTION)",
            "top_candidates": [
                c.to_dict() for c in strip_result.all_candidates[:5]
            ],
            "processing_time_ms": elapsed_ms,
        }

        if db_match and db_match.matched_name:
            response["db_match"] = db_match.to_dict()

        logger.info(
            f"[{request_id}] ✅ Strip result: "
            f"'{strip_result.brand_name}' "
            f"(conf={strip_result.confidence:.3f}, {elapsed_ms}ms)"
        )
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[{request_id}] Unexpected error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
    finally:
        if temp_path and temp_path.exists():
            try:
                temp_path.unlink()
            except Exception as e:
                logger.warning(f"[{request_id}] Failed to clean up temp: {e}")


# ═══════════════════════════════════════════════════════════════════
# Helper Functions
# ═══════════════════════════════════════════════════════════════════

def _validate_file(file: UploadFile) -> None:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid content type: '{file.content_type}'. Must be an image."
        )


async def _save_temp_file(file: UploadFile, request_id: str) -> Path:
    temp_filename = f"{request_id}_{file.filename}"
    temp_path = TEMP_DIR / temp_filename
    contents = await file.read()
    size_mb = len(contents) / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        raise HTTPException(
            status_code=400,
            detail=f"File too large: {size_mb:.1f}MB (max: {MAX_FILE_SIZE_MB}MB)"
        )
    with open(temp_path, "wb") as f:
        f.write(contents)
    return temp_path


def _cleanup_temp_dir() -> None:
    if TEMP_DIR.exists():
        for file in TEMP_DIR.iterdir():
            try:
                file.unlink()
            except Exception as e:
                logger.warning(f"Could not delete temp file {file}: {e}")


# ═══════════════════════════════════════════════════════════════════
# Run Server
# ═══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
