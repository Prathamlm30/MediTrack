"""Common grayscale, denoise, image-only deskew, CLAHE and binarization pipeline."""
from pathlib import Path
import cv2
import numpy as np


def preprocess(image_path, output_path=None):
    image = cv2.imread(str(image_path))
    if image is None:
        raise FileNotFoundError(image_path)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.fastNlMeansDenoising(gray, h=8, templateWindowSize=7, searchWindowSize=21)
    # Optimize horizontal projection sharpness; uses pixels, never ground truth.
    small = cv2.resize(gray, None, fx=.4, fy=.4)
    ink = cv2.adaptiveThreshold(small, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 15)
    h, w = small.shape
    best_angle, best_score = 0, -1
    for angle in np.arange(-9, 9.01, .5):
        matrix = cv2.getRotationMatrix2D((w/2, h/2), float(angle), 1)
        rotated = cv2.warpAffine(ink, matrix, (w, h), borderValue=0)
        score = float(np.sum(np.diff(rotated.sum(axis=1).astype(float)) ** 2))
        if score > best_score:
            best_angle, best_score = float(angle), score
    h, w = gray.shape
    gray = cv2.warpAffine(gray, cv2.getRotationMatrix2D((w/2, h/2), best_angle, 1), (w, h), borderValue=255)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 13)
    if output_path:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(str(output_path), binary):
            raise OSError(f'Cannot save {output_path}')
    return binary, {'deskew_degrees': best_angle}
