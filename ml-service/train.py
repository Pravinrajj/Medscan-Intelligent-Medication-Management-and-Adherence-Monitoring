"""
MediScan — Medicine Name Classifier Training Script
====================================================
EfficientNet-B0 fine-tuned on 78-brand medicine word-crop dataset.
Designed to run on Google Colab (GPU) or locally (CPU).

Usage (Colab):
    1. Upload dataset/ folder to Google Drive
    2. Mount drive:  from google.colab import drive; drive.mount('/content/drive')
    3. Update DATASET_ROOT below to your Drive path
    4. !pip install torch torchvision scikit-learn matplotlib pandas
    5. !python train.py

Usage (Local):
    python train.py --data ./dataset --epochs 30 --batch-size 32
"""

import os
import json
import time
import argparse
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms, models

from sklearn.preprocessing import LabelEncoder
from PIL import Image
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


# ═══════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════

# Default dataset path (override via --data argument)
DATASET_ROOT = "./dataset"

# Model config
MODEL_VERSION = "v1.0"
NUM_WORKERS = 2
IMAGE_SIZE = 224
SEED = 42


def set_seed(seed):
    """Reproducibility."""
    torch.manual_seed(seed)
    np.random.seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


# ═══════════════════════════════════════════════════════════════════
# Dataset
# ═══════════════════════════════════════════════════════════════════

class MedicineDataset(Dataset):
    """Loads medicine word-crop images with labels from CSV."""

    def __init__(self, csv_path, images_dir, transform=None, label_encoder=None, fit_encoder=False):
        self.df = pd.read_csv(csv_path)
        self.images_dir = Path(images_dir)
        self.transform = transform

        if fit_encoder:
            self.label_encoder = LabelEncoder()
            self.labels = self.label_encoder.fit_transform(self.df['MEDICINE_NAME'].values)
        else:
            self.label_encoder = label_encoder
            self.labels = self.label_encoder.transform(self.df['MEDICINE_NAME'].values)

        # Build brand → generic mapping
        self.brand_to_generic = dict(
            zip(self.df['MEDICINE_NAME'], self.df['GENERIC_NAME'])
        )

    def __len__(self):
        return len(self.df)

    def __getitem__(self, idx):
        row = self.df.iloc[idx]
        img_path = self.images_dir / row['IMAGE']

        # Load image (handle grayscale → RGB)
        image = Image.open(img_path).convert('RGB')

        if self.transform:
            image = self.transform(image)

        label = self.labels[idx]
        return image, label


# ═══════════════════════════════════════════════════════════════════
# Transforms (Data Augmentation)
# ═══════════════════════════════════════════════════════════════════

def get_train_transforms():
    """Training augmentation — simulates real-world capture conditions."""
    return transforms.Compose([
        transforms.Resize((IMAGE_SIZE + 32, IMAGE_SIZE + 32)),
        transforms.RandomCrop(IMAGE_SIZE),
        transforms.RandomRotation(15),
        transforms.RandomPerspective(distortion_scale=0.2, p=0.3),
        transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.2, hue=0.05),
        transforms.GaussianBlur(kernel_size=3, sigma=(0.1, 1.5)),
        transforms.RandomGrayscale(p=0.05),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406],
                             std=[0.229, 0.224, 0.225]),
        transforms.RandomErasing(p=0.1, scale=(0.02, 0.15)),
    ])


def get_eval_transforms():
    """Validation/test — deterministic, no augmentation."""
    return transforms.Compose([
        transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406],
                             std=[0.229, 0.224, 0.225]),
    ])


# ═══════════════════════════════════════════════════════════════════
# Model
# ═══════════════════════════════════════════════════════════════════

def build_model(num_classes, device):
    """EfficientNet-B0 with custom classification head."""
    model = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)

    # Freeze backbone initially
    for param in model.features.parameters():
        param.requires_grad = False

    # Replace classifier head
    in_features = model.classifier[1].in_features  # 1280
    model.classifier = nn.Sequential(
        nn.Dropout(p=0.3),
        nn.Linear(in_features, 256),
        nn.ReLU(inplace=True),
        nn.Dropout(p=0.2),
        nn.Linear(256, num_classes),
    )

    return model.to(device)


