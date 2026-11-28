"""Parser-only tests: synthetic OCR tokens, NOT a real OCR accuracy benchmark."""
import unittest
from copy import deepcopy
import math
from snote_ocr.extraction import extract_registration


def token(text, x, y, width=200, height=35, confidence=.99):
    return {"text": text, "confidence": confidence, "polygon": [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]}


def document():
    return [token("자동차등록번호", 100, 200, 280), token("123가4567", 470, 200, 300), token("차명", 100, 380, 90), token("BMW X5 xDrive40i", 470, 380, 500), token("Long Wheelbase", 470, 435, 450), token("원동기형식", 1200, 380, 300), token("B58", 1200, 435, 100), token("차대번호", 100, 560, 180), token("KMHGN41DBLU123456", 470, 560, 600), token("형식 및 모델연도", 100, 740, 300), token("G80 / 2024년형", 470, 740, 500), token("최초등록일", 100, 920, 220), token("2025년 03월 12일", 470, 920, 500)]


def run(tokens=None, reread=None):
    values = document() if tokens is None else tokens
    if reread is None:
        reread = lambda rect: [t for t in values if rect[0] <= t["polygon"][0][0] <= rect[2] and rect[1] <= t["polygon"][0][1] <= rect[3]]
    return extract_registration(values, 1800, 1200, reread)["fields"]


