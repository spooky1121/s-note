#!/usr/bin/env python3
"""Install pinned public model files once; the inference server never downloads.

Only normal HTTPS release downloads from the committed allowlist are supported.
Artifacts are bounded and checked before an atomic rename. Existing valid files
need no network. No model binary or uploaded document is committed to Git.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import urllib.request


def prepare(model_dir: Path):
    lock_path = Path(__file__).resolve().parents[1] / "models.lock.json"
    manifest = json.loads(lock_path.read_text(encoding="utf-8"))
    model_dir.mkdir(parents=True, exist_ok=True)
    for item in manifest["files"]:
        if Path(item["name"]).name != item["name"] or item["bytes"] > 64 * 1024 * 1024:
            raise RuntimeError("INVALID_MODEL_MANIFEST")
        target = model_dir / item["name"]
        if target.is_file() and target.stat().st_size == item["bytes"] and hashlib.sha256(target.read_bytes()).hexdigest() == item["sha256"]:
            print(item["name"] + ": verified local cache")
            continue
        if not item["url"].startswith("https://github.com/SethRobinson/Patchy/releases/download/ai-models-4/"):
            raise RuntimeError("INVALID_MODEL_SOURCE")
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=model_dir, prefix=".model-", delete=False) as file:
                temporary = Path(file.name)
                digest, size = hashlib.sha256(), 0
                with urllib.request.urlopen(item["url"], timeout=60) as response:
                    while chunk := response.read(1024 * 1024):
                        size += len(chunk)
                        if size > item["bytes"]:
                            raise RuntimeError("MODEL_SIZE_MISMATCH")
                        digest.update(chunk)
                        file.write(chunk)
                if size != item["bytes"] or digest.hexdigest() != item["sha256"]:
                    raise RuntimeError("MODEL_CHECKSUM_MISMATCH")
            temporary.replace(target)
            print(item["name"] + ": installed and verified")
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.model_dir)
