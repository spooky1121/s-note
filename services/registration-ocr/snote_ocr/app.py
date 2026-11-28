"""Private, memory-only registration OCR service. No external OCR fallback."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from email import policy
from email.parser import BytesParser
from io import BytesIO
import math
import os
from pathlib import Path
import re
import time
import warnings
from typing import Any, Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps

from .auth import authorized, valid_secret

MAX_IMAGE_BYTES = 6 * 1024 * 1024
MAX_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024
MAX_PIXELS = 40_000_000
MIME_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
FIELD_NAMES = ("plate", "vin", "model", "modelYear")
REASONS = frozenset({
    "label_not_found", "multiple_labels", "model_year_missing", "value_not_found",
    "ambiguous_character", "invalid_format", "low_confidence", "reread_unavailable",
    "reread_disagrees", "initial_read_missing", "reread_unconfirmed", "reread_failed",
    "layout_uncertain",
})
ERRORS = {
    "INVALID_REQUEST": (400, "등록증 이미지 한 장을 선택해 주세요."),
    "UNAUTHORIZED": (401, "운영자 OCR 연결 권한을 확인해 주세요."),
    "UNSUPPORTED_MEDIA_TYPE": (415, "JPG·PNG·WebP 이미지인지 확인해 주세요."),
    "PAYLOAD_TOO_LARGE": (413, "6MB 이하의 이미지를 선택해 주세요."),
    "OCR_BUSY": (429, "다른 문서를 처리하고 있습니다. 잠시 후 다시 시도해 주세요."),
    "OCR_NOT_READY": (503, "OCR 모델과 서버 연결 설정을 확인해 주세요."),
    "OCR_TIMEOUT": (504, "문서 처리 시간이 초과되었습니다. 다시 시도하거나 직접 입력해 주세요."),
    "OCR_FAILED": (502, "문서를 판독하지 못했습니다. 다시 시도하거나 직접 입력해 주세요."),
}


@dataclass(frozen=True)
class Settings:
    model_dir: Path
    service_token: str
    timeout_seconds: float = 90

    @classmethod
    def from_env(cls) -> "Settings":
        try:
            timeout = float(os.environ.get("SNOTE_OCR_TIMEOUT_SECONDS", "90"))
        except ValueError:
            timeout = 90
        if not math.isfinite(timeout):
            timeout = 90
        return cls(
            Path(os.environ.get("SNOTE_OCR_MODEL_DIR", "models")),
            os.environ.get("SNOTE_OCR_SERVICE_TOKEN", ""),
            max(5, min(120, timeout)),
        )


class InputError(Exception):
    def __init__(self, code: str):
        self.code = code


def failure(code: str) -> JSONResponse:
    status, message = ERRORS.get(code, ERRORS["OCR_FAILED"])
    return JSONResponse({"ok": False, "code": code, "error": message}, status_code=status)


def multipart_image(body: bytes, content_type: str) -> tuple[bytes, str]:
    """Bounded in-memory multipart parsing; never uses UploadFile's disk spool."""
    if len(body) > MAX_BODY_BYTES:
        raise InputError("PAYLOAD_TOO_LARGE")
    if len(content_type) > 512 or "\r" in content_type or "\n" in content_type:
        raise InputError("INVALID_REQUEST")
    try:
        header = content_type.encode("ascii")
        message = BytesParser(policy=policy.default).parsebytes(
            b"Content-Type: " + header + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
        )
        boundary = message.get_boundary()
        if (
            message.get_content_type() != "multipart/form-data"
            or not boundary
            or len(boundary) > 200
            or not message.is_multipart()
            or message.defects
        ):
            raise InputError("INVALID_REQUEST")
        parts = list(message.iter_parts())
        if len(parts) != 1:
            raise InputError("INVALID_REQUEST")
        part = parts[0]
        if (
            part.is_multipart()
            or part.defects
            or part.get_content_disposition() != "form-data"
            or part.get_param("name", header="content-disposition") != "file"
            or part.get("Content-Transfer-Encoding") not in (None, "binary", "8bit")
        ):
            raise InputError("INVALID_REQUEST")
        mime = part.get_content_type().lower()
        if mime not in MIME_FORMATS:
            raise InputError("UNSUPPORTED_MEDIA_TYPE")
        value = part.get_payload(decode=True)
        if not isinstance(value, bytes) or not value:
            raise InputError("INVALID_REQUEST")
        if len(value) > MAX_IMAGE_BYTES:
            raise InputError("PAYLOAD_TOO_LARGE")
        return value, mime
    except InputError:
        raise
    except Exception:
        raise InputError("INVALID_REQUEST") from None