def unfreeze_backbone(model, lr_backbone=1e-5, lr_head=1e-3):
    """Unfreeze backbone for fine-tuning after initial head training."""
    for param in model.features.parameters():
        param.requires_grad = True

    optimizer = optim.AdamW([
        {'params': model.features.parameters(), 'lr': lr_backbone},
        {'params': model.classifier.parameters(), 'lr': lr_head},
    ], weight_decay=1e-4)

    return optimizer


# ═══════════════════════════════════════════════════════════════════
# Training Loop
# ═══════════════════════════════════════════════════════════════════

def train_one_epoch(model, loader, criterion, optimizer, device, scaler=None):
    """Train for one epoch. Returns (loss, accuracy)."""
    model.train()
    running_loss = 0.0
    correct = 0
    total = 0

    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)

        optimizer.zero_grad()

        # Mixed precision training
        if scaler and device.type == 'cuda':
            with torch.amp.autocast('cuda'):
                outputs = model(images)
                loss = criterion(outputs, labels)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
        else:
            outputs = model(images)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()

        running_loss += loss.item() * images.size(0)
        _, predicted = outputs.max(1)
        total += labels.size(0)
        correct += predicted.eq(labels).sum().item()

    epoch_loss = running_loss / total
    epoch_acc = 100.0 * correct / total
    return epoch_loss, epoch_acc


@torch.no_grad()
def evaluate(model, loader, criterion, device):
    """Evaluate on validation/test set. Returns (loss, accuracy)."""
    model.eval()
    running_loss = 0.0
    correct = 0
    total = 0

    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        outputs = model(images)
        loss = criterion(outputs, labels)

        running_loss += loss.item() * images.size(0)
        _, predicted = outputs.max(1)
        total += labels.size(0)
        correct += predicted.eq(labels).sum().item()

    epoch_loss = running_loss / total
    epoch_acc = 100.0 * correct / total
    return epoch_loss, epoch_acc


# ═══════════════════════════════════════════════════════════════════
# Plotting
# ═══════════════════════════════════════════════════════════════════

def plot_training_curves(history, output_dir):
    """Save loss and accuracy curves."""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

    epochs = range(1, len(history['train_loss']) + 1)

    # Loss
    ax1.plot(epochs, history['train_loss'], 'b-', label='Train Loss')
    ax1.plot(epochs, history['val_loss'], 'r-', label='Val Loss')
    ax1.set_title('Training & Validation Loss')
    ax1.set_xlabel('Epoch')
    ax1.set_ylabel('Loss')
    ax1.legend()
    ax1.grid(True, alpha=0.3)

    # Accuracy
    ax2.plot(epochs, history['train_acc'], 'b-', label='Train Acc')
    ax2.plot(epochs, history['val_acc'], 'r-', label='Val Acc')
    ax2.set_title('Training & Validation Accuracy')
    ax2.set_xlabel('Epoch')
    ax2.set_ylabel('Accuracy (%)')
    ax2.legend()
    ax2.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(output_dir / 'training_curves.png', dpi=150, bbox_inches='tight')
    plt.close()
    print(f"  📊 Saved training_curves.png")


# ═══════════════════════════════════════════════════════════════════
# Main Training
# ═══════════════════════════════════════════════════════════════════

