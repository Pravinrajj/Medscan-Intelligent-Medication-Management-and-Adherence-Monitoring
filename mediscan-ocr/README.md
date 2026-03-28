# MediScan OCR — Prescription Text Extraction API

A production-ready FastAPI service that extracts and structures text from medical prescription images using **EasyOCR** and **OpenCV**.

---

## 📋 Features

- **OCR Extraction** — Powered by EasyOCR with global model loading (no per-request overhead)
- **Image Preprocessing** — Grayscale, CLAHE, denoising, adaptive thresholding via OpenCV
- **Structured Parsing** — Regex + rule-based extraction of medicine name, dosage, frequency
- **Frequency Normalization** — Maps `BD`, `TDS`, `1-0-1` etc. to human-readable form
- **Medicine Name Correction** — Fuzzy matching against a curated dictionary of 60+ common medicines
- **Confidence Scores** — Per-word and aggregate OCR confidence returned in response
- **File Validation** — Only accepts image files (JPEG, PNG, BMP, TIFF, WebP), max 10MB
- **Swagger UI** — Interactive API docs at `/docs`
- **Docker Support** — Production-ready Dockerfile included

---

## 🛠️ Setup

### Prerequisites

- Python 3.10+
- pip

### Installation

```bash
# Navigate to the project
cd mediscan-ocr

# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate    # Linux/Mac
venv\Scripts\activate       # Windows

# Install dependencies
pip install -r requirements.txt
```

---

## 🚀 Running the Server

```bash
# Start the server
python main.py

# Or use uvicorn directly
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The server will start at `http://localhost:8000`.

> **Note:** On first startup, EasyOCR will download the text detection and recognition models (~100MB). Subsequent starts will use the cached models.

---

## 📡 API Endpoints

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "model_loaded": true,
  "timestamp": "2026-03-18T19:00:00.000000"
}
```

---

### `POST /extract-text/`

Upload a prescription image and get extracted text + structured medicine data.

**Request:** `multipart/form-data` with `file` field.

**Response:**
```json
{
  "filename": "prescription.jpg",
  "raw_text": "Tab Paracetamol 500mg BD Tab Amoxicillin 250mg TDS",
  "structured_data": [
    {
      "medicine": "Paracetamol",
      "dosage": "500mg",
      "frequency": "2 times/day",
      "confidence": 0.9523,
      "corrected_name": "Paracetamol"
    },
    {
      "medicine": "Amoxicillin",
      "dosage": "250mg",
      "frequency": "3 times/day",
      "confidence": 0.9217,
      "corrected_name": "Amoxicillin"
    }
  ],
  "confidence": {
    "average": 0.9370,
    "min": 0.8512,
    "max": 0.9845
  },
  "word_count": 8,
  "processing_time_ms": 1234
}
```

---

## 🧪 Testing

### Using cURL

```bash
# Health check
curl http://localhost:8000/health

# Upload prescription image
curl -X POST "http://localhost:8000/extract-text/" \
  -H "accept: application/json" \
  -F "file=@/path/to/prescription.jpg"
```

### Using Swagger UI

Open [http://localhost:8000/docs](http://localhost:8000/docs) in your browser to access the interactive API documentation. You can upload images and test the endpoint directly.

### Using Python

```python
import requests

url = "http://localhost:8000/extract-text/"
files = {"file": open("prescription.jpg", "rb")}
response = requests.post(url, files=files)
print(response.json())
```

---

## 🐳 Docker Deployment

```bash
# Build
docker build -t mediscan-ocr .

# Run
docker run -p 8000:8000 mediscan-ocr

# With environment variables
docker run -p 8000:8000 -e LOG_LEVEL=debug mediscan-ocr
```

---

## 📁 Project Structure

```
mediscan-ocr/
├── main.py              # FastAPI entry point + API endpoint
├── ocr.py               # EasyOCR wrapper (global model loading)
├── preprocess.py         # OpenCV image preprocessing pipeline
├── parser.py             # Regex + NLP structured text parser
├── requirements.txt      # Python dependencies
├── Dockerfile            # Production container
├── README.md             # This file
└── temp/                 # Temporary image storage (auto-created)
```

---

## ⚙️ Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐     ┌────────────┐
│  Image      │ ──▶ │  Preprocess  │ ──▶ │  EasyOCR   │ ──▶ │  Parser    │
│  Upload     │     │  (OpenCV)    │     │  Extract   │     │  (Regex)   │
└─────────────┘     └──────────────┘     └────────────┘     └────────────┘
                         │                     │                  │
                    • Grayscale           • Text detect      • Medicine name
                    • CLAHE               • Confidence        • Dosage
                    • Denoise             • Word-level        • Frequency
                    • Threshold             results           • Correction
                                                              
                                              ▼
                                     ┌────────────────┐
                                     │  JSON Response │
                                     │  raw + struct  │
                                     └────────────────┘
```
