"""The Pages operator gateway is the authentication boundary for this service.

This secret is server-to-server only. A browser must never receive it. The
gateway validates the existing S-NOTE operator and live session before and after
forwarding a document; model inference itself does not contact an auth provider.
"""
from __future__ import annotations

import hmac
import re

_SECRET = re.compile(r"[\x21-\x7e]{32,256}\Z")


def valid_secret(value: str | None) -> bool:
    return isinstance(value, str) and _SECRET.fullmatch(value) is not None


def authorized(headers: list[tuple[bytes, bytes]], secret: str) -> bool:
    if not valid_secret(secret):
        return False
    values = [value for key, value in headers if key.lower() == b"authorization"]
    if len(values) != 1:
        return False
    expected = ("Bearer " + secret).encode("ascii")
    return hmac.compare_digest(values[0], expected)
