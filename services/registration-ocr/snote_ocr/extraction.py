"""Conservative, label-and-position based extraction; never returns full OCR text.

Coordinates are pixels in the upright image supplied to the recognizer. A reread
callback receives (left, top, right, bottom) in those same original coordinates.
This module does not retain images, perform network IO, or log recognized text.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import math
import re
import statistics
import unicodedata
from typing import Callable, Iterable

FIELDS = ("plate", "vin", "model", "modelYear")
LABELS = {
    "plate": ("자동차등록번호", "차량등록번호"),
    "vin": ("차대번호", "차대번호VIN", "VIN"),
    "model": ("차명", "자동차명"),
    "modelYear": ("형식및모델연도", "형식및모델년도", "모델연도", "모델년도", "모델연식", "연식"),
    "stop": ("자동차의종류", "자동차종류", "차종", "원동기형식", "원동기의형식", "최초등록일", "최초등록일자", "등록일자", "제작연월일", "제작년월일", "소유자", "성명", "주소", "사용본거지", "배기량", "연료의종류", "연료", "색상", "용도", "검사유효기간", "승차정원", "적재량", "총중량", "제원관리번호", "비고", "형식"),
}
ALIASES = sorted(((alias, name) for name, aliases in LABELS.items() for alias in aliases), key=lambda pair: -len(pair[0]))
REGIONS = "서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주"
PLATE_RE = re.compile(rf"(?<!\d)((?:(?:{REGIONS}))?\d{{2,3}}[가-힣]\d{{4}})(?!\d)")
PLATE_LOOSE = re.compile(rf"(?<!\d)((?:(?:{REGIONS}))?\d{{2,3}}[가-힣A-Za-z?？]\d{{4}})(?!\d)")
VIN_RE = re.compile(r"(?<![A-Z0-9])([A-HJ-NPR-Z0-9]{17})(?![A-Z0-9])")
VIN_LOOSE = re.compile(r"(?<![A-Z0-9])([A-Z0-9?]{15,19})(?![A-Z0-9])")
PLATE_HANGUL = set("가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자배하허호")
MAX_TOKENS = 4096


def compact(text: str) -> str:
    return re.sub(r"[\s\W_]+", "", unicodedata.normalize("NFKC", text), flags=re.UNICODE)


@dataclass(frozen=True)
class Token:
    text: str
    confidence: float
    box: tuple[float, float, float, float]
    polygon: tuple[tuple[float, float], ...]

    @property
    def middle(self):
        return (self.box[1] + self.box[3]) / 2

    @property
    def height(self):
        return max(1.0, self.box[3] - self.box[1])


@dataclass(frozen=True)
class Label:
    name: str
    token: Token


def _polygon(box):
    left, top, right, bottom = box
    return [[round(left, 2), round(top, 2)], [round(right, 2), round(top, 2)], [round(right, 2), round(bottom, 2)], [round(left, 2), round(bottom, 2)]]


def _token(raw, width, height):
    if not isinstance(raw, dict) or not isinstance(raw.get("text"), str):
        return None
    text = unicodedata.normalize("NFKC", raw["text"]).strip()[:256]
    confidence = raw.get("confidence")
    polygon = raw.get("polygon")
    if not text or not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not math.isfinite(confidence) or not 0 <= confidence <= 1:
        return None
    if not isinstance(polygon, (list, tuple)) or len(polygon) != 4:
        return None
    points = []
    for point in polygon:
        if not isinstance(point, (list, tuple)) or len(point) != 2 or any(not isinstance(n, (int, float)) or isinstance(n, bool) or not math.isfinite(n) for n in point):
            return None
        x, y = point
        if not -1 <= x <= width + 1 or not -1 <= y <= height + 1:
            return None
        points.append((max(0, min(width, x)), max(0, min(height, y))))
    box = (min(x for x, _ in points), min(y for _, y in points), max(x for x, _ in points), max(y for _, y in points))
    if box[2] - box[0] < 1 or box[3] - box[1] < 1:
        return None
    return Token(text, float(confidence), box, tuple(points))


def _tokens(raws, width, height):
    result = []
    if not isinstance(raws, (list, tuple)):
        return result
    for raw in raws[:MAX_TOKENS]:
        token = _token(raw, width, height)
        if token is not None:
            result.append(token)
    return result


class Geometry:
    """Align text coordinates for layout only; retain original image/crop pixels."""
    def __init__(self, tokens, width, height):
        angles = []
        for token in tokens:
            a, b = token.polygon[:2]
            angle = math.atan2(b[1] - a[1], b[0] - a[0])
            if token.confidence >= .7 and math.hypot(b[0] - a[0], b[1] - a[1]) >= 30 and abs(angle) <= math.radians(15):
                angles.append(angle)
        baseline = statistics.median(angles) if len(angles) >= 4 else 0
        consensus = sum(abs(angle - baseline) < math.radians(2.5) for angle in angles)
        if abs(baseline) < math.radians(.75) or consensus < max(4, len(angles) * .7):
            baseline = 0
        self.c, self.s = math.cos(-baseline), math.sin(-baseline)
        corners = [(0, 0), (width, 0), (width, height), (0, height)]
        rotated = [(self.c * x - self.s * y, self.s * x + self.c * y) for x, y in corners]
        self.min_x = min(x for x, _ in rotated)
        self.min_y = min(y for _, y in rotated)
        self.width = math.ceil(max(x for x, _ in rotated) - self.min_x)
        self.height = math.ceil(max(y for _, y in rotated) - self.min_y)
        self.original_width, self.original_height = width, height

    def align(self, tokens):
        result = []
        for token in tokens:
            points = tuple((self.c * x - self.s * y - self.min_x, self.s * x + self.c * y - self.min_y) for x, y in token.polygon)
            box = (min(x for x, _ in points), min(y for _, y in points), max(x for x, _ in points), max(y for _, y in points))
            result.append(Token(token.text, token.confidence, box, points))
        return result

    def original(self, polygon):
        result = []
        for x, y in polygon:
            x, y = x + self.min_x, y + self.min_y
            result.append([round(max(0, min(self.original_width, self.c * x + self.s * y)), 2), round(max(0, min(self.original_height, -self.s * x + self.c * y)), 2)])
        return result

    def crop(self, box):
        points = self.original(_polygon(box))
        return (int(min(x for x, _ in points)), int(min(y for _, y in points)), min(self.original_width, int(math.ceil(max(x for x, _ in points)))), min(self.original_height, int(math.ceil(max(y for _, y in points)))))


def _match_label(value):
    value = compact(value)
    # Printed item numbers may precede a label. Arbitrary prose may not.
    return next(((alias, name) for alias, name in ALIASES if re.fullmatch(r"\d*" + re.escape(alias), value, re.I)), None)


def _split_inline(tokens):
    result = []
    for token in tokens:
        normalized = compact(token.text)
        found = None
        for alias, name in ALIASES:
            match = re.match(r"^\d*" + re.escape(alias), normalized, re.I)
            if match and len(normalized) > match.end():
                found = (alias, match.end())
                break
        if found is None:
            result.append(token)
            continue
        alias, end = found
        # Whole-line detections are split geometrically at the label boundary.
        # Keep the remaining recognized text; never invent/correct characters.
        left, top, right, bottom = token.box
        edge = left + (right - left) * end / max(1, len(normalized))
        a, b = (left, top, edge, bottom), (edge, top, right, bottom)
        consumed, cut = 0, 0
        for index, char in enumerate(token.text):
            consumed += len(compact(char))
            if consumed >= end:
                cut = index + 1
                break
        suffix = token.text[cut:].strip(" :：|ㆍ·")
        result.extend((Token(alias, token.confidence, a, tuple(map(tuple, _polygon(a)))), Token(suffix, token.confidence, b, tuple(map(tuple, _polygon(b))))))
    return result


def _lines(tokens):
    lines = []
    for token in sorted(tokens, key=lambda t: (t.middle, t.box[0])):
        candidates = [line for line in lines[-4:] if abs(line[0].middle - token.middle) <= min(line[0].height, token.height) * .6]
        if candidates:
            min(candidates, key=lambda line: abs(line[0].middle - token.middle)).append(token)
        else:
            lines.append([token])
    return [sorted(line, key=lambda t: t.box[0]) for line in lines]


def _labels(tokens):
    labels, marked = [], set()
    for line in _lines(tokens):
        for start in range(len(line)):
            for length in range(min(6, len(line) - start), 0, -1):
                words = line[start:start + length]
                # Joining a label across separate grid cells is not allowed.
                if any(b.box[0] - a.box[2] > max(a.height, b.height) * 2.5 for a, b in zip(words, words[1:])):
                    continue
                match = _match_label("".join(t.text for t in words))
                if not match or any(id(t) in marked for t in words):
                    continue
                box = (min(t.box[0] for t in words), min(t.box[1] for t in words), max(t.box[2] for t in words), max(t.box[3] for t in words))
                labels.append(Label(match[1], Token(match[0], min(t.confidence for t in words), box, tuple(map(tuple, _polygon(box))))))
                marked.update(id(t) for t in words)
                break
    return labels, [token for token in tokens if id(token) not in marked]


def _inside(token, region):
    left, top, right, bottom = region
    center_x = (token.box[0] + token.box[2]) / 2
    return left <= center_x <= right and top <= token.middle <= bottom


def _regions(label, labels, width, height, name):
    token = label.token
    left, top, right, bottom = token.box
    h = token.height
    neighbors = [other.token for other in labels if other is not label]
    next_right = [t.box[0] for t in neighbors if t.box[0] > right + 1 and abs(t.middle - token.middle) <= max(h, t.height) * .9]
    edge = min(next_right, default=width - 1)
    lower = [t.box[1] for t in neighbors if t.box[1] > bottom + h * .2 and t.box[0] < edge and t.box[2] > right]
    floor = min(lower, default=height - 1)
    right_region = (right + 1, max(0, top - h * .35), edge - 1, min(floor - 1, bottom + h * (2.5 if name == "model" else .9)))
    lower_same_column = [t.box[1] for t in neighbors if t.box[1] > bottom + h * .2 and t.box[0] < edge and t.box[2] > left - h * .3]
    below = (max(0, left - h * .3), bottom + 1, edge - 1, min(min(lower_same_column, default=height - 1) - 1, bottom + h * (4 if name == "model" else 2.5)))
    return [tuple(max(0, min(width if i % 2 == 0 else height, v)) for i, v in enumerate(region)) for region in (right_region, below) if region[2] > region[0] and region[3] > region[1]]


def _joined(tokens):
    return " ".join(" ".join(token.text for token in line) for line in _lines(tokens)).strip()


def _value(name, tokens):
    text = _joined(tokens)
    if not text:
        return None, False
    if name == "model":
        value = re.sub(r"\s+", " ", text).strip(" :：|ㆍ")
        if len(value) < 2 or len(value) > 100 or _match_label(value) or re.fullmatch(r"[\d\W]+", value) or VIN_RE.search(compact(value).upper()) or PLATE_RE.search(compact(value)):
            return None, False
        return value, True
    if name == "plate":
        # Separators are formatting only. Missing/Latin Hangul remains uncertain.
        source = re.sub(r"[\s\-·.]", "", unicodedata.normalize("NFKC", text))
        matches = list(PLATE_RE.finditer(source))
        if len(matches) == 1:
            value = matches[0].group(1)
            middle = re.search(r"\d([가-힣])\d{4}$", value)
            return value, bool(middle and middle.group(1) in PLATE_HANGUL)
        loose = list(PLATE_LOOSE.finditer(source))
        return (loose[0].group(1), False) if len(loose) == 1 else (None, False)
    if name == "vin":
        source = re.sub(r"[\s\-·.]", "", text.upper())
        matches = list(VIN_RE.finditer(source))
        if len(matches) == 1:
            return matches[0].group(1), True
        loose = list(VIN_LOOSE.finditer(source))
        return (loose[0].group(1), False) if len(loose) == 1 else (None, False)
    # A model-year label is mandatory; dates cannot become model-year evidence.
    cleaned = re.sub(r"\b(?:19|20)\d{2}\s*[-./]\s*\d{1,2}(?:\s*[-./]\s*\d{1,2})?\b", "", text)
    cleaned = re.sub(r"(?<!\d)(?:19|20)\d{2}\s*년?\s*\d{1,2}\s*월(?:\s*\d{1,2}\s*일)?", "", cleaned)
    years = set(re.findall(r"(?<!\d)((?:19|20)\d{2})(?!\d)", cleaned))
    valid = [year for year in years if 1900 <= int(year) <= date.today().year + 2]
    return (valid[0], True) if len(valid) == 1 else (None, False)


def _candidate(name, label, labels, tokens, width, height):
    candidates = []
    for region_index, region in enumerate(_regions(label, labels, width, height, name)):
        selected = [t for t in tokens if _inside(t, region) and t.confidence >= .2 and not _match_label(t.text)]
        if not selected:
            continue
        # An unreadable neighboring label must not extend a cell to page width.
        # Disconnected x-clusters are separate evidence, not a concatenated name.
        clusters = []
        gap = max(label.token.height * 2.5, width * .015)
        for token in sorted(selected, key=lambda t: t.box[0]):
            if clusters and token.box[0] - max(t.box[2] for t in clusters[-1]) <= gap:
                clusters[-1].append(token)
            else:
                clusters.append([token])
        start = label.token.box[2] if region_index == 0 else label.token.box[0]
        if min(t.box[0] for t in clusters[0]) - start > max(label.token.height * 8, width * .12) + 2:
            continue
        uncertain = len(clusters) > 1
        selected = clusters[0]
        value, valid = _value(name, selected)
        if not value:
            continue
        # Prefer an explicit valid value in the label's row over a below-label
        # value. A second row is retained for long vehicle names only.
        confidence = min([label.token.confidence] + [t.confidence for t in selected])
        box = (min(t.box[0] for t in selected), min(t.box[1] for t in selected), max(t.box[2] for t in selected), max(t.box[3] for t in selected))
        candidates.append((int(valid), -region_index, confidence, value, box, uncertain))
    return max(candidates, key=lambda c: c[:3]) if candidates else None


def _missing(name, reason, polygon=None):
    return {"value": None, "needsReview": True, "reasons": [reason], "polygon": polygon, "confidence": 0.0, "autoFill": False}


def extract_registration(raw_tokens: Iterable[dict], width: int, height: int, reread: Callable | None = None):
    if isinstance(width, bool) or isinstance(height, bool) or not isinstance(width, int) or not isinstance(height, int) or not 1 <= width <= 20000 or not 1 <= height <= 20000 or width * height > 40_000_000:
        raise ValueError("invalid_image_dimensions")
    original_width, original_height = width, height
    raw = _tokens(raw_tokens, width, height)
    geometry = Geometry(raw, width, height)
    width, height = geometry.width, geometry.height
    tokens = _split_inline(geometry.align(raw))
    labels, values = _labels(tokens)
    fields = {}
    for name in FIELDS:
        anchors = [label for label in labels if label.name == name]
        if not anchors:
            fields[name] = _missing(name, "model_year_missing" if name == "modelYear" else "label_not_found")
            continue
        if len(anchors) > 1:
            fields[name] = _missing(name, "multiple_labels", _polygon(anchors[0].token.box))
            continue
        anchor = anchors[0]
        found = _candidate(name, anchor, labels, values, width, height)
        regions = _regions(anchor, labels, width, height, name)
        region = found[4] if found else regions[0] if regions else anchor.token.box
        if found is None and regions:
            region = (region[0], region[1], min(region[2], anchor.token.box[2] + max(anchor.token.height * 8, width * .12)), region[3])
        pad = max(4, anchor.token.height * .3)
        crop = (max(0, int(region[0] - pad)), max(0, int(region[1] - pad)), min(width, int(math.ceil(region[2] + pad))), min(height, int(math.ceil(region[3] + pad))))
        value = found[3] if found else None
        valid = bool(found and found[0])
        certainty = found[2] if found else 0.0
        reasons = []
        if found and found[5]:
            reasons.append("layout_uncertain")
        threshold = .92 if name in ("plate", "vin") else .88
        if not value:
            reasons.append("model_year_missing" if name == "modelYear" else "value_not_found")
        elif not valid:
            reasons.append("ambiguous_character" if name == "plate" else "invalid_format")
        if certainty < threshold:
            reasons.append("low_confidence")
        requires_reread = not valid or certainty < threshold or (name == "vin" and value is not None and any(c in value for c in "8B5S"))
        if requires_reread:
            if reread is None:
                reasons.append("reread_unavailable")
            else:
                try:
                    second_tokens = [t for t in geometry.align(_tokens(reread(geometry.crop(crop)), original_width, original_height)) if _inside(t, crop) and not _match_label(t.text)]
                    second, second_valid = _value(name, second_tokens)
                    second_confidence = min((t.confidence for t in second_tokens), default=0.0)
                    if value and second and value != second:
                        value = None
                        reasons.append("reread_disagrees")
                    elif value and second == value and second_valid and second_confidence >= threshold and anchor.token.confidence >= .8:
                        # A low first reading is still displayed for review. Two
                        # agreeing high-confidence reads may be auto-filled.
                        valid = valid and second_valid
                        certainty = min(certainty, second_confidence)
                    elif not value and second:
                        value = second
                        valid = second_valid
                        certainty = second_confidence
                        reasons.append("initial_read_missing")
                    else:
                        reasons.append("reread_unconfirmed")
                except Exception:
                    # Cropping failure affects only this field, not good peers.
                    reasons.append("reread_failed")
        reasons = list(dict.fromkeys(reasons))
        auto_fill = bool(value and valid and not reasons and certainty >= threshold)
        fields[name] = {"value": value, "needsReview": not auto_fill, "reasons": reasons, "polygon": _polygon(region), "confidence": round(max(0.0, min(1.0, certainty)), 4), "autoFill": auto_fill}
    for field in fields.values():
        if field["polygon"]:
            field["polygon"] = geometry.original(field["polygon"])
    return {"fields": fields, "image": {"width": original_width, "height": original_height}}