def decode_image(value: bytes, mime: str) -> Image.Image:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(value)) as probe:
                width, height = probe.size
                if (
                    probe.format != MIME_FORMATS[mime]
                    or width < 32
                    or height < 32
                    or width * height > MAX_PIXELS
                    or getattr(probe, "n_frames", 1) != 1
                ):
                    raise InputError("UNSUPPORTED_MEDIA_TYPE")
                probe.verify()
            with Image.open(BytesIO(value)) as source:
                normalized = ImageOps.exif_transpose(source)
                result = normalized.convert("RGB")
                result.info.clear()
                return result
    except InputError:
        raise
    except Exception:
        raise InputError("UNSUPPORTED_MEDIA_TYPE") from None


def _public_fields(extracted: dict[str, Any], width: int, height: int) -> dict[str, Any]:
    """Allow only the four requested fields; never serialize tokens or raw text."""
    output: dict[str, Any] = {}
    source = extracted.get("fields")
    if not isinstance(source, dict):
        raise InputError("OCR_FAILED")
    for name in FIELD_NAMES:
        item = source.get(name)
        if not isinstance(item, dict):
            raise InputError("OCR_FAILED")
        value = item.get("value")
        limit = {"plate": 32, "vin": 32, "model": 180, "modelYear": 4}[name]
        if value is not None and (
            not isinstance(value, str)
            or not value.strip()
            or len(value) > limit
            or any(ord(char) < 32 or ord(char) == 127 for char in value)
        ):
            raise InputError("OCR_FAILED")
        needs_review = item.get("needsReview")
        auto_fill = item.get("autoFill")
        confidence = item.get("confidence")
        if (
            type(needs_review) is not bool
            or type(auto_fill) is not bool
            or not isinstance(confidence, (float, int))
            or isinstance(confidence, bool)
            or not math.isfinite(confidence)
            or not 0 <= confidence <= 1
            or (auto_fill and (needs_review or value is None))
        ):
            raise InputError("OCR_FAILED")
        reasons = item.get("reasons")
        if (
            not isinstance(reasons, list)
            or len(reasons) > 12
            or any(not isinstance(reason, str) or reason not in REASONS for reason in reasons)
        ):
            raise InputError("OCR_FAILED")
        polygon = item.get("polygon")
        if polygon is not None:
            if not isinstance(polygon, (list, tuple)) or len(polygon) != 4:
                raise InputError("OCR_FAILED")
            points = []
            for point in polygon:
                if (
                    not isinstance(point, (list, tuple))
                    or len(point) != 2
                    or any(not isinstance(n, (int, float)) or isinstance(n, bool) or not math.isfinite(n) for n in point)
                    or not 0 <= point[0] <= width
                    or not 0 <= point[1] <= height
                ):
                    raise InputError("OCR_FAILED")
                points.append([round(float(point[0]), 2), round(float(point[1]), 2)])
            polygon = points
        output[name] = {
            "value": value,
            "needsReview": needs_review,
            "reasons": list(reasons),
            "polygon": polygon,
            "confidence": round(float(confidence), 4),
            "autoFill": auto_fill,
        }
    return output


def _run(engine: Any, image_bytes: bytes, mime: str, extract: Callable[..., Any]) -> dict[str, Any]:
    started = time.perf_counter()
    image = decode_image(image_bytes, mime)
    working = image
    try:
        if callable(getattr(engine, "prepare", None)):
            working, rotation, tokens = engine.prepare(image)
        else:
            rotation, tokens = 0, engine.read(image)
        if rotation not in (0, 90, 180, 270) or not isinstance(working, Image.Image):
            raise InputError("OCR_FAILED")
        width, height = working.size
        def reread(rect: tuple[float, float, float, float]) -> Any:
            if callable(getattr(engine, "reread", None)):
                return engine.reread(working, rect)
            return []
        extracted = extract(tokens, width, height, reread=reread)
        return {
            "ok": True,
            "engine": "paddleocr-self-hosted",
            "fields": _public_fields(extracted, width, height),
            "image": {"width": width, "height": height, "rotation": rotation},
            "elapsedMs": round((time.perf_counter() - started) * 1000),
        }
    finally:
        if working is not image:
            working.close()
        image.close()