class ExtractionTests(unittest.TestCase):
    def test_four_fields_and_long_name_cell_boundaries(self):
        result = run()
        self.assertEqual({key: value["value"] for key, value in result.items()}, {"plate": "123가4567", "vin": "KMHGN41DBLU123456", "model": "BMW X5 xDrive40i Long Wheelbase", "modelYear": "2024"})
        self.assertTrue(all(field["autoFill"] and not field["needsReview"] for field in result.values()))
        self.assertNotIn("B58", result["model"]["value"])

    def test_model_year_comes_from_model_field_not_first_registration(self):
        result = run()
        self.assertEqual(result["modelYear"]["value"], "2024")
        self.assertNotEqual(result["modelYear"]["value"], "2025")

    def test_missing_model_year_never_uses_first_registration_year(self):
        values = document()
        values[10]["text"] = "G80 / ----"
        result = run(values)
        self.assertIsNone(result["modelYear"]["value"])
        self.assertTrue(result["modelYear"]["needsReview"])
        self.assertFalse(result["modelYear"]["autoFill"])
        self.assertEqual(result["plate"]["value"], "123가4567")

    def test_no_model_year_label_does_not_guess_from_any_other_year(self):
        values = [t for t in document() if t["text"] != "형식 및 모델연도"]
        result = run(values)
        self.assertIsNone(result["modelYear"]["value"])
        self.assertIn("model_year_missing", result["modelYear"]["reasons"])

    def test_old_regional_two_digit_and_three_digit_plates(self):
        for plate in ("12가3456", "123가4567", "서울12가3456", "경기12하3456"):
            values = document()
            values[1]["text"] = plate
            result = run(values)
            self.assertEqual(result["plate"]["value"], plate)
            self.assertTrue(result["plate"]["autoFill"])

    def test_middle_hangul_unknown_or_low_confidence_requires_review(self):
        for plate in ("123A4567", "123?4567", "123강4567"):
            values = document()
            values[1]["text"] = plate
            result = run(values)
            self.assertFalse(result["plate"]["autoFill"])
            self.assertTrue(result["plate"]["needsReview"])
            self.assertIn("ambiguous_character", result["plate"]["reasons"])
        values = document()
        values[1]["confidence"] = .7
        self.assertFalse(run(values)["plate"]["autoFill"])

    def test_plate_requires_corresponding_label_and_position(self):
        values = [t for t in document() if t["text"] != "자동차등록번호"]
        result = run(values)
        self.assertIsNone(result["plate"]["value"])
        self.assertIn("label_not_found", result["plate"]["reasons"])

    def test_vin_ambiguity_rereads_exact_original_region_only_once(self):
        calls = []
        def reread(rect):
            calls.append(rect)
            return [token("KMHGN41DBLU123456", 470, 560, 600)]
        result = run(reread=reread)
        self.assertEqual(len(calls), 1)
        left, top, right, bottom = calls[0]
        self.assertGreater(left, 400)
        self.assertGreater(top, 500)
        self.assertLess(bottom, 710)
        self.assertTrue(result["vin"]["autoFill"])

    def test_disagreeing_vin_reads_never_choose_a_character(self):
        def reread(rect):
            return [token("KMHGN41D8LU123456", 470, 560, 600)]
        result = run(reread=reread)
        self.assertIsNone(result["vin"]["value"])
        self.assertIn("reread_disagrees", result["vin"]["reasons"])
        self.assertFalse(result["vin"]["autoFill"])
        self.assertTrue(result["plate"]["autoFill"])
        self.assertTrue(result["modelYear"]["autoFill"])

    def test_invalid_vin_forbidden_letters_and_wrong_length_are_not_autofilled(self):
        for vin in ("KMHGN41DILU123456", "KMHGN41DBLU12345", "KMHGN41DBLU1234567"):
            values = document()
            values[8]["text"] = vin
            result = run(values)
            self.assertFalse(result["vin"]["autoFill"])
            self.assertTrue(result["vin"]["needsReview"])

    def test_reread_error_does_not_repeat_or_damage_healthy_fields(self):
        calls = []
        def broken(rect):
            calls.append(rect)
            raise RuntimeError("must never return this exception text")
        result = run(reread=broken)
        self.assertEqual(len(calls), 1)
        self.assertIn("reread_failed", result["vin"]["reasons"])
        self.assertTrue(result["plate"]["autoFill"])
        self.assertNotIn("exception", str(result))

    def test_split_and_inline_labels(self):
        values = document()
        values[:2] = [token("자동차", 100, 200, 95), token("등록", 205, 200, 75), token("번호", 290, 200, 75), token("123가4567", 470, 200, 300)]
        self.assertEqual(run(values)["plate"]["value"], "123가4567")
        values = document()
        values[:2] = [token("자동차등록번호 123가4567", 100, 200, 670)]
        self.assertEqual(run(values)["plate"]["value"], "123가4567")
        values = [t for t in document() if t["text"] not in ("차명", "BMW X5 xDrive40i", "Long Wheelbase")]
        values.append(token("차명: BMW X5 xDrive40i", 100, 380, 870))
        self.assertEqual(run(values)["model"]["value"], "BMW X5 xDrive40i")

    def test_duplicate_labels_are_ambiguous_and_invalid_geometry_is_ignored(self):
        values = document() + [token("차명", 1200, 1020, 100)]
        result = run(values)
        self.assertFalse(result["model"]["autoFill"])
        self.assertIn("multiple_labels", result["model"]["reasons"])
        malformed = deepcopy(document())
        malformed[1]["polygon"][0][0] = float("nan")
        self.assertFalse(run(malformed)["plate"]["autoFill"])

    def test_below_label_layout_and_no_private_text_output(self):
        values = [token("자동차등록번호", 100, 100, 280), token("12가3456", 100, 155, 260), token("차대번호", 750, 100, 180), token("KMHGN41DBLU123456", 750, 155, 600), token("차명", 100, 380, 80), token("BMW X5", 100, 435, 260), token("모델연도", 750, 380, 180), token("2024년형", 750, 435, 260), token("주소", 100, 750, 80), token("PRIVATE SENTINEL ADDRESS", 400, 750, 600)]
        result = run(values)
        self.assertEqual(result["plate"]["value"], "12가3456")
        self.assertEqual(result["modelYear"]["value"], "2024")
        self.assertNotIn("PRIVATE", str(result))

    def test_image_dimensions_and_input_bounds(self):
        with self.assertRaises(ValueError):
            extract_registration([], 20000, 20000)
        with self.assertRaises(ValueError):
            extract_registration([], True, 500)
        result = extract_registration([{}] * 10000, 1800, 1200)
        self.assertTrue(all(value["needsReview"] for value in result["fields"].values()))

    def test_skewed_metadata_aligns_cells_and_two_lines_without_rotating_original(self):
        for degrees in (-6, -4, 2.5, 6):
            radians = math.radians(degrees)
            c, s = math.cos(radians), math.sin(radians)
            values = document()
            for item in values:
                item["polygon"] = [[round(c * (x - 900) - s * (y - 600) + 1100, 4), round(s * (x - 900) + c * (y - 600) + 800, 4)] for x, y in item["polygon"]]
            def reread(rect):
                return [item for item in values if item["text"] == "KMHGN41DBLU123456"]
            result = extract_registration(values, 2200, 1600, reread)
            self.assertEqual(result["fields"]["model"]["value"], "BMW X5 xDrive40i Long Wheelbase")
            self.assertTrue(all(field["autoFill"] for field in result["fields"].values()), str(result))
            self.assertEqual(result["image"], {"width": 2200, "height": 1600})
            for field in result["fields"].values():
                for x, y in field["polygon"]:
                    self.assertTrue(0 <= x <= 2200 and 0 <= y <= 1600)

    def test_unreadable_neighbor_label_cannot_merge_far_engine_cell(self):
        values = [token("차명", 40, 100, 80, 30), token("BMW530i", 150, 100, 220, 30), token("B48B20", 650, 100, 190, 30)]
        result = extract_registration(values, 1000, 700)
        self.assertEqual(result["fields"]["model"]["value"], "BMW530i")
        self.assertFalse(result["fields"]["model"]["autoFill"])
        self.assertIn("layout_uncertain", result["fields"]["model"]["reasons"])

    def test_korean_first_registration_dates_and_distant_year_are_not_model_year(self):
        for text in ("2025년3월", "2025년 3월 12일", "2025 3월", "2025-03-12", "2025.3.12"):
            values = [token("형식 및 모델연도", 40, 100, 190, 30), token(text, 650, 100, 190, 30)]
            result = extract_registration(values, 1000, 700)
            self.assertIsNone(result["fields"]["modelYear"]["value"], text)
            self.assertFalse(result["fields"]["modelYear"]["autoFill"])


if __name__ == "__main__":
    unittest.main()
