"""Offline CPU inference for pinned PaddleOCR detection and Korean CTC models.

Weights are prepared separately. This module has no downloader, HTTP client,
telemetry or document logging. All coordinates refer to the supplied image.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import unicodedata

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image
import pyclipper
import yaml


def _ordered(points):
    points = np.asarray(points, dtype=np.float32)
    by_x = points[np.argsort(points[:, 0])]
    left = by_x[:2][np.argsort(by_x[:2, 1])]
    right = by_x[2:][np.argsort(by_x[2:, 1])]
    return np.array([left[0], right[0], right[1], left[1]], dtype=np.float32)


class Engine:
    """One pair of local CPU sessions. The API serializes calls to this object."""

    def __init__(self, model_dir: str | Path):
        self.model_dir = Path(model_dir).resolve()
        lock_path = Path(__file__).resolve().parents[1] / "models.lock.json"
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        for item in lock["files"]:
            path = self.model_dir / item["name"]
            if not path.is_file():
                raise RuntimeError("OCR_MODELS_NOT_PREPARED")
            if path.stat().st_size != item["bytes"] or hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
                raise RuntimeError("OCR_MODEL_INTEGRITY")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        ort.disable_telemetry_events()
        self.detector = ort.InferenceSession(str(self.model_dir / "ppocr_v6_small_det.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
        self.recognizer = ort.InferenceSession(str(self.model_dir / "ppocr_korean_rec.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
        config = yaml.safe_load((self.model_dir / "ppocr_korean_rec.yml").read_text(encoding="utf-8"))
        self.characters = [""] + config["PostProcess"]["character_dict"] + [" "]
        if len(self.characters) != self.recognizer.get_outputs()[0].shape[-1]:
            raise RuntimeError("OCR_DICTIONARY_INTEGRITY")
        self.metadata = {
            "runtime": "onnxruntime",
            "runtimeVersion": importlib.metadata.version("onnxruntime"),
            "detector": "PP-OCRv6_small_det",
            "recognizer": "korean_PP-OCRv5_mobile_rec",
        }

    def _detect(self, bgr):
        height, width = bgr.shape[:2]
        ratio = min(1.0, 1280 / max(height, width))
        target_h = max(32, round(height * ratio / 32) * 32)
        target_w = max(32, round(width * ratio / 32) * 32)
        image = cv2.resize(bgr, (target_w, target_h)).astype(np.float32) / 255.0
        image = (image - np.array([.485, .456, .406], np.float32)) / np.array([.229, .224, .225], np.float32)
        prediction = self.detector.run(None, {self.detector.get_inputs()[0].name: image.transpose(2, 0, 1)[None].copy()})[0][0, 0]
        if not np.isfinite(prediction).all():
            raise RuntimeError("OCR_INFERENCE_FAILED")
        mask = (prediction > .3).astype(np.uint8) * 255
        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        boxes = []
        for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:1000]:
            rectangle = cv2.minAreaRect(contour)
            if min(rectangle[1]) < 3:
                continue
            polygon = _ordered(cv2.boxPoints(rectangle))
            x0, y0 = np.maximum(np.floor(polygon.min(axis=0)), 0).astype(int)
            x1, y1 = np.minimum(np.ceil(polygon.max(axis=0)), [prediction.shape[1] - 1, prediction.shape[0] - 1]).astype(int)
            if x1 <= x0 or y1 <= y0:
                continue
            local_mask = np.zeros((y1 - y0 + 1, x1 - x0 + 1), np.uint8)
            cv2.fillPoly(local_mask, [(polygon - [x0, y0]).astype(np.int32)], 1)
            if cv2.mean(prediction[y0:y1 + 1, x0:x1 + 1], local_mask)[0] < .5:
                continue
            area = abs(cv2.contourArea(polygon))
            perimeter = cv2.arcLength(polygon, True)
            if not perimeter:
                continue
            offset = pyclipper.PyclipperOffset()
            offset.AddPath(np.round(polygon * 100).astype(np.int64).tolist(), pyclipper.JT_ROUND, pyclipper.ET_CLOSEDPOLYGON)
            expanded = offset.Execute(area * 1.5 / perimeter * 100)
            if len(expanded) != 1:
                continue
            box = _ordered(cv2.boxPoints(cv2.minAreaRect(np.asarray(expanded[0], np.float32) / 100)))
            box[:, 0] = np.clip(box[:, 0] / prediction.shape[1] * width, 0, width - 1)
            box[:, 1] = np.clip(box[:, 1] / prediction.shape[0] * height, 0, height - 1)
            boxes.append(box)
        return sorted(boxes, key=lambda box: (round(float(box[:, 1].mean()) / 12), float(box[:, 0].mean())))[:300]

    def _recognize(self, crop):
        height, width = crop.shape[:2]
        if not height or not width:
            return "", 0.0
        resized_w = min(2048, max(1, math.ceil(48 * width / height)))
        padded_w = max(320, resized_w)
        image = cv2.resize(crop, (resized_w, 48)).astype(np.float32) / 127.5 - 1.0
        padded = np.zeros((3, 48, padded_w), np.float32)
        padded[:, :, :resized_w] = image.transpose(2, 0, 1)
        output = self.recognizer.run(None, {self.recognizer.get_inputs()[0].name: padded[None]})[0][0]
        if not np.isfinite(output).all() or len(output) > 10000:
            raise RuntimeError("OCR_INFERENCE_FAILED")
        indices, scores = output.argmax(axis=1), output.max(axis=1)
        text, confidence, previous = [], [], -1
        for index, score in zip(indices, scores):
            index = int(index)
            if index and index != previous and index < len(self.characters):
                text.append(self.characters[index])
                confidence.append(float(score))
            previous = index
        return unicodedata.normalize("NFC", "".join(text)).strip(), float(np.mean(confidence)) if confidence else 0.0

    def read(self, image: Image.Image):
        bgr = np.asarray(image.convert("RGB"))[:, :, ::-1].copy()
        tokens = []
        for box in self._detect(bgr):
            width = max(1, round(max(np.linalg.norm(box[0] - box[1]), np.linalg.norm(box[2] - box[3]))))
            height = max(1, round(max(np.linalg.norm(box[0] - box[3]), np.linalg.norm(box[1] - box[2]))))
            transform = cv2.getPerspectiveTransform(box, np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], np.float32))
            crop = cv2.warpPerspective(bgr, transform, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
            text, confidence = self._recognize(crop)
            if text and confidence >= .3:
                tokens.append({"text": text, "confidence": round(confidence, 6), "polygon": [[round(float(x), 2), round(float(y), 2)] for x, y in box]})
        return tokens

    @staticmethod
    def _orientation_score(tokens, height):
        score = 0.0
        for token in tokens:
            text = "".join(ch for ch in unicodedata.normalize("NFKC", token["text"]) if ch.isalnum())
            confidence = token["confidence"]
            if "자동차등록증" in text:
                y = sum(p[1] for p in token["polygon"]) / 4 / height
                score += (10 if y < .4 else 1) * confidence
            for anchor in ("자동차등록번호", "차대번호", "차명", "모델연도"):
                if anchor in text:
                    score += 2 * confidence
        return score

    def prepare(self, image: Image.Image):
        tokens = self.read(image)
        original_score = self._orientation_score(tokens, image.height)
        if original_score >= 10:
            return image, 0, tokens
        best = (original_score, image, 0, tokens)
        tested_scores = [original_score]
        for angle in (90, 180, 270):
            working = image.rotate(-angle, expand=True)
            try:
                candidates = self.read(working)
            except Exception:
                working.close()
                if best[1] is not image:
                    best[1].close()
                raise
            score = self._orientation_score(candidates, working.height)
            tested_scores.append(score)
            if score > best[0]:
                if best[1] is not image:
                    best[1].close()
                best = (score, working, angle, candidates)
            else:
                working.close()
            if score >= 14:
                break
        # A weak signal or a tie among evaluated directions requires review.
        ranked_scores = sorted(tested_scores, reverse=True)
        if best[0] < 6 or len(ranked_scores) > 1 and ranked_scores[0] - ranked_scores[1] < 2:
            if best[1] is not image:
                best[1].close()
            return image, 0, tokens
        return best[1], best[2], best[3]

    def reread(self, image: Image.Image, rect):
        if len(rect) != 4 or not all(math.isfinite(float(v)) for v in rect):
            return []
        x0, y0, x1, y1 = [int(round(v)) for v in rect]
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(image.width, x1), min(image.height, y1)
        if x1 <= x0 or y1 <= y0:
            return []
        crop = image.crop((x0, y0, x1, y1))
        scale = min(2.0, 3200 / max(crop.size))
        if scale > 1:
            crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.Resampling.LANCZOS)
        else:
            scale = 1.0
        try:
            tokens = self.read(crop)
        finally:
            crop.close()
        for token in tokens:
            token["polygon"] = [[round(x / scale + x0, 2), round(y / scale + y0, 2)] for x, y in token["polygon"]]
        return tokens
