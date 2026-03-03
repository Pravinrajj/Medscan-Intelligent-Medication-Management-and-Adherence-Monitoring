"""
MediScan — Model Evaluation Script
===================================
Evaluates trained EfficientNet-B0 on test set.
Generates: accuracy, top-k, per-class precision/recall/F1, confusion matrix.

Usage:
    python evaluate.py --data ./dataset --model ./ml-service/models/model.pth
"""

import os
import json
import argparse
import numpy as np
import pandas as pd
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from torchvision import transforms, models

from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import (
    classification_report, confusion_matrix, accuracy_score,
    precision_recall_fscore_support, top_k_accuracy_score
)
from PIL import Image
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns

# Reuse dataset class from train.py
from train import MedicineDataset, get_eval_transforms, IMAGE_SIZE


def build_model(num_classes, device):
    """Rebuild model architecture for loading weights."""
    model = models.efficientnet_b0(weights=None)
    in_features = model.classifier[1].in_features
    model.classifier = nn.Sequential(
        nn.Dropout(p=0.3),
        nn.Linear(in_features, 256),
        nn.ReLU(inplace=True),
        nn.Dropout(p=0.2),
        nn.Linear(256, num_classes),
    )
    return model.to(device)


def plot_confusion_matrix(cm, class_names, output_path):
    """Save confusion matrix heatmap."""
    fig, ax = plt.subplots(figsize=(24, 20))

    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
                xticklabels=class_names, yticklabels=class_names,
                ax=ax, linewidths=0.5, linecolor='gray')

    ax.set_xlabel('Predicted', fontsize=14)
    ax.set_ylabel('Actual', fontsize=14)
    ax.set_title('Medicine Classification — Confusion Matrix', fontsize=16, fontweight='bold')
    plt.xticks(rotation=90, fontsize=6)
    plt.yticks(rotation=0, fontsize=6)
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close()


def plot_per_class_accuracy(class_names, accuracies, output_path):
    """Bar chart of per-class accuracy."""
    fig, ax = plt.subplots(figsize=(20, 8))

    colors = ['#27ae60' if a >= 90 else '#f39c12' if a >= 75 else '#e74c3c' for a in accuracies]
    bars = ax.bar(range(len(class_names)), accuracies, color=colors, edgecolor='white', linewidth=0.5)

    ax.set_xticks(range(len(class_names)))
    ax.set_xticklabels(class_names, rotation=90, fontsize=6)
    ax.set_ylabel('Accuracy (%)')
    ax.set_title('Per-Class Accuracy — Medicine Brands', fontweight='bold')
    ax.axhline(y=90, color='green', linestyle='--', alpha=0.3, label='90% threshold')
    ax.axhline(y=75, color='orange', linestyle='--', alpha=0.3, label='75% threshold')
    ax.legend()
    ax.grid(axis='y', alpha=0.3)
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close()


