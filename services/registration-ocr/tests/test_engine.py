"""Opt-in real-image model tests, distinct from parser/API transport fixtures.

SNOTE_TEST_MODELS=/prepared/models activates actual CPU inference. Without
weights these tests explicitly skip rather than reporting a simulated success.
"""
import io
import os
from pathlib import Path
import socket

from PIL import Image
import pytest

from snote_ocr.engine import Engine
from snote_ocr.extraction import extract_registration


def test_orientation_tie_keeps_original_and_closes_unselected_images():
    engine = object.__new__(Engine)
    scores = iter([0, 8, 8, 0])
    inspected = []
    def read(image):
        inspected.append(image)
        return [{"score": next(scores)}]
    engine.read = read
    engine._orientation_score = lambda tokens, height: tokens[0]["score"]
    original = Image.new("RGB", (20, 30), "white")
    selected, rotation, tokens = engine.prepare(original)
    assert selected is original and rotation == 0 and tokens == [{"score": 0}]
    assert original.getpixel((0, 0)) == (255, 255, 255)
    for rejected in inspected[1:]:
        with pytest.raises(ValueError):
            rejected.getpixel((0, 0))
    original.close()


def test_missing_weights_fail_closed_without_download(tmp_path, monkeypatch):
    def denied(*args, **kwargs):
        pytest.fail("Missing weights must never start a download")
    monkeypatch.setattr(socket, "socket", denied)
    with pytest.raises(RuntimeError, match="OCR_MODELS_NOT_PREPARED"):
        Engine(tmp_path)


@pytest.fixture(scope="module")
def real_inputs(tmp_path_factory):
    model_dir = os.getenv("SNOTE_TEST_MODELS")
    if not model_dir:
        pytest.skip("Actual-model test requires SNOTE_TEST_MODELS; no fake inference")
    from tools.generate_synthetic import generate
    font = os.getenv("SNOTE_SYNTHETIC_FONT", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")
    if not Path(font).is_file():
        pytest.skip("Synthetic Korean rendering requires a local Korean font")
    directory = tmp_path_factory.mktemp("synthetic-images")
    generate(directory, font)
    return Path(model_dir), directory


@pytest.mark.parametrize("angle", [0, 90, 180, 270])
def test_real_cold_load_and_cardinal_inference_without_network(real_inputs, monkeypatch, angle):
    model_dir, directory = real_inputs
    attempts = []
    def denied(*args, **kwargs):
        attempts.append(True)
        raise RuntimeError("NETWORK_DISABLED")
    monkeypatch.setattr(socket, "socket", denied)
    monkeypatch.setattr(socket, "create_connection", denied)
    engine = Engine(model_dir)
    image = Image.open(directory / "normal.jpg").convert("RGB").rotate(-angle, expand=True)
    upright, rotation, tokens = engine.prepare(image)
    result = extract_registration(tokens, upright.width, upright.height, reread=lambda rect: engine.reread(upright, rect))
    expected = {"plate": "123가4567", "vin": "KMHGN41DBLU123456", "model": "BMW X5 xDrive40i Long Wheelbase", "modelYear": "2024"}
    assert rotation == (-angle) % 360
    for key, value in expected.items():
        assert result["fields"][key]["value"] == value
        assert result["fields"][key]["autoFill"] is True
    assert not attempts


def test_real_skewed_compressed_image_never_auto_fills_a_wrong_value(real_inputs, monkeypatch):
    model_dir, directory = real_inputs
    def denied(*args, **kwargs):
        raise RuntimeError("NETWORK_DISABLED")
    monkeypatch.setattr(socket, "socket", denied)
    image = Image.open(directory / "normal.jpg").convert("RGB").rotate(2.5, expand=True, fillcolor="white", resample=Image.Resampling.BICUBIC)
    encoded = io.BytesIO()
    image.save(encoded, format="JPEG", quality=30)
    encoded.seek(0)
    image = Image.open(encoded).convert("RGB")
    engine = Engine(model_dir)
    upright, _, tokens = engine.prepare(image)
    result = extract_registration(tokens, upright.width, upright.height, reread=lambda rect: engine.reread(upright, rect))
    expected = {"plate": "123가4567", "vin": "KMHGN41DBLU123456", "model": "BMW X5 xDrive40i Long Wheelbase", "modelYear": "2024"}
    for key, field in result["fields"].items():
        if field["autoFill"]:
            assert field["value"] == expected[key]
        else:
            assert field["needsReview"] is True
