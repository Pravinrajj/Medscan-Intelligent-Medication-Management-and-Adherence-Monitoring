# ─────────────────────────────────────────────────
# MediScan OCR — Dockerfile (v4.2 — Google Cloud Vision)
# ─────────────────────────────────────────────────
# No large model files downloaded at build time.
# The google-cloud-vision SDK connects to the GCP API at runtime.
#
# Authentication — pass ONE of the following at runtime:
#
#   Option 1: Service account key file (mount into container)
#     docker run -p 8000:8000 \
#       -v /host/path/sa-key.json:/secrets/sa-key.json \
#       -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa-key.json \
#       mediscan-ocr
#
#   Option 2: Inline JSON credentials via env var
#     docker run -p 8000:8000 \
#       -e GCP_VISION_CREDENTIALS_JSON="$(cat sa-key.json)" \
#       mediscan-ocr
#
#   Option 3: Workload Identity (GKE / Cloud Run — no env var needed)
#     The SDK picks up the attached service account automatically.
#
# Build:  docker build -t mediscan-ocr .
# ─────────────────────────────────────────────────

FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# System dependencies for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install -r requirements.txt

COPY . .

RUN mkdir -p temp

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