def main(args):
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

    # Paths
    data_root = Path(args.data)
    model_path = Path(args.model)
    models_dir = model_path.parent
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  MediScan — Model Evaluation")
    print(f"  Device: {device}")
    print(f"  Model:  {model_path}")
    print(f"{'='*60}\n")

    # Load class mapping
    mapping_path = models_dir / 'class_mapping.json'
    with open(mapping_path) as f:
        class_mapping = json.load(f)

    num_classes = class_mapping['num_classes']
    index_to_brand = {int(k): v for k, v in class_mapping['index_to_brand'].items()}
    brand_to_generic = class_mapping['brand_to_generic']
    class_names = [index_to_brand[i] for i in range(num_classes)]

    # Load model
    print("🏗️  Loading model...")
    model = build_model(num_classes, device)
    checkpoint = torch.load(model_path, map_location=device, weights_only=True)
    model.load_state_dict(checkpoint['model_state_dict'])
    model.eval()
    print(f"  Loaded from epoch {checkpoint['epoch']} (val_acc={checkpoint['val_acc']:.1f}%)\n")

    # Load test dataset
    label_encoder = LabelEncoder()
    label_encoder.classes_ = np.array(class_names)

    test_dataset = MedicineDataset(
        csv_path=data_root / 'Testing' / 'testing_labels.csv',
        images_dir=data_root / 'Testing' / 'testing_words',
        transform=get_eval_transforms(),
        label_encoder=label_encoder,
    )

    test_loader = DataLoader(test_dataset, batch_size=args.batch_size,
                             shuffle=False, num_workers=2, pin_memory=True)

    print(f"  Test set: {len(test_dataset)} images, {num_classes} classes\n")

    # ── Run Inference ──────────────────────────────────────────
    all_preds = []
    all_labels = []
    all_probs = []

    print("🔍 Running inference on test set...")
    with torch.no_grad():
        for images, labels in test_loader:
            images = images.to(device)
            outputs = model(images)
            probs = torch.softmax(outputs, dim=1)

            _, predicted = outputs.max(1)
            all_preds.extend(predicted.cpu().numpy())
            all_labels.extend(labels.numpy())
            all_probs.extend(probs.cpu().numpy())

    all_preds = np.array(all_preds)
    all_labels = np.array(all_labels)
    all_probs = np.array(all_probs)

    # ── Metrics ────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  EVALUATION RESULTS")
    print(f"{'='*60}\n")

    # Overall accuracy
    overall_acc = accuracy_score(all_labels, all_preds) * 100
    print(f"  📊 Overall Accuracy:  {overall_acc:.2f}%")

    # Top-3 accuracy
    top3_acc = top_k_accuracy_score(all_labels, all_probs, k=3) * 100
    print(f"  📊 Top-3 Accuracy:    {top3_acc:.2f}%")

    # Top-5 accuracy
    top5_acc = top_k_accuracy_score(all_labels, all_probs, k=5) * 100
    print(f"  📊 Top-5 Accuracy:    {top5_acc:.2f}%")

    # Precision, Recall, F1 (macro/weighted)
    prec_macro, rec_macro, f1_macro, _ = precision_recall_fscore_support(
        all_labels, all_preds, average='macro'
    )
    prec_weighted, rec_weighted, f1_weighted, _ = precision_recall_fscore_support(
        all_labels, all_preds, average='weighted'
    )

    print(f"\n  Macro Averages:")
    print(f"    Precision: {prec_macro:.4f}")
    print(f"    Recall:    {rec_macro:.4f}")
    print(f"    F1 Score:  {f1_macro:.4f}")

    print(f"\n  Weighted Averages:")
    print(f"    Precision: {prec_weighted:.4f}")
    print(f"    Recall:    {rec_weighted:.4f}")
    print(f"    F1 Score:  {f1_weighted:.4f}")

    # ── Per-Class Report ───────────────────────────────────────
    report = classification_report(all_labels, all_preds,
                                   target_names=class_names, digits=4)
    print(f"\n{'='*60}")
    print(f"  PER-CLASS CLASSIFICATION REPORT")
    print(f"{'='*60}\n")
    print(report)

    # Save report to file
    report_path = output_dir / 'classification_report.txt'
    with open(report_path, 'w') as f:
        f.write(f"MediScan Medicine Classifier — Evaluation Report\n")
        f.write(f"{'='*60}\n\n")
        f.write(f"Overall Accuracy:  {overall_acc:.2f}%\n")
        f.write(f"Top-3 Accuracy:    {top3_acc:.2f}%\n")
        f.write(f"Top-5 Accuracy:    {top5_acc:.2f}%\n\n")
        f.write(f"Macro Precision:   {prec_macro:.4f}\n")
        f.write(f"Macro Recall:      {rec_macro:.4f}\n")
        f.write(f"Macro F1:          {f1_macro:.4f}\n\n")
        f.write(f"Weighted Precision: {prec_weighted:.4f}\n")
        f.write(f"Weighted Recall:    {rec_weighted:.4f}\n")
        f.write(f"Weighted F1:        {f1_weighted:.4f}\n\n")
        f.write(f"{'='*60}\n")
        f.write(f"Per-Class Report\n")
        f.write(f"{'='*60}\n\n")
        f.write(report)
    print(f"  📄 Saved {report_path}")

    # ── Confusion Matrix ───────────────────────────────────────
    cm = confusion_matrix(all_labels, all_preds)
    cm_path = output_dir / 'confusion_matrix.png'
    plot_confusion_matrix(cm, class_names, cm_path)
    print(f"  📊 Saved {cm_path}")

    # ── Per-Class Accuracy Bar Chart ───────────────────────────
    per_class_acc = []
    for i in range(num_classes):
        mask = all_labels == i
        if mask.sum() > 0:
            acc = (all_preds[mask] == i).sum() / mask.sum() * 100
        else:
            acc = 0
        per_class_acc.append(acc)

    acc_chart_path = output_dir / 'per_class_accuracy.png'
    plot_per_class_accuracy(class_names, per_class_acc, acc_chart_path)
    print(f"  📊 Saved {acc_chart_path}")

    # ── Summary JSON ───────────────────────────────────────────
    eval_summary = {
        'overall_accuracy': round(overall_acc, 2),
        'top3_accuracy': round(top3_acc, 2),
        'top5_accuracy': round(top5_acc, 2),
        'macro_precision': round(prec_macro, 4),
        'macro_recall': round(rec_macro, 4),
        'macro_f1': round(f1_macro, 4),
        'weighted_precision': round(prec_weighted, 4),
        'weighted_recall': round(rec_weighted, 4),
        'weighted_f1': round(f1_weighted, 4),
        'num_test_images': len(test_dataset),
        'num_classes': num_classes,
        'per_class_accuracy': {class_names[i]: round(per_class_acc[i], 2) for i in range(num_classes)},
    }
    summary_path = output_dir / 'evaluation_summary.json'
    with open(summary_path, 'w') as f:
        json.dump(eval_summary, f, indent=2)
    print(f"  📄 Saved {summary_path}")

    # Worst performing classes
    worst_indices = np.argsort(per_class_acc)[:5]
    print(f"\n  ⚠️  Lowest accuracy classes:")
    for idx in worst_indices:
        print(f"    {class_names[idx]:20s} — {per_class_acc[idx]:.1f}%")

    best_indices = np.argsort(per_class_acc)[-5:][::-1]
    print(f"\n  ✅ Highest accuracy classes:")
    for idx in best_indices:
        print(f"    {class_names[idx]:20s} — {per_class_acc[idx]:.1f}%")

    print(f"\n{'='*60}")
    print(f"  ✅ Evaluation Complete!")
    print(f"  Overall: {overall_acc:.2f}% | Top-3: {top3_acc:.2f}% | F1: {f1_macro:.4f}")
    print(f"{'='*60}\n")

    return overall_acc


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='MediScan Model Evaluation')
    parser.add_argument('--data', type=str, default='./dataset',
                        help='Path to dataset root')
    parser.add_argument('--model', type=str, default='./ml-service/models/model.pth',
                        help='Path to trained model checkpoint')
    parser.add_argument('--output', type=str, default='./ml-service/outputs',
                        help='Output directory for evaluation results')
    parser.add_argument('--batch-size', type=int, default=32, help='Batch size')
    args = parser.parse_args()

    main(args)
