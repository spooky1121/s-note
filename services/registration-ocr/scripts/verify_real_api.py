#!/usr/bin/env python3
"""Real-model ASGI multipart API checks using synthetic documents only.

For an OS-level offline test on Linux, run this command under `unshare -Urn`.
Unlike test_api.py, this loads the actual detection/recognition model files.
"""
from __future__ import annotations

import argparse
from io import BytesIO
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from PIL import Image
from snote_ocr.app import Settings, create_app


def source_hashes():
    root = Path(__file__).resolve().parents[1]
    files = list((root / "snote_ocr").glob("*.py")) + list((root / "scripts").glob("*.py"))
    files += [root / "requirements.txt", root / "models.lock.json"]
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(files) if path.is_file()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--variants", action="store_true")
    parser.add_argument("--require-isolated-network", action="store_true")
    args = parser.parse_args()
    interfaces = [name for _index, name in socket.if_nameindex()]
    if args.require_isolated_network and interfaces != ["lo"]:
        raise SystemExit("This verification must run in an isolated network namespace.")
    os.environ.pop("GOOGLE_VISION_API_KEY", None)
    before = source_hashes()
    truth = [json.loads(line) for line in (args.fixtures / "ground-truth.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    if not truth or any(item.get("synthetic") is not True for item in truth):
        raise SystemExit("Only explicitly synthetic fixtures are supported by this verification command.")
    cases = []
    for item in truth:
        cases.append((item["image"], (args.fixtures / item["image"]).read_bytes(), item))
    if args.variants:
        normal = next(item for item in truth if item["image"] == "normal.jpg")
        with Image.open(args.fixtures / "normal.jpg") as source:
            for angle in (90, 180, 270):
                value = BytesIO()
                source.rotate(-angle, expand=True, fillcolor="white").save(value, "JPEG", quality=94)
                cases.append((f"rotated-{angle}.jpg", value.getvalue(), normal))
            for name, rotated, quality in (("tilted-4-degrees.jpg", source.rotate(4, expand=True, fillcolor="white"), 90),
                                           ("messenger-compressed.jpg", source.copy(), 25)):
                value = BytesIO()
                rotated.save(value, "JPEG", quality=quality)
                rotated.close()
                cases.append((name, value.getvalue(), normal))
    token = secrets.token_urlsafe(48)
    started = time.perf_counter()
    results = []
    with TestClient(create_app(Settings(args.models, token))) as client:
        loaded_ms = round((time.perf_counter() - started) * 1000)
        if client.get("/healthz").status_code != 200:
            raise SystemExit("Local model startup did not become ready.")
        metadata = dict(getattr(client.app.state.engine, "metadata", {}))
        for name, content, expected in cases:
            response = client.post(
                "/ocr/vehicle-registration", files={"file": (name, content, "image/jpeg")},
                headers={"Authorization": "Bearer " + token},
            )
            if response.status_code != 200:
                raise AssertionError(f"Synthetic case failed: {name}, HTTP {response.status_code}")
            result = response.json()
            fields = result["fields"]
            for field in ("plate", "vin", "model", "modelYear"):
                actual = fields[field]
                if field in expected.get("expectedReview", []):
                    assert actual["needsReview"] and not actual["autoFill"], (name, field, "review-required")
                else:
                    assert actual["value"] == expected["fields"][field], (name, field, "exact-match")
                    assert actual["autoFill"] and not actual["needsReview"], (name, field, "autofill")
            assert "rawText" not in result and "tokens" not in result
            results.append({"case": name, "status": response.status_code, "response": result})
            print(json.dumps({"case": name, "ok": True, "elapsedMs": result["elapsedMs"],
                              "manualReview": [key for key, field in fields.items() if field["needsReview"]]}, ensure_ascii=False), flush=True)
    assert source_hashes() == before, "OCR sources changed during verification"
    report = {"ok": True, "syntheticOnly": True, "realModels": True,
              "transport": "ASGI multipart HTTP API", "networkInterfaces": interfaces,
              "osNetworkIsolationRequired": args.require_isolated_network,
              "googleKeyPresent": "GOOGLE_VISION_API_KEY" in os.environ,
              "coldModelApiStartupMs": loaded_ms, "cases": results,
              "engineMetadata": metadata, "sourceHashes": before}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