def main(args):
    set_seed(SEED)
    start_time = time.time()

    # Paths
    data_root = Path(args.data)
    output_dir = Path(args.output)
    models_dir = output_dir / 'models'
    output_dir.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)

    # Device
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"\n{'='*60}")
    print(f"  MediScan Medicine Classifier — Training")
    print(f"  Model: EfficientNet-B0 | Version: {MODEL_VERSION}")
    print(f"  Device: {device}")
    if device.type == 'cuda':
        print(f"  GPU: {torch.cuda.get_device_name(0)}")
    print(f"  Dataset: {data_root}")
    print(f"{'='*60}\n")

    # ── Load Datasets ──────────────────────────────────────────
    print("📁 Loading datasets...")

    train_dataset = MedicineDataset(
        csv_path=data_root / 'Training' / 'training_labels.csv',
        images_dir=data_root / 'Training' / 'training_words',
        transform=get_train_transforms(),
        fit_encoder=True,
    )

    label_encoder = train_dataset.label_encoder
    num_classes = len(label_encoder.classes_)

    val_dataset = MedicineDataset(
        csv_path=data_root / 'Validation' / 'validation_labels.csv',
        images_dir=data_root / 'Validation' / 'validation_words',
        transform=get_eval_transforms(),
        label_encoder=label_encoder,
    )

    test_dataset = MedicineDataset(
        csv_path=data_root / 'Testing' / 'testing_labels.csv',
        images_dir=data_root / 'Testing' / 'testing_words',
        transform=get_eval_transforms(),
        label_encoder=label_encoder,
    )

    print(f"  Training:   {len(train_dataset):,} images")
    print(f"  Validation: {len(val_dataset):,} images")
    print(f"  Testing:    {len(test_dataset):,} images")
    print(f"  Classes:    {num_classes} medicine brands")
    print(f"  Generics:   {len(set(train_dataset.brand_to_generic.values()))} categories\n")

    # DataLoaders
    train_loader = DataLoader(train_dataset, batch_size=args.batch_size,
                              shuffle=True, num_workers=NUM_WORKERS, pin_memory=True)
    val_loader = DataLoader(val_dataset, batch_size=args.batch_size,
                            shuffle=False, num_workers=NUM_WORKERS, pin_memory=True)
    test_loader = DataLoader(test_dataset, batch_size=args.batch_size,
                             shuffle=False, num_workers=NUM_WORKERS, pin_memory=True)

    # ── Build Model ────────────────────────────────────────────
    print("🏗️  Building EfficientNet-B0 model...")
    model = build_model(num_classes, device)
    criterion = nn.CrossEntropyLoss()
    scaler = torch.amp.GradScaler('cuda') if device.type == 'cuda' else None

    # Phase 1 optimizer: only train classifier head
    optimizer = optim.AdamW(model.classifier.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingWarmRestarts(optimizer, T_0=10, T_mult=1)

    # ── Training ───────────────────────────────────────────────
    history = {'train_loss': [], 'train_acc': [], 'val_loss': [], 'val_acc': []}
    best_val_acc = 0.0
    patience_counter = 0
    unfreeze_epoch = args.unfreeze_epoch

    print(f"\n🚀 Starting training ({args.epochs} epochs, patience={args.patience})")
    print(f"   Phase 1: Frozen backbone, training head only (epochs 1-{unfreeze_epoch})")
    print(f"   Phase 2: Full fine-tuning (epochs {unfreeze_epoch+1}+)\n")

    for epoch in range(1, args.epochs + 1):
        epoch_start = time.time()

        # Unfreeze backbone at specified epoch
        if epoch == unfreeze_epoch + 1:
            print(f"\n  🔓 Unfreezing backbone at epoch {epoch}")
            optimizer = unfreeze_backbone(model, lr_backbone=1e-5, lr_head=args.lr * 0.1)
            scheduler = optim.lr_scheduler.CosineAnnealingWarmRestarts(optimizer, T_0=10)

        # Train & validate
        train_loss, train_acc = train_one_epoch(model, train_loader, criterion,
                                                optimizer, device, scaler)
        val_loss, val_acc = evaluate(model, val_loader, criterion, device)
        scheduler.step()

        # Record history
        history['train_loss'].append(train_loss)
        history['train_acc'].append(train_acc)
        history['val_loss'].append(val_loss)
        history['val_acc'].append(val_acc)

        elapsed = time.time() - epoch_start
        lr_current = optimizer.param_groups[0]['lr']

        print(f"  Epoch {epoch:2d}/{args.epochs} │ "
              f"Train: {train_acc:5.1f}% (loss={train_loss:.4f}) │ "
              f"Val: {val_acc:5.1f}% (loss={val_loss:.4f}) │ "
              f"LR: {lr_current:.2e} │ {elapsed:.1f}s")

        # Save best model
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            patience_counter = 0
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
                'val_acc': val_acc,
                'val_loss': val_loss,
                'num_classes': num_classes,
            }, models_dir / 'model.pth')
            print(f"  ✅ Best model saved (val_acc={val_acc:.1f}%)")
        else:
            patience_counter += 1
            if patience_counter >= args.patience:
                print(f"\n  ⏹️  Early stopping at epoch {epoch} (no improvement for {args.patience} epochs)")
                break

    # ── Final Test Evaluation ──────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  Loading best model for test evaluation...")
    checkpoint = torch.load(models_dir / 'model.pth', map_location=device, weights_only=True)
    model.load_state_dict(checkpoint['model_state_dict'])
    test_loss, test_acc = evaluate(model, test_loader, criterion, device)
    print(f"  📋 Test Accuracy: {test_acc:.2f}%")
    print(f"  📋 Test Loss:     {test_loss:.4f}")
    print(f"{'='*60}\n")

    # ── Save Artifacts ─────────────────────────────────────────
    # 1. Class mapping (brand → index, brand → generic)
    class_mapping = {
        'version': MODEL_VERSION,
        'num_classes': num_classes,
        'index_to_brand': {int(i): name for i, name in enumerate(label_encoder.classes_)},
        'brand_to_index': {name: int(i) for i, name in enumerate(label_encoder.classes_)},
        'brand_to_generic': train_dataset.brand_to_generic,
    }
    with open(models_dir / 'class_mapping.json', 'w') as f:
        json.dump(class_mapping, f, indent=2)
    print("  📄 Saved class_mapping.json")

    # 2. Model metadata
    total_time = time.time() - start_time
    metadata = {
        'model_version': MODEL_VERSION,
        'architecture': 'EfficientNet-B0',
        'num_classes': num_classes,
        'image_size': IMAGE_SIZE,
        'best_val_accuracy': round(best_val_acc, 2),
        'test_accuracy': round(test_acc, 2),
        'training_images': len(train_dataset),
        'total_training_time_seconds': round(total_time, 1),
        'trained_on': 'GPU' if device.type == 'cuda' else 'CPU',
        'gpu_name': torch.cuda.get_device_name(0) if device.type == 'cuda' else None,
        'framework': f'PyTorch {torch.__version__}',
        'date': datetime.now().isoformat(),
        'early_stopped_at_epoch': checkpoint['epoch'],
    }
    with open(models_dir / 'model_metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)
    print("  📄 Saved model_metadata.json")

    # 3. Training curves
    plot_training_curves(history, output_dir)

    # 4. ONNX export (optional)
    if args.export_onnx:
        print("  📦 Exporting ONNX model...")
        model.eval()
        dummy_input = torch.randn(1, 3, IMAGE_SIZE, IMAGE_SIZE).to(device)
        torch.onnx.export(model, dummy_input, str(models_dir / 'model.onnx'),
                          input_names=['image'], output_names=['prediction'],
                          dynamic_axes={'image': {0: 'batch'}, 'prediction': {0: 'batch'}},
                          opset_version=13)
        print("  ✅ Saved model.onnx")

    # Summary
    print(f"\n{'='*60}")
    print(f"  ✅ Training Complete!")
    print(f"  Best Validation Accuracy: {best_val_acc:.2f}%")
    print(f"  Test Accuracy:            {test_acc:.2f}%")
    print(f"  Total Time:               {total_time/60:.1f} minutes")
    print(f"  Output:                   {output_dir}")
    print(f"{'='*60}\n")

    print("  Files saved:")
    print(f"    models/model.pth           — PyTorch model checkpoint")
    print(f"    models/class_mapping.json   — Brand↔Index↔Generic mapping")
    print(f"    models/model_metadata.json  — Training metadata")
    print(f"    training_curves.png         — Loss/accuracy plots")
    if args.export_onnx:
        print(f"    models/model.onnx           — ONNX export")

    return test_acc


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='MediScan Medicine Classifier Training')
    parser.add_argument('--data', type=str, default=DATASET_ROOT,
                        help='Path to dataset root (contains Training/, Testing/, Validation/)')
    parser.add_argument('--output', type=str, default='./ml-service',
                        help='Output directory for model and artifacts')
    parser.add_argument('--epochs', type=int, default=30, help='Max training epochs')
    parser.add_argument('--batch-size', type=int, default=32, help='Batch size')
    parser.add_argument('--lr', type=float, default=1e-3, help='Initial learning rate')
    parser.add_argument('--patience', type=int, default=7, help='Early stopping patience')
    parser.add_argument('--unfreeze-epoch', type=int, default=2,
                        help='Epoch at which to unfreeze backbone')
    parser.add_argument('--export-onnx', action='store_true', help='Export ONNX model')
    args = parser.parse_args()

    main(args)
