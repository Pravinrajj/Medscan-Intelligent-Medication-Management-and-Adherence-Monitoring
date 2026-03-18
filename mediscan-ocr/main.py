"""
MediScan OCR — FastAPI Entry Point
====================================
Production-ready API for prescription text extraction.

Endpoints:
    POST /extract-text/  — Upload prescription image, get structured OCR output
    GET  /health         — Service health check

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

from preprocess import preprocess_image
from ocr import load_ocr_model, extract_text, is_model_loaded
from parser import parse_prescription_text

# ═══════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════

TEMP_DIR = Path("temp")
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}
MAX_FILE_SIZE_MB = 10

# Logging setup
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
    """
    Startup: Load EasyOCR model + create temp directory.
    Shutdown: Clean up temp files.
    """
    logger.info("=" * 60)
    logger.info("  MediScan OCR Service — Starting Up")
    logger.info("=" * 60)

    # Create temp directory for uploaded images
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Temp directory: {TEMP_DIR.absolute()}")

    # Load EasyOCR model globally (one-time expensive operation)
    logger.info("Loading EasyOCR model (this may take a moment)...")
    model_loaded = load_ocr_model(gpu=False)

    if model_loaded:
        logger.info("✅ EasyOCR model loaded successfully")
    else:
        logger.error("❌ Failed to load EasyOCR model — API will return errors")

    logger.info("🚀 MediScan OCR Service ready!")
    logger.info("   Docs: http://localhost:8000/docs")
    logger.info("=" * 60)

    yield  # Application runs here

    # Shutdown: clean up temp files
    logger.info("Shutting down — cleaning temp files...")
    _cleanup_temp_dir()
    logger.info("MediScan OCR Service stopped")


# ═══════════════════════════════════════════════════════════════════
# FastAPI Application
# ═══════════════════════════════════════════════════════════════════

app = FastAPI(
    title="MediScan OCR API",
    description=(
        "Prescription text extraction API using EasyOCR.\n\n"
        "Upload a prescription image and receive structured medicine data "
        "including medicine name, dosage, and frequency."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow mobile app and frontend access
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
    """
    Service health check.

    Returns model status, uptime info, and temp directory status.
    """
    return {
        "status": "healthy",
        "model_loaded": is_model_loaded(),
        "timestamp": datetime.now().isoformat(),
        "temp_dir": str(TEMP_DIR.absolute()),
    }


@app.post("/extract-text/")
async def extract_text_from_prescription(file: UploadFile = File(...)):
    """
    Extract text from a prescription image.

    **Accepts:** Image file (`multipart/form-data`) — JPEG, PNG, BMP, TIFF, WebP

    **Returns:** JSON with raw OCR text and structured medicine data.

    **Pipeline:**
    1. Validate uploaded file (type + size)
    2. Save to temp storage
    3. Preprocess image (grayscale, denoise, threshold)
    4. Extract text via EasyOCR
    5. Parse structured medicine info (name, dosage, frequency)
    6. Return JSON response + clean up temp file
    """
    start_time = time.time()
    request_id = str(uuid.uuid4())[:8]
    temp_path = None

    logger.info(f"[{request_id}] New request: filename={file.filename}")

    try:
        # ── Step 1: Validate file ─────────────────────────────────
        _validate_file(file)

        # ── Step 2: Save to temp ──────────────────────────────────
        temp_path = await _save_temp_file(file, request_id)
        logger.info(f"[{request_id}] Saved temp file: {temp_path}")

        # ── Step 3: Read and preprocess image ─────────────────────
        image = cv2.imread(str(temp_path))
        if image is None:
            raise HTTPException(
                status_code=400,
                detail="Could not decode image — file may be corrupted"
            )

        logger.info(f"[{request_id}] Image loaded: {image.shape[1]}x{image.shape[0]}px")

        # Preprocess (grayscale, denoise, threshold)
        preprocessed = preprocess_image(image)

        # ── Step 4: OCR extraction ────────────────────────────────
        if not is_model_loaded():
            raise HTTPException(
                status_code=503,
                detail="OCR model not loaded — service is starting up, try again"
            )

        ocr_result = extract_text(preprocessed)

        if ocr_result is None:
            raise HTTPException(
                status_code=500,
                detail="OCR extraction failed — internal error"
            )

        raw_text = ocr_result.raw_text
        logger.info(f"[{request_id}] OCR raw text: '{raw_text[:100]}...'")

        # ── Step 5: Parse structured medicine data ────────────────
        structured_data = parse_prescription_text(raw_text)

        # ── Step 6: Build response ────────────────────────────────
        elapsed_ms = int((time.time() - start_time) * 1000)

        response = {
            "filename": file.filename,
            "raw_text": raw_text,
            "structured_data": [m.to_dict() for m in structured_data],
            "confidence": {
                "average": ocr_result.avg_confidence,
                "min": ocr_result.min_confidence,
                "max": ocr_result.max_confidence,
            },
            "word_count": ocr_result.word_count,
            "processing_time_ms": elapsed_ms,
        }

        logger.info(
            f"[{request_id}] ✅ Complete: "
            f"{len(structured_data)} medicine(s), "
            f"{ocr_result.word_count} words, "
            f"{elapsed_ms}ms"
        )

        return response

    except HTTPException:
        raise  # Re-raise FastAPI HTTP exceptions as-is

    except Exception as e:
        logger.error(f"[{request_id}] Unexpected error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )

    finally:
        # ── Clean up temp file ────────────────────────────────────
        if temp_path and temp_path.exists():
            try:
                temp_path.unlink()
                logger.debug(f"[{request_id}] Temp file cleaned up: {temp_path}")
            except Exception as e:
                logger.warning(f"[{request_id}] Failed to clean up temp: {e}")


# ═══════════════════════════════════════════════════════════════════
# Helper Functions
# ═══════════════════════════════════════════════════════════════════

def _validate_file(file: UploadFile) -> None:
    """
    Validate the uploaded file:
      - Must have a filename
      - Extension must be an allowed image type
      - Content type must be image/*
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Check file extension
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type: '{ext}'. "
                f"Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            )
        )

    # Check content type
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid content type: '{file.content_type}'. Must be an image."
        )


async def _save_temp_file(file: UploadFile, request_id: str) -> Path:
    """
    Save the uploaded file to the temp directory with a unique name.

    Returns:
        Path to the saved temp file
    """
    ext = Path(file.filename).suffix.lower()
    temp_filename = f"{request_id}_{file.filename}"
    temp_path = TEMP_DIR / temp_filename

    contents = await file.read()

    # Check file size
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
