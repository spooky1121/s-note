"""Exact field evaluation of a user-supplied image/answer JSONL manifest.

Only aggregate counts and case indexes are emitted, never document text, plate,
VIN, address, image bytes or filenames. No Google/external OCR fallback exists.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import statistics
import time
from urllib.parse import urlsplit

FIELDS = ("plate", "vin", "model", "modelYear")


def evaluate(rows, predictor):
    totals = {name: {"labeledCount": 0, "exactCount": 0, "exactRate": None, "expectedMissingCount": 0, "missingLeftBlankCount": 0, "autoFillCount": 0, "wrongAutoFillCount": 0, "manualReviewCount": 0} for name in FIELDS}
    timings, cases = [], []
    for index, row in enumerate(rows):
        start = time.perf_counter()
        success = False
        try:
            result = predictor(row)
            fields = result["fields"]
            if not isinstance(fields, dict) or any(name not in fields or not isinstance(fields[name], dict) or not isinstance(fields[name].get("autoFill"), bool) or not isinstance(fields[name].get("needsReview"), bool) for name in FIELDS):
                raise ValueError("invalid_response")
            success = True
        except Exception:
            fields = {name: {"value": None, "autoFill": False, "needsReview": True} for name in FIELDS}
        elapsed = (time.perf_counter() - start) * 1000
        timings.append(elapsed)
        exact_fields, manual_fields = [], []
        for name in FIELDS:
            expected = row["fields"].get(name)
            field = fields[name]
            actual = field.get("value")
            stats = totals[name]
            # Equality is deliberately literal. A single changed VIN/plate
            # character is wrong, with no fuzzy matching or case correction.
            exact = success and actual == expected
            if expected is not None:
                stats["labeledCount"] += 1
                stats["exactCount"] += int(exact)
            else:
                stats["expectedMissingCount"] += 1
                stats["missingLeftBlankCount"] += int(success and actual is None)
            if field["autoFill"]:
                stats["autoFillCount"] += 1
                stats["wrongAutoFillCount"] += int(not exact)
            if field["needsReview"]:
                stats["manualReviewCount"] += 1
                manual_fields.append(name)
            if exact:
                exact_fields.append(name)
        cases.append({"caseIndex": index + 1, "success": success, "elapsedMs": round(elapsed, 2), "exactFields": exact_fields, "manualReviewFields": manual_fields})
    for stats in totals.values():
        if stats["labeledCount"]:
            stats["exactRate"] = round(stats["exactCount"] / stats["labeledCount"], 6)
    ordered = sorted(timings)
    return {"images": len(rows), "successfulImages": sum(case["success"] for case in cases), "failedImages": sum(not case["success"] for case in cases), "syntheticOnly": bool(rows) and all(row.get("synthetic") is True for row in rows), "fields": totals, "timingMs": {"mean": round(statistics.mean(timings), 2) if timings else None, "median": round(statistics.median(timings), 2) if timings else None, "p95": round(ordered[min(len(ordered) - 1, max(0, int(len(ordered) * .95 + .999999) - 1))], 2) if ordered else None}, "cases": cases}


def read_manifest(path):
    if path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError("manifest_too_large")
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        raw = json.loads(line)
        if not isinstance(raw, dict) or not isinstance(raw.get("image"), str) or not isinstance(raw.get("fields"), dict) or set(raw["fields"]) != set(FIELDS) or any(value is not None and (not isinstance(value, str) or len(value) > 256) for value in raw["fields"].values()):
            raise ValueError("invalid_ground_truth")
        image = (path.parent / raw["image"]).resolve()
        if not image.is_relative_to(path.parent.resolve()):
            raise ValueError("image_outside_manifest_directory")
        rows.append({**raw, "imagePath": image})
        if len(rows) > 10000:
            raise ValueError("too_many_cases")
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--models", type=Path, default=Path(os.environ.get("SNOTE_OCR_MODEL_DIR", "models")))
    parser.add_argument("--endpoint", help="Explicit self-hosted API endpoint, e.g. http://127.0.0.1:8008/ocr/vehicle-registration")
    parser.add_argument("--output", type=Path, help="Optional aggregate JSON report; no predicted field values are written")
    args = parser.parse_args()
    rows = read_manifest(args.manifest.resolve())
    load_ms = None
    if args.endpoint:
        import httpx
        parsed = urlsplit(args.endpoint)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            parser.error("invalid self-hosted endpoint")
        secret = os.environ.get("SNOTE_OCR_SERVICE_TOKEN", "")
        if len(secret) < 32:
            parser.error("SNOTE_OCR_SERVICE_TOKEN is required (at least 32 characters)")
        client = httpx.Client(timeout=120, follow_redirects=False)
        def predict(row):
            path = row["imagePath"]
            if path.stat().st_size > 8 * 1024 * 1024:
                raise ValueError("image_too_large")
            mime = {".png": "image/png", ".webp": "image/webp"}.get(path.suffix.lower(), "image/jpeg")
            with path.open("rb") as file:
                response = client.post(args.endpoint, headers={"Authorization": "Bearer " + secret}, files={"file": ("evaluation-image" + path.suffix.lower(), file, mime)})
            response.raise_for_status()
            if len(response.content) > 65536:
                raise ValueError("response_too_large")
            return response.json()
        mode = "self-hosted-api"
    else:
        from PIL import Image, ImageOps
        from snote_ocr.engine import Engine
        from snote_ocr.extraction import extract_registration
        started = time.perf_counter()
        engine = Engine(args.models)
        load_ms = round((time.perf_counter() - started) * 1000, 2)
        def predict(row):
            with Image.open(row["imagePath"]) as raw:
                if raw.width * raw.height > 40_000_000:
                    raise ValueError("image_too_large")
                image = ImageOps.exif_transpose(raw).convert("RGB")
            working, rotation, tokens = engine.prepare(image)
            return extract_registration(tokens, working.width, working.height, reread=lambda rect: engine.reread(working, rect))
        mode = "real-local-model"
    try:
        report = {"mode": mode, "modelLoadMs": load_ms, **evaluate(rows, predict)}
    finally:
        if args.endpoint:
            client.close()
    encoded = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 1 if report["failedImages"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
