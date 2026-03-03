# Medicine OCR Service — FastAPI

A microservice that accepts prescription/tablet cover images and returns
structured medicine data: name, dosage, frequency, expiry.

Designed to be called by your **Spring Boot** backend.

---

## Project Structure

```
medicine_ocr_service/
├── app/
│   ├── main.py          # FastAPI routes
│   ├── ocr_engine.py    # Preprocessing + Tesseract OCR
│   ├── extractor.py     # Regex + DB fuzzy matching
│   └── db.py            # MySQL connection pool
├── run.py               # Entry point
└── requirements.txt
```

---

## Setup

### 1. Install Tesseract (Windows)
Download: https://github.com/UB-Mannheim/tesseract/wiki
Default path: `C:\Program Files\Tesseract-OCR\tesseract.exe`

### 2. Install Python dependencies
```bash
pip install -r requirements.txt
```

### 3. Configure MySQL
Edit `app/db.py`:
```python
DB_CONFIG = {
    "host":     "localhost",
    "port":     3306,
    "user":     "your_db_user",
    "password": "your_db_password",
    "database": "your_db_name",
}
```

### 4. Verify your medicines table schema
The extractor expects:
```sql
SELECT id, name, generic_name, category FROM medicines;
```
If your columns are named differently, update the query in `extractor.py → _load_medicines()`.

### 5. Run the service
```bash
python run.py
```
Service runs at: `http://localhost:8000`
Auto-docs at:    `http://localhost:8000/docs`

---

## API Endpoints

### POST `/ocr/scan`
Upload a prescription or tablet cover image.

**Request:** `multipart/form-data` with field `file` (JPG/PNG)

**Response:**
```json
{
  "status": "success",
  "raw_text": "Tab Paracetamol 500mg 1-0-1\nCap Amoxicillin 250mg BD",
  "medicines": [
    {
      "raw_line": "Tab Paracetamol 500mg 1-0-1",
      "candidate": "Paracetamol",
      "matched_medicine": {
        "id": 1042,
        "name": "Paracetamol",
        "generic_name": "Acetaminophen",
        "category": "Analgesic",
        "match_score": 100.0
      },
      "dosage": "500mg",
      "frequency": "1-0-1",
      "expiry": null
    }
  ],
  "processing_ms": 843
}
```

### GET `/medicine/search?q=para`
Search medicine names from DB (for manual lookup in React Native).

### GET `/health`
Health check — returns DB medicine count.

---

## Spring Boot Integration

Call the OCR service from your Spring Boot backend using `RestTemplate` or `WebClient`:

```java
// Spring Boot — call OCR microservice
@Service
public class OcrService {

    private final RestTemplate restTemplate = new RestTemplate();
    private final String OCR_BASE_URL = "http://localhost:8000";

    public OcrScanResponse scanPrescription(MultipartFile image) throws IOException {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);

        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("file", new ByteArrayResource(image.getBytes()) {
            @Override public String getFilename() { return image.getOriginalFilename(); }
        });

        HttpEntity<MultiValueMap<String, Object>> request = new HttpEntity<>(body, headers);

        return restTemplate.postForObject(
            OCR_BASE_URL + "/ocr/scan",
            request,
            OcrScanResponse.class
        );
    }
}
```

---

## React Native Integration

Send the camera frame/image directly from React Native to your Spring Boot,
which then forwards to this service. Or call it directly:

```javascript
// React Native — scan and upload image
const scanPrescription = async (imageUri) => {
  const formData = new FormData();
  formData.append('file', {
    uri: imageUri,
    type: 'image/jpeg',
    name: 'prescription.jpg',
  });

  const response = await fetch('http://YOUR_SERVER_IP:8000/ocr/scan', {
    method: 'POST',
    body: formData,
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  const data = await response.json();
  return data.medicines;  // array of extracted medicine objects
};
```

---

## How the Extraction Works

```
Image (from mobile camera)
        ↓
  Preprocessing
  - Upscale if small
  - CLAHE contrast enhancement
  - Gaussian denoise
  - Adaptive thresholding
  - Deskew (fix tilted captures)
        ↓
  Tesseract OCR  (OEM 3 LSTM + PSM 6)
        ↓
  Per-line extraction
  - Regex: dosage (500mg, 10ml...)
  - Regex: frequency (1-0-1, OD, BD, TDS...)
  - Regex: expiry date (Exp: 12/2026...)
  - Regex: name candidate (word after Tab/Cap/Syrup)
        ↓
  Fuzzy DB match (2 lakh medicines)
  - Exact match first
  - Starts-with narrowing
  - difflib SequenceMatcher (threshold: 60%)
        ↓
  Structured JSON response
```
