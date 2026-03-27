"""
MediScan OCR — FastAPI Entry Point (v3.1)
==========================================
Production-ready API for prescription text extraction with
intelligent filtering optimized for noisy handwritten prescriptions,
plus tablet strip medicine name extraction.

Endpoints:
    POST /extract-text/          — Extract structured data from prescription images
    POST /extract-medicine-name/ — Extract medicine name from tablet strip images
    GET  /health                 — Service health check

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

from preprocess import preprocess_image, crop_header
from ocr import load_ocr_model, extract_text, is_model_loaded
from filter import positional_filter, keyword_filter_lines
from cleaner import clean_detections, group_into_lines
from parser import parse_lines
from strip_reader import extract_medicine_name
from medicine_db import load_database, is_database_loaded, get_database_size, lookup_medicine, lookup_multiple, process_prescription_lines

# Path to the medicine CSV database (relative to project root)
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
    """Startup: Load EasyOCR model + create temp dir. Shutdown: cleanup."""
    logger.info("=" * 60)
    logger.info("  MediScan OCR Service — Starting Up (v4.0)")
    logger.info("  With medicine database integration")
    logger.info("=" * 60)

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Temp directory: {TEMP_DIR.absolute()}")

    # Load EasyOCR model
    logger.info("Loading EasyOCR model (this may take a moment)...")
    model_loaded = load_ocr_model(gpu=False)
    if model_loaded:
        logger.info("✅ EasyOCR model loaded successfully")
    else:
        logger.error("❌ Failed to load EasyOCR model — API will return errors")

    # Load medicine database
    logger.info(f"Loading medicine database from: {MEDICINE_DB_CSV}")
    db_loaded = load_database(str(MEDICINE_DB_CSV))
    if db_loaded:
        logger.info(f"✅ Medicine database loaded ({get_database_size()} entries)")
    else:
        logger.warning("⚠️ Medicine database not loaded — DB lookups will be unavailable")

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
        "Prescription text extraction API using EasyOCR with intelligent "
        "filtering optimized for handwritten prescriptions.\n\n"
        "**Endpoints:**\n"
        "- `POST /extract-text/` — Prescription image → structured medicine data\n"
        "- `POST /extract-medicine-name/` — Tablet strip image → medicine name\n\n"
        "Matched against a 195K-entry medicine database for accurate identification. "
        "Returns full details: composition, manufacturer, side effects, interactions."
    ),
    version="4.0.0",
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
        "version": "4.0.0",
        "model_loaded": is_model_loaded(),
        "database_loaded": is_database_loaded(),
        "database_size": get_database_size(),
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/extract-text/")
async def extract_text_from_prescription(file: UploadFile = File(...)):
    """
    Extract medicine-related text from a prescription image.

    **Pipeline (v3 — recall-first):**
    1. Validate + save uploaded image
    2. Optional header crop (top 10%)
    3. EasyOCR extraction (low confidence threshold = 0.1)
    4. Positional filter — keep text in 25%–85% vertical band
    5. OCR error correction (clean garbled text)
    6. Group nearby bounding boxes into full lines
    7. Keyword filter — keep only medicine-related lines
    8. Parse structured medicine data (name, dosage, frequency)
    9. Return JSON response
    """
    start_time = time.time()
    request_id = str(uuid.uuid4())[:8]
    temp_path = None

    logger.info(f"[{request_id}] New request: filename={file.filename}")

    try:
        # ── Step 1: Validate + Save ───────────────────────────────
        _validate_file(file)
        temp_path = await _save_temp_file(file, request_id)

        # ── Step 2: Read image ────────────────────────────────────
        image = cv2.imread(str(temp_path))
        if image is None:
            raise HTTPException(
                status_code=400,
                detail="Could not decode image — file may be corrupted"
            )

        image_height, image_width = image.shape[:2]
        logger.info(f"[{request_id}] Image: {image_width}x{image_height}px")

        # ── Step 3: Optional header crop ──────────────────────────
        cropped_image = crop_header(image, crop_ratio=0.10)
        cropped_height = cropped_image.shape[0]

        # ── Step 4: OCR extraction ────────────────────────────────
        if not is_model_loaded():
            raise HTTPException(
                status_code=503,
                detail="OCR model not loaded — service is starting up"
            )

        ocr_result = extract_text(cropped_image)
        if ocr_result is None:
            raise HTTPException(status_code=500, detail="OCR extraction failed")

        logger.info(
            f"[{request_id}] OCR: {ocr_result.detection_count} detections, "
            f"raw='{ocr_result.raw_text[:100]}...'"
        )

        # ── Step 5: Positional filter (NO keyword check) ─────────
        pos_result = positional_filter(
            detections=ocr_result.detections,
            image_height=cropped_height,
            header_cutoff=0.25,  # Skip top 25%
            footer_cutoff=0.85,  # Skip bottom 15%
        )

        logger.info(
            f"[{request_id}] Positional: {pos_result.kept_count}/"
            f"{pos_result.total_detections} kept"
        )

        # ── Step 6: OCR error correction ──────────────────────────
        cleaned_detections = clean_detections(pos_result.filtered_detections)

        logger.info(
            f"[{request_id}] Cleaned: "
            f"{' | '.join(d.text for d in cleaned_detections[:5])}..."
        )

        # ── Step 7: Group into text lines ─────────────────────────
        text_lines = group_into_lines(cleaned_detections)

        logger.info(
            f"[{request_id}] Grouped into {len(text_lines)} lines: "
            f"{[l.text for l in text_lines[:5]]}"
        )

        # ── Step 8: Keyword filter (on cleaned, grouped lines) ────
        med_lines = keyword_filter_lines(text_lines)

        logger.info(
            f"[{request_id}] Keyword filter: {len(med_lines)}/{len(text_lines)} "
            f"lines kept"
        )

        # ── Step 9: Parse structured medicine data ────────────────
        structured_data = parse_lines(med_lines)

        # ── Step 10: Per-line DB matching (multi-medicine) ────────
        #   Each medicine line is independently cleaned, matched
        #   against the 195K-entry DB, and deduplicated.
        medicines = process_prescription_lines(med_lines, threshold=75.0)

        # Also enrich parser results with DB lookups as fallback
        # (catches medicines the per-line matcher might miss)
        parser_names = {m.medicine.lower() for m in structured_data}
        matched_names = {m["matched_name"].lower() for m in medicines if m.get("matched_name")}

        for med in structured_data:
            if med.medicine.lower() not in matched_names:
                match = lookup_medicine(med.medicine)
                if match.matched_name and match.match_score >= 75.0:
                    dedup_key = match.matched_name.lower()
                    if dedup_key not in matched_names:
                        matched_names.add(dedup_key)
                        entry = {
                            "extracted_text": med.raw_line or med.medicine,
                            "matched_name": match.matched_name,
                            "match_score": round(match.match_score, 2),
                            "details": match.details if match.details else {},
                        }
                        medicines.append(entry)

        logger.info(
            f"[{request_id}] Multi-medicine: {len(medicines)} unique medicine(s)"
        )

        # ── Step 11: Build response ───────────────────────────────
        elapsed_ms = int((time.time() - start_time) * 1000)

        response = {
            "filename": file.filename,
            "raw_text": ocr_result.raw_text,
            "medicines": medicines,
            "confidence": {
                "average": ocr_result.avg_confidence,
                "min": ocr_result.min_confidence,
                "max": ocr_result.max_confidence,
            },
            "pipeline_stats": {
                "total_ocr_detections": ocr_result.detection_count,
                "after_positional_filter": pos_result.kept_count,
                "grouped_lines": len(text_lines),
                "after_keyword_filter": len(med_lines),
                "medicines_found": len(medicines),
            },
            "processing_time_ms": elapsed_ms,
        }

        logger.info(
            f"[{request_id}] ✅ Complete: "
            f"{len(structured_data)} medicine(s), "
            f"{elapsed_ms}ms"
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

    **Pipeline:**
    1. Validate + save uploaded image
    2. Run EasyOCR on the strip image
    3. Filter noise (dosage, batch, manufacturer, dates)
    4. Score candidates (length, uppercase, position, confidence)
    5. Select highest-scoring candidate
    6. Post-process (remove suffix words, normalize)

    **Returns:** `{medicine_name, confidence}` with top candidates for debugging.
    """
    start_time = time.time()
    request_id = str(uuid.uuid4())[:8]
    temp_path = None

    logger.info(f"[{request_id}] Strip reader request: filename={file.filename}")

    try:
        # ── Step 1: Validate + Save ───────────────────────────────
        _validate_file(file)
        temp_path = await _save_temp_file(file, request_id)

        # ── Step 2: Read image ────────────────────────────────────
        image = cv2.imread(str(temp_path))
        if image is None:
            raise HTTPException(
                status_code=400,
                detail="Could not decode image — file may be corrupted"
            )

        image_height, image_width = image.shape[:2]
        logger.info(f"[{request_id}] Strip image: {image_width}x{image_height}px")

        # ── Step 3: OCR extraction ────────────────────────────────
        if not is_model_loaded():
            raise HTTPException(
                status_code=503,
                detail="OCR model not loaded — service is starting up"
            )

        ocr_result = extract_text(image)
        if ocr_result is None:
            raise HTTPException(status_code=500, detail="OCR extraction failed")

        logger.info(
            f"[{request_id}] OCR: {ocr_result.detection_count} detections "
            f"from strip image"
        )

        # ── Step 4: Extract medicine name ─────────────────────────
        strip_result = extract_medicine_name(
            detections=ocr_result.detections,
            image_height=image_height,
        )

        # ── Step 5: Database lookup ────────────────────────────────
        db_match = None
        if strip_result.medicine_name:
            db_match = lookup_medicine(strip_result.medicine_name)
            logger.info(
                f"[{request_id}] DB lookup: '{strip_result.medicine_name}' → "
                f"'{db_match.matched_name}' (score={db_match.match_score:.1f})"
            )

        # ── Step 6: Build response ────────────────────────────────
        elapsed_ms = int((time.time() - start_time) * 1000)

        response = {
            "medicine_name": strip_result.medicine_name,
            "confidence": round(strip_result.confidence, 4),
            "raw_text": strip_result.raw_text,
            "top_candidates": [
                c.to_dict() for c in strip_result.all_candidates[:5]
            ],
            "processing_time_ms": elapsed_ms,
        }

        # Add database match if found
        if db_match:
            response["db_match"] = db_match.to_dict()

        logger.info(
            f"[{request_id}] ✅ Strip result: "
            f"'{strip_result.medicine_name}' "
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
    """Validate uploaded file type and content type."""
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
    """Save uploaded file to temp directory."""
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
    """Remove all files from the temp directory."""
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
