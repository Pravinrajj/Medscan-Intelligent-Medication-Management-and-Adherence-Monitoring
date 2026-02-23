from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pytesseract
from PIL import Image
from pyzbar.pyzbar import decode
import io
import shutil

app = FastAPI(title="MedScan ML Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# NOTE: Tesseract path might need to be set if not in PATH
# pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

@app.get("/")
def read_root():
    return {"message": "MedScan ML Service is running"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.post("/ocr/extract")
async def extract_text(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        
        # 1. Barcode Detection
        barcodes = decode(image)
        detected_barcodes = [b.data.decode('utf-8') for b in barcodes]
        
        # 2. OCR Text Extraction
        text = pytesseract.image_to_string(image)
        
        return {
            "filename": file.filename,
            "text": text.strip(),
            "barcodes": detected_barcodes,
            "message": "Extraction successful"
        }
    except Exception as e:
        # Log error
        print(f"Error processing image: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
