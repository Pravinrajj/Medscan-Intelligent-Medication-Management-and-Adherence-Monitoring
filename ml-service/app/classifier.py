"""
MediScan — Stage 6: CNN Classification
========================================
EfficientNet-B0 inference for medicine brand classification.
Returns Top-K predictions with confidence scores.
"""

import json
import logging
from pathlib import Path
from typing import List, Optional
from dataclasses import dataclass

import numpy as np
import torch
import torch.nn as nn
from torchvision import transforms, models
from PIL import Image

logger = logging.getLogger(__name__)

# Model configuration
IMAGE_SIZE = 224
TOP_K = 3
MODEL_DIR = Path(__file__).parent.parent / 'models'

# Global model cache
_model = None
_class_mapping = None
_device = None
_transform = None


@dataclass
class ClassificationResult:
    """Result of CNN classification for a single crop."""
    predictions: List[dict]   # Top-K predictions [{name, confidence}]
    top_prediction: str       # Best prediction name
    top_confidence: float     # Best prediction confidence

    def to_dict(self):
        return {
            'predictions': self.predictions,
            'top_prediction': self.top_prediction,
            'top_confidence': round(self.top_confidence, 4),
        }


def _build_model(num_classes: int) -> nn.Module:
    """Build EfficientNet-B0 with custom classifier head."""
    model = models.efficientnet_b0(weights=None)
    in_features = model.classifier[1].in_features
    model.classifier = nn.Sequential(
        nn.Dropout(p=0.3),
        nn.Linear(in_features, 256),
        nn.ReLU(inplace=True),
        nn.Dropout(p=0.2),
        nn.Linear(256, num_classes),
    )
    return model


def _get_eval_transform() -> transforms.Compose:
    """Inference transform (deterministic, no augmentation)."""
    return transforms.Compose([
        transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406],
                             std=[0.229, 0.224, 0.225]),
    ])


def load_model(model_dir: str = None) -> bool:
    """
    Load trained model and class mapping.
    Called once at FastAPI startup.
    
    Returns:
        True if model loaded successfully, False otherwise
    """
    global _model, _class_mapping, _device, _transform

    model_path = Path(model_dir) if model_dir else MODEL_DIR
    weights_file = model_path / 'model.pth'
    mapping_file = model_path / 'class_mapping.json'

    if not weights_file.exists():
        logger.warning(f"Model file not found: {weights_file}")
        logger.warning("CNN classification will be unavailable")
        return False

    if not mapping_file.exists():
        logger.warning(f"Class mapping not found: {mapping_file}")
        return False

    try:
        # Load class mapping
        with open(mapping_file) as f:
            _class_mapping = json.load(f)

        num_classes = _class_mapping['num_classes']
        logger.info(f"Loaded class mapping: {num_classes} classes, version {_class_mapping.get('version', 'unknown')}")

        # Load model
        _device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        _model = _build_model(num_classes)

        checkpoint = torch.load(weights_file, map_location=_device, weights_only=True)
        _model.load_state_dict(checkpoint['model_state_dict'])
        _model.to(_device)
        _model.eval()

        _transform = _get_eval_transform()

        logger.info(f"Model loaded on {_device} (val_acc={checkpoint.get('val_acc', 'N/A')}%)")
        return True

    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        _model = None
        return False


def is_model_loaded() -> bool:
    """Check if model is ready for inference."""
    return _model is not None


def get_model_version() -> str:
    """Get current model version string."""
    if _class_mapping:
        return _class_mapping.get('version', 'unknown')
    return 'not_loaded'


def classify_image(image_np: np.ndarray) -> Optional[ClassificationResult]:
    """
    Classify a single image crop using the CNN model.
    
    Args:
        image_np: BGR image (OpenCV format) or RGB
    
    Returns:
        ClassificationResult with Top-K predictions, or None if model unavailable
    """
    if not is_model_loaded():
        return None

    try:
        # Convert numpy (BGR) to PIL (RGB)
        if len(image_np.shape) == 3 and image_np.shape[2] == 3:
            image_rgb = image_np[:, :, ::-1]  # BGR → RGB
        else:
            image_rgb = image_np

        pil_image = Image.fromarray(image_rgb).convert('RGB')

        # Transform and add batch dimension
        tensor = _transform(pil_image).unsqueeze(0).to(_device)

        # Inference
        with torch.no_grad():
            outputs = _model(tensor)
            probs = torch.softmax(outputs, dim=1)[0]

        # Get Top-K predictions
        topk_probs, topk_indices = torch.topk(probs, min(TOP_K, len(probs)))

        index_to_brand = _class_mapping['index_to_brand']
        predictions = []
        for prob, idx in zip(topk_probs.cpu().numpy(), topk_indices.cpu().numpy()):
            brand_name = index_to_brand.get(str(int(idx)), f'class_{idx}')
            predictions.append({
                'name': brand_name,
                'confidence': round(float(prob), 4),
            })

        return ClassificationResult(
            predictions=predictions,
            top_prediction=predictions[0]['name'],
            top_confidence=predictions[0]['confidence'],
        )

    except Exception as e:
        logger.error(f"Classification failed: {e}")
        return None


def classify_batch(images: List[np.ndarray]) -> List[Optional[ClassificationResult]]:
    """
    Classify multiple image crops in a batch.
    
    Args:
        images: List of BGR images (OpenCV format)
    
    Returns:
        List of ClassificationResult (one per image)
    """
    if not is_model_loaded() or not images:
        return [None] * len(images)

    try:
        # Prepare batch tensor
        tensors = []
        for img in images:
            if len(img.shape) == 3 and img.shape[2] == 3:
                img_rgb = img[:, :, ::-1]
            else:
                img_rgb = img
            pil = Image.fromarray(img_rgb).convert('RGB')
            tensors.append(_transform(pil))

        batch = torch.stack(tensors).to(_device)

        # Batch inference
        with torch.no_grad():
            outputs = _model(batch)
            all_probs = torch.softmax(outputs, dim=1)

        # Process each result
        index_to_brand = _class_mapping['index_to_brand']
        results = []
        for i in range(len(images)):
            probs = all_probs[i]
            topk_probs, topk_indices = torch.topk(probs, min(TOP_K, len(probs)))

            predictions = []
            for prob, idx in zip(topk_probs.cpu().numpy(), topk_indices.cpu().numpy()):
                brand_name = index_to_brand.get(str(int(idx)), f'class_{idx}')
                predictions.append({
                    'name': brand_name,
                    'confidence': round(float(prob), 4),
                })

            results.append(ClassificationResult(
                predictions=predictions,
                top_prediction=predictions[0]['name'],
                top_confidence=predictions[0]['confidence'],
            ))

        return results

    except Exception as e:
        logger.error(f"Batch classification failed: {e}")
        return [None] * len(images)


def get_brand_generic(brand_name: str) -> Optional[str]:
    """Look up generic name for a brand from class mapping."""
    if _class_mapping and 'brand_to_generic' in _class_mapping:
        return _class_mapping['brand_to_generic'].get(brand_name)
    return None
