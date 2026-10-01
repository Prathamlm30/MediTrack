"""PaddleOCR engine adapter — extracted from the MediTrack OCR benchmark.
Benchmarked result: 0.10% CER, 99.31% field score across 15 synthetic
degraded prescriptions (2026-09-14). Engine decision is closed; do not
swap this for Tesseract or EasyOCR.

Pinned versions (from benchmark requirements.txt):
    paddleocr       3.7.0
    paddlepaddle    3.3.1
    opencv-contrib-python   4.10.0.84
    opencv-python-headless  4.10.0.84   <- must match contrib exactly

IMPORTANT FOR PHASE 4:
Load PaddleOCR ONCE at FastAPI startup (module-level or lifespan handler),
never per-request. Model init measured ~5.9 s; per-request loading would
roughly double per-scan latency.
"""

import os
import time
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class OCRResult:
    engine_name: str
    raw_text: str
    mean_confidence: float | None
    time_taken_seconds: float
    lines: list


def reading_lines(items):
    """Group bounding boxes into rows using box height, then sort each row
    left-to-right. This is the exact line-assembly logic used in the benchmark
    — do not alter it, as changes would invalidate the measured CER baseline.
    """
    rows = []
    for box, text, confidence in sorted(items, key=lambda x: np.asarray(x[0])[:, 1].mean()):
        box = np.asarray(box, dtype=float)
        center = float(box[:, 1].mean())
        height = float(np.ptp(box[:, 1]))
        row = next(
            (r for r in rows if abs(r['y'] - center) <= 0.45 * max(r['height'], height)),
            None
        )
        item = {'text': str(text), 'confidence': float(confidence), 'box': box.tolist()}
        if row is None:
            rows.append({'y': center, 'height': height, 'items': [item]})
        else:
            row['items'].append(item)

    result = []
    for row in sorted(rows, key=lambda r: r['y']):
        parts = sorted(row['items'], key=lambda v: min(p[0] for p in v['box']))
        result.append({'text': ' '.join(p['text'] for p in parts), 'items': parts})
    return result


# ---------------------------------------------------------------------------
# Module-level singleton — instantiate ONCE at import / app startup.
# In FastAPI use a lifespan handler:
#
#   from contextlib import asynccontextmanager
#   from fastapi import FastAPI
#   from paddle_engine import get_engine
#
#   @asynccontextmanager
#   async def lifespan(app: FastAPI):
#       get_engine()          # warms the model before first request
#       yield
#
#   app = FastAPI(lifespan=lifespan)
# ---------------------------------------------------------------------------
_engine_instance = None


def get_engine():
    """Return the shared PaddleOCR instance, initialising it on first call."""
    global _engine_instance
    if _engine_instance is None:
        os.environ.setdefault('PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK', 'True')
        from paddleocr import PaddleOCR
        _engine_instance = PaddleOCR(
            lang='en',
            device='cpu',
            cpu_threads=4,
            enable_mkldnn=False,                          # disabled in benchmark
            text_detection_model_name='PP-OCRv5_mobile_det',
            text_recognition_model_name='en_PP-OCRv5_mobile_rec',
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
    return _engine_instance


def run(image: np.ndarray) -> OCRResult:
    """Run PaddleOCR on a preprocessed image (BGR or grayscale numpy array).

    Args:
        image: output of preprocess.py — uint8 numpy array, already
               grayscale-converted, denoised, deskewed, CLAHE-enhanced,
               and adaptively binarized.

    Returns:
        OCRResult with raw_text (lines joined by newline), mean_confidence,
        elapsed time, and structured lines list.
    """
    engine = get_engine()

    # PaddleOCR expects BGR; convert if the preprocessing step produced grayscale
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)

    start = time.perf_counter()

    items = []
    for result in engine.predict(image):
        items.extend(
            zip(result['rec_polys'], result['rec_texts'], result['rec_scores'])
        )

    lines = reading_lines(items)
    mean_conf = float(np.mean([float(it[2]) for it in items])) if items else None
    elapsed = time.perf_counter() - start

    raw_text = '\n'.join(line['text'] for line in lines)
    return OCRResult(
        engine_name='paddleocr',
        raw_text=raw_text,
        mean_confidence=mean_conf,
        time_taken_seconds=elapsed,
        lines=lines,
    )
