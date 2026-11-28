"""Generate clearly marked, non-personal registration-like OCR fixtures."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

DEFAULT_FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"


def generate(output: Path, font_path: str = DEFAULT_FONT, variants: bool = False):
    output.mkdir(parents=True, exist_ok=True)
    def font(size):
        return ImageFont.truetype(font_path, size, index=1 if font_path.endswith('.ttc') else 0)
    truth = []
    for name, initial_year, missing, blur in (
        ("normal", 2024, False, False),
        ("different-years", 2025, False, False),
        ("blurred-vin", 2024, False, True),
        ("missing-model-year", 2025, True, False),
    ):
        image = Image.new("RGB", (1800, 1200), "white")
        draw = ImageDraw.Draw(image)
        ink = (25, 30, 35)
        draw.text((700, 55), "자동차등록증", font=font(55), fill=ink)
        draw.text((80, 1120), "합성 테스트 전용 · 실제 차량 및 개인정보 없음", font=font(28), fill=(95, 95, 95))
        for y in (180, 350, 530, 710, 890, 1070):
            draw.line((80, y, 1720, y), fill=(65, 65, 65), width=2)
        for x in (80, 425, 1170, 1720):
            draw.line((x, 180, x, 1070), fill=(65, 65, 65), width=2)
        draw.text((105, 230), "자동차등록번호", font=font(34), fill=ink)
        draw.text((470, 225), "123가4567", font=font(47), fill=ink)
        draw.text((105, 400), "차명", font=font(35), fill=ink)
        draw.text((470, 382), "BMW X5 xDrive40i", font=font(40), fill=ink)
        draw.text((470, 440), "Long Wheelbase", font=font(40), fill=ink)
        draw.text((1200, 390), "원동기형식", font=font(31), fill=ink)
        draw.text((1210, 450), "B58", font=font(37), fill=ink)
        draw.text((105, 580), "차대번호", font=font(35), fill=ink)
        draw.text((470, 575), "KMHGN41DBLU123456", font=font(45), fill=ink)
        draw.text((105, 760), "형식 및 모델연도", font=font(31), fill=ink)
        draw.text((470, 752), "G80 / ----" if missing else "G80 / 2024년형", font=font(43), fill=ink)
        draw.text((105, 950), "최초등록일", font=font(35), fill=ink)
        draw.text((470, 940), f"{initial_year}년 03월 12일", font=font(43), fill=ink)
        if blur:
            region = (450, 550, 1130, 650)
            image.paste(image.crop(region).filter(ImageFilter.GaussianBlur(6)), region)
        path = output / (name + ".jpg")
        image.save(path, quality=95)
        truth.append({"image": path.name, "synthetic": True, "fields": {"plate": "123가4567", "vin": "KMHGN41DBLU123456", "model": "BMW X5 xDrive40i Long Wheelbase", "modelYear": None if missing else "2024"}, "expectedReview": (["vin"] if blur else []) + (["modelYear"] if missing else [])})
    if variants:
        with Image.open(output / "normal.jpg") as source:
            source = source.convert("RGB")
            transformed = [
                ("phone-portrait", source.transpose(Image.Transpose.ROTATE_270), 95),
                ("tilted", source.rotate(6, resample=Image.Resampling.BICUBIC, expand=True, fillcolor="white"), 90),
                ("messenger-compressed", source.resize((1000, 667), Image.Resampling.LANCZOS), 32),
            ]
            for name, image, quality in transformed:
                image.save(output / (name + ".jpg"), quality=quality)
                truth.append({**truth[0], "image": name + ".jpg", "variant": name})
    (output / "ground-truth.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in truth), encoding="utf-8")
    return truth


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--font", default=DEFAULT_FONT)
    parser.add_argument("--variants", action="store_true", help="Also generate portrait, tilted and messenger-compressed stress cases")
    args = parser.parse_args()
    rows = generate(args.output, args.font, args.variants)
    print(json.dumps({"synthetic": True, "images": len(rows), "output": str(args.output)}, ensure_ascii=False))
