"""API boundary tests with a stub engine; not real-model accuracy evidence."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
import sys
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from PIL import Image
from snote_ocr.app import Settings, create_app, MAX_BODY_BYTES

TOKEN = "synthetic-server-token-for-tests-00000000"
HEADERS = {"Authorization": "Bearer " + TOKEN}


def image_bytes(kind="PNG", *, size=(640, 480), exif=None):
    value = BytesIO()
    image = Image.new("RGB", size, "white")
    image.save(value, format=kind, **({"exif": exif} if exif is not None else {}))
    return value.getvalue()


class Engine:
    def __init__(self, _path):
        self.calls = []

    def read(self, image):
        self.calls.append(image.size)
        return [{"text": "private-text-must-not-be-returned", "confidence": .98,
                 "polygon": [[1, 1], [20, 1], [20, 12], [1, 12]]}]

    def reread(self, _image, _rect):
        return []


def extraction(tokens, width, height, reread=None):
    values = {"plate": "123가4567", "vin": "KMHAB41BPYU123456", "model": "합성 테스트 모델", "modelYear": "2024"}
    return {"fields": {name: {"value": value, "needsReview": False, "reasons": [],
                             "polygon": [[1, 1], [20, 1], [20, 12], [1, 12]],
                             "confidence": .99, "autoFill": True}
                        for name, value in values.items()},
            "rawText": "private-text-must-not-be-returned", "tokens": tokens,
            "image": {"width": width, "height": height}}


class ApiTests(unittest.TestCase):
    def make_app(self, factory=Engine, extractor=extraction, timeout=1, token=TOKEN):
        return create_app(Settings(Path("unused-test-models"), token, timeout), factory, extractor)

    def post(self, client, *, data=None, mime="image/png", headers=None, path="/ocr/vehicle-registration"):
        return client.post(path, files={"file": ("synthetic.png", data or image_bytes(), mime)},
                           headers=HEADERS if headers is None else headers)

    def test_real_api_schema_returns_only_four_fields_and_never_raw_text(self):
        with TestClient(self.make_app()) as client:
            response = self.post(client)
            self.assertEqual(response.status_code, 200)
            result = response.json()
            self.assertEqual(set(result), {"ok", "engine", "fields", "image", "elapsedMs"})
            self.assertEqual(set(result["fields"]), {"plate", "vin", "model", "modelYear"})
            self.assertEqual(result["fields"]["modelYear"]["value"], "2024")
            self.assertEqual(result["image"], {"width": 640, "height": 480, "rotation": 0})
            self.assertNotIn("private-text", response.text)
            self.assertIn("no-store", response.headers["cache-control"])
            self.assertEqual(response.headers["x-content-type-options"], "nosniff")

    def test_bearer_required_and_duplicate_headers_are_rejected_before_decode(self):
        with TestClient(self.make_app()) as client:
            for headers in ({}, {"Authorization": "Bearer wrong"},
                            [("Authorization", "Bearer " + TOKEN), ("Authorization", "Bearer " + TOKEN)]):
                response = self.post(client, data=b"not-an-image", headers=headers)
                self.assertEqual(response.status_code, 401)
            self.assertEqual(client.app.state.engine.calls, [])

    def test_unconfigured_secret_or_missing_model_fails_closed(self):
        loaded = []
        def should_not_load(path):
            loaded.append(path)
            return Engine(path)
        with TestClient(self.make_app(should_not_load, token="")) as client:
            self.assertEqual(client.get("/healthz").status_code, 503)
            self.assertEqual(self.post(client).status_code, 503)
        self.assertEqual(loaded, [])
        def missing(_path):
            raise RuntimeError("private-model-path-or-input")
        with TestClient(self.make_app(missing)) as client:
            response = self.post(client)
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("private-model", response.text)

    def test_jpeg_png_webp_and_exif_transpose_use_full_original_dimensions(self):
        with TestClient(self.make_app()) as client:
            for kind, mime in (("JPEG", "image/jpeg"), ("PNG", "image/png"), ("WEBP", "image/webp")):
                response = self.post(client, data=image_bytes(kind, size=(1200, 800)), mime=mime)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["image"]["width"], 1200)
            exif = Image.Exif()
            exif[274] = 6
            response = self.post(client, data=image_bytes("JPEG", size=(800, 1200), exif=exif), mime="image/jpeg")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["image"], {"width": 1200, "height": 800, "rotation": 0})

    def test_mime_mismatch_corrupt_gif_and_animation_are_rejected(self):
        with TestClient(self.make_app()) as client:
            for data, mime in ((b"not-image", "image/png"), (image_bytes("JPEG"), "image/png"),
                               (image_bytes("GIF"), "image/gif")):
                self.assertEqual(self.post(client, data=data, mime=mime).status_code, 415)
            output = BytesIO()
            frames = [Image.new("RGB", (200, 100), color) for color in ("red", "blue")]
            frames[0].save(output, format="WEBP", save_all=True, append_images=frames[1:], duration=20)
            self.assertEqual(self.post(client, data=output.getvalue(), mime="image/webp").status_code, 415)
            self.assertEqual(client.app.state.engine.calls, [])

    def test_unknown_form_fields_multiple_files_and_untrusted_query_are_rejected(self):
        with TestClient(self.make_app()) as client:
            for kwargs in ({"data": {"companyId": "not-trusted"}},
                           {"files": [("file", ("a.png", image_bytes(), "image/png")),
                                      ("file", ("b.png", image_bytes(), "image/png"))]}):
                base = {"files": {"file": ("a.png", image_bytes(), "image/png")}}
                base.update(kwargs)
                response = client.post("/ocr/vehicle-registration", headers=HEADERS, **base)
                self.assertEqual(response.status_code, 400)
            self.assertEqual(self.post(client, path="/ocr/vehicle-registration?url=foreign").status_code, 400)

    def test_body_limit_checks_header_and_stream_before_model(self):
        with TestClient(self.make_app()) as client:
            response = client.post("/ocr/vehicle-registration", content=b"x", headers={
                **HEADERS, "Content-Type": "multipart/form-data; boundary=test", "Content-Length": str(MAX_BODY_BYTES + 1)})
            self.assertEqual(response.status_code, 413)
            response = client.post("/ocr/vehicle-registration", content=iter([b"x" * 65536] * 98),
                                   headers={**HEADERS, "Content-Type": "multipart/form-data; boundary=test"})
            self.assertEqual(response.status_code, 413)
            self.assertEqual(client.app.state.engine.calls, [])

    def test_model_exception_and_bad_schema_do_not_leak_inputs(self):
        class Broken(Engine):
            def read(self, image):
                raise RuntimeError("private-text-must-not-be-returned")
        with TestClient(self.make_app(Broken)) as client:
            response = self.post(client)
            self.assertEqual(response.status_code, 502)
            self.assertNotIn("private-text", response.text)
        def broken_extract(*args, **kwargs):
            result = extraction(*args, **kwargs)
            result["fields"]["vin"]["confidence"] = float("nan")
            return result
        with TestClient(self.make_app(extractor=broken_extract)) as client:
            self.assertEqual(self.post(client).status_code, 502)

    def test_explicit_rotation_and_global_region_coordinates_are_preserved(self):
        class Rotated(Engine):
            def prepare(self, image):
                return image.transpose(Image.Transpose.ROTATE_270), 90, self.read(image)
        with TestClient(self.make_app(Rotated)) as client:
            result = self.post(client).json()
            self.assertEqual(result["image"], {"width": 480, "height": 640, "rotation": 90})
            self.assertEqual(result["fields"]["plate"]["polygon"], [[1., 1.], [20., 1.], [20., 12.], [1., 12.]])

    def test_timeout_keeps_native_thread_slot_busy_until_it_really_finishes(self):
        released = threading.Event()
        class Slow(Engine):
            def read(self, image):
                released.wait(2)
                return super().read(image)
        try:
            with TestClient(self.make_app(Slow, timeout=.03)) as client:
                response = self.post(client)
                self.assertEqual(response.status_code, 504)
                self.assertEqual(self.post(client).status_code, 429)
                released.set()
                time.sleep(.04)
                self.assertEqual(self.post(client).status_code, 200)
        finally:
            released.set()

    def test_overlapping_requests_do_not_queue_extra_images(self):
        began, released = threading.Event(), threading.Event()
        class Blocking(Engine):
            def read(self, image):
                began.set()
                released.wait(2)
                return super().read(image)
        try:
            with TestClient(self.make_app(Blocking)) as client, ThreadPoolExecutor(1) as pool:
                first = pool.submit(self.post, client)
                self.assertTrue(began.wait(1))
                self.assertEqual(self.post(client).status_code, 429)
                released.set()
                self.assertEqual(first.result(timeout=2).status_code, 200)
        finally:
            released.set()

    def test_no_cors_no_public_documentation_and_no_remote_provider(self):
        with TestClient(self.make_app()) as client:
            response = client.options("/ocr/vehicle-registration", headers={"Origin": "https://foreign.invalid", "Access-Control-Request-Method": "POST"})
            self.assertNotIn("access-control-allow-origin", response.headers)
            self.assertEqual(client.get("/docs").status_code, 404)
            self.assertEqual(client.get("/openapi.json").status_code, 404)


if __name__ == "__main__":
    unittest.main(verbosity=2)
