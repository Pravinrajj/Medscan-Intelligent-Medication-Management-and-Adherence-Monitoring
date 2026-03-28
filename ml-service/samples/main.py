"""
Medicine OCR Service — FastAPI
Endpoints consumed by Spring Boot backend
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import numpy as np
import cv2
import time

from app.ocr_engine   import preprocess_image, run_ocr
from app.extractor    import MedicineExtractor
from app.db           import get_db_connection

app = FastAPI(
    title="Medicine OCR Service",
    description="OCR-based medicine name, dosage, frequency and expiry extractor",
    version="1.0.0"
)

# Allow calls from Spring Boot / React Native
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Load extractor once at startup ──
extractor: MedicineExtractor = None

@app.on_event("startup")
async def startup_event():
    global extractor
    print("[STARTUP] Connecting to MySQL medicine database...")
    conn = get_db_connection()
    extractor = MedicineExtractor(conn)
    print(f"[STARTUP] Loaded {extractor.medicine_count:,} medicines from DB.")


# ─────────────────────────────────────────────────────────
# ENDPOINT 1: Scan image → extract all medicine details
# POST /ocr/scan
# Body: multipart/form-data  { file: <image> }
# ─────────────────────────────────────────────────────────
@app.post("/ocr/scan")
async def scan_prescription(file: UploadFile = File(...)):
    """
    Accepts a prescription or tablet cover image.
    Returns extracted medicine name, dosage, frequency, expiry.
    """
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image (JPG/PNG)")

    start = time.time()

    # Read image bytes → OpenCV array
    raw = await file.read()
    img_array = np.frombuffer(raw, np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=422, detail="Could not decode image")

    # Preprocess + OCR
    processed   = preprocess_image(img)
    raw_text    = run_ocr(processed)

    # Extract structured fields
    results     = extractor.extract_all(raw_text)

    elapsed = round(time.time() - start, 3)

    return JSONResponse({
        "status":        "success",
        "raw_text":      raw_text,
        "medicines":     results,          # list of matched medicine objects
        "processing_ms": int(elapsed * 1000)
    })


# ─────────────────────────────────────────────────────────
# ENDPOINT 2: Search medicine by name (for manual lookup)
# GET /medicine/search?q=paracetamol
# ─────────────────────────────────────────────────────────
@app.get("/medicine/search")
async def search_medicine(q: str):
    if len(q) < 2:
        raise HTTPException(status_code=400, detail="Query too short")
    results = extractor.search_by_name(q)
    return JSONResponse({"query": q, "results": results})


# ─────────────────────────────────────────────────────────
# ENDPOINT 3: Health check (Spring Boot can ping this)
# GET /health
# ─────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "medicine_db_count": extractor.medicine_count if extractor else 0}
