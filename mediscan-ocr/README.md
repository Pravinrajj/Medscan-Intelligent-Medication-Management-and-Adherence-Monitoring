# MediScan OCR — Prescription Text Extraction API (v4.1)

A production-ready FastAPI service that extracts and structures text from medical prescription images and tablet strip (blister pack) images.

**OCR backend:** Microsoft Azure AI Vision (Read API) — purpose-built for handwritten and printed text.

---

## What changed in v4.1

| Area | Before | After |
|---|---|---|
| OCR engine | EasyOCR (printed-text model) | Azure AI Vision Read API (handwriting model) |
| Prescription parser | Required `Tab`/`Cap` prefix | DB-first strategy — finds medicine names without any prefix |
| Strip noise filter | Detection-level (dropped entire bbox if any noise word present) | Word-level — strips noise tokens, keeps the brand name remainder |
| Strip scoring weights | Position 30%, font_size 15% | font_size 30%, position 20% — matches Indian blister pack layout |
| Repetition bonus | None | Brand name printed on every cell gets a score boost |
| DB match threshold | 75 / bonus 0.40 | 70 / bonus 0.50 — more aggressive DB confirmation |

---

## 📋 Features

- **Azure AI Vision OCR** — Read API with dedicated handwriting recognition, returns word-level bounding boxes
- **DB-first parsing** — checks every significant word against 195K medicine database before trying regex patterns
- **Word-level strip filtering** — "DOLO 650mg" → "DOLO" instead of being discarded entirely
- **Repetition bonus** — brand names printed on multiple blister cells ranked higher
- **Image Preprocessing** — Grayscale, CLAHE, denoising, adaptive thresholding via OpenCV
- **Frequency Normalization** — maps `BD`, `TDS`, `1-0-1` etc. to human-readable form
- **Confidence Scores** — per-word and aggregate OCR confidence returned in response
- **File Validation** — only accepts image files (JPEG, PNG, BMP, TIFF, WebP), max 10MB
- **Swagger UI** — interactive API docs at `/docs`
- **Docker Support** — production-ready Dockerfile included (no model download at build time)

---

## 🛠️ Setup

### Prerequisites

- Python 3.10+
- An Azure Cognitive Services resource with **Computer Vision** enabled
  - Create one at https://portal.azure.com → "Computer Vision"
  - Copy the **Endpoint** and **Key** from the "Keys and Endpoint" page

### Installation

```bash
cd mediscan-ocr
python -m venv venv
source venv/bin/activate    # Linux/Mac
venv\Scripts\activate       # Windows
pip install -r requirements.txt
```

### Configure credentials

Create a `.env` file in the project root:

```env
AZURE_VISION_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
AZURE_VISION_KEY=your_32_char_key_here
```

Or export them as environment variables:

```bash
export AZURE_VISION_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
export AZURE_VISION_KEY=your_32_char_key_here
```

---

## 🚀 Running the Server

```bash
python main.py
# or
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The server starts at `http://localhost:8000`. No model download occurs — the Azure client connects at runtime.

---

## 📡 API Endpoints

### `GET /health`

```json
{
  "status": "healthy",
  "version": "4.1.0",
  "ocr_backend": "Azure AI Vision (Read API)",
  "model_loaded": true,
  "database_loaded": true,
  "database_size": 195000,
  "timestamp": "2026-03-30T12:00:00.000000"
}
```

---

### `POST /extract-text/`

Upload a prescription image. Works on handwritten and printed prescriptions.

```json
{
  "filename": "prescription.jpg",
  "raw_text": "Paracetamol 500mg BD Amoxicillin 250mg TDS",
  "structured_data": [
    {
      "medicine": "Paracetamol",
      "dosage": "500mg",
      "frequency": "2 times/day",
      "confidence": 0.9523,
      "db_match": { "matched_name": "Paracetamol", "match_score": 100.0 }
    }
  ],
  "ocr_backend": "Azure AI Vision (Read API)",
  "confidence": { "average": 0.937, "min": 0.851, "max": 0.984 },
  "pipeline_stats": {
    "total_detections": 24,
    "after_positional_filter": 18,
    "grouped_lines": 6,
    "after_keyword_filter": 4,
    "medicines_found": 2
  },
  "processing_time_ms": 1450
}
```

---

### `POST /extract-medicine-name/`

Upload a tablet strip (blister pack) image.

```json
{
  "brand_name": "DOLO",
  "composition": ["Paracetamol (650mg)"],
  "confidence": 0.9812,
  "raw_text": "DOLO 650 DOLO 650 DOLO 650 ...",
  "ocr_backend": "Azure AI Vision (Read API)",
  "top_candidates": [
    {
      "text": "DOLO",
      "confidence": 0.9812,
      "score": 0.9100,
      "score_breakdown": {
        "length": 0.4, "uppercase": 1.0, "position": 1.0,
        "confidence": 0.981, "font_size": 0.95,
        "repeat_bonus": 0.2, "repeat_count": 3,
        "db_bonus": 0.5, "total": 0.91
      },
      "is_db_match": true
    }
  ],
  "db_match": { "matched_name": "Dolo 650", "match_score": 92.5 },
  "processing_time_ms": 980
}
```

---

## 🐳 Docker Deployment

```bash
# Build (no large model download — just the Azure SDK)
docker build -t mediscan-ocr .

# Run with env vars inline
docker run -p 8000:8000 \
  -e AZURE_VISION_ENDPOINT=https://your-resource.cognitiveservices.azure.com/ \
  -e AZURE_VISION_KEY=your-key \
  mediscan-ocr

# Or use an env file
docker run -p 8000:8000 --env-file .env mediscan-ocr
```

---

## 📁 Project Structure

```
mediscan-ocr/
├── main.py           # FastAPI entry point + API endpoints
├── ocr.py            # Azure AI Vision client + extraction
├── preprocess.py     # OpenCV image preprocessing pipeline
├── filter.py         # Positional + keyword filtering
├── cleaner.py        # OCR error correction + line grouping
├── parser.py         # DB-first + regex structured text parser
├── strip_reader.py   # Tablet strip brand name extractor (v2)
├── medicine_db.py    # 195K medicine CSV database + fuzzy matching
├── requirements.txt  # Python dependencies
├── Dockerfile        # Production container
└── README.md         # This file
```

---

## ⚙️ Pipeline Architecture

```
Prescription:
  Image → Preprocess → Azure Read API → Positional filter
        → OCR correction → Line grouping → Keyword filter
        → DB-first parser (no prefix needed) → JSON

Tablet Strip:
  Image → Grayscale + CLAHE → Azure Read API
        → Merge adjacent splits → Word-level noise filter
        → Score (font_size 30% + position 20% + confidence 20%)
        → Repetition bonus → DB-match bonus → JSON
```

## 🔑 Azure pricing note

The Azure Computer Vision Read API is billed per 1,000 pages (images).
Free tier: 5,000 transactions/month.
See https://azure.microsoft.com/pricing/details/cognitive-services/computer-vision/