def create_app(
    settings: Settings | None = None,
    engine_factory: Callable[[Path], Any] | None = None,
    extractor: Callable[..., Any] | None = None,
) -> FastAPI:
    config = settings or Settings.from_env()
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.engine = None
        application.state.inference_gate = asyncio.Lock()
        if valid_secret(config.service_token):
            try:
                if engine_factory is None:
                    from .engine import Engine
                    factory = Engine
                else:
                    factory = engine_factory
                application.state.engine = await asyncio.to_thread(factory, config.model_dir)
            except Exception:
                # Library messages can contain input paths; never log them here.
                application.state.engine = None
        yield
        close = getattr(application.state.engine, "close", None)
        if callable(close):
            close()

    application = FastAPI(
        title="S-NOTE private registration OCR",
        docs_url=None, redoc_url=None, openapi_url=None,
        lifespan=lifespan,
    )

    @application.middleware("http")
    async def private_headers(request: Request, call_next: Callable[..., Any]):
        response = await call_next(request)
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @application.get("/healthz")
    async def health():
        ready = getattr(application.state, "engine", None) is not None
        return JSONResponse({"ok": ready, "ready": ready, "engine": "paddleocr-self-hosted"}, status_code=200 if ready else 503)

    @application.post("/ocr/vehicle-registration")
    async def recognize(request: Request):
        if not valid_secret(config.service_token):
            return failure("OCR_NOT_READY")
        if not authorized(request.scope.get("headers", []), config.service_token):
            return failure("UNAUTHORIZED")
        engine = getattr(application.state, "engine", None)
        if engine is None:
            return failure("OCR_NOT_READY")
        if request.url.query:
            return failure("INVALID_REQUEST")
        if request.headers.get("content-encoding", "identity").lower() != "identity":
            return failure("UNSUPPORTED_MEDIA_TYPE")
        length = request.headers.get("content-length")
        if length is not None:
            if not re.fullmatch(r"[0-9]{1,12}", length):
                return failure("INVALID_REQUEST")
            if int(length) > MAX_BODY_BYTES:
                return failure("PAYLOAD_TOO_LARGE")
        gate = application.state.inference_gate
        if gate.locked():
            return failure("OCR_BUSY")
        await gate.acquire()
        release_on_exit = True
        try:
            async def read_body() -> bytes:
                chunks, size = [], 0
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_BODY_BYTES:
                        raise InputError("PAYLOAD_TOO_LARGE")
                    chunks.append(chunk)
                return b"".join(chunks)
            try:
                body = await asyncio.wait_for(read_body(), timeout=15)
            except asyncio.TimeoutError:
                return failure("OCR_TIMEOUT")
            image_bytes, mime = multipart_image(body, request.headers.get("content-type", ""))
            if extractor is None:
                from .extraction import extract_registration
                extract = extract_registration
            else:
                extract = extractor
            task = asyncio.create_task(asyncio.to_thread(_run, engine, image_bytes, mime, extract))
            # Timeout/disconnect cannot kill a native CPU inference thread. Keep
            # its occupied slot until it actually finishes to avoid oversubscription.
            def finished(done: asyncio.Task[Any]):
                try:
                    done.exception()
                except BaseException:
                    pass
                if gate.locked():
                    gate.release()
            task.add_done_callback(finished)
            release_on_exit = False
            try:
                result = await asyncio.wait_for(asyncio.shield(task), timeout=config.timeout_seconds)
                return JSONResponse(result)
            except asyncio.TimeoutError:
                return failure("OCR_TIMEOUT")
            except InputError as error:
                return failure(error.code)
            except Exception:
                return failure("OCR_FAILED")
        except InputError as error:
            return failure(error.code)
        except Exception:
            return failure("OCR_FAILED")
        finally:
            if release_on_exit:
                gate.release()

    return application


app = create_app()
