"""Metric tests only; these stubs must not be reported as image recognition."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import json

spec = importlib.util.spec_from_file_location("evaluate", Path(__file__).parents[1] / "tools" / "evaluate.py")
evaluate_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluate_module)


class EvaluationTests(unittest.TestCase):
    def row(self):
        return {"synthetic": True, "fields": {"plate": "123가4567", "vin": "KMHGN41DBLU123456", "model": "BMW X5", "modelYear": "2024"}}

    def prediction(self, row):
        return {"fields": {key: {"value": value, "autoFill": True, "needsReview": False} for key, value in row["fields"].items()}}

    def test_one_character_plate_and_vin_errors_are_exact_failures(self):
        row = self.row()
        def predictor(row):
            value = self.prediction(row)
            value["fields"]["plate"]["value"] = "123나4567"
            value["fields"]["vin"]["value"] = "KMHGN41D8LU123456"
            return value
        report = evaluate_module.evaluate([row], predictor)
        for field in ("plate", "vin"):
            self.assertEqual(report["fields"][field]["exactRate"], 0)
            self.assertEqual(report["fields"][field]["wrongAutoFillCount"], 1)
        self.assertEqual(report["fields"]["modelYear"]["exactRate"], 1)
        self.assertNotIn("123나", str(report))
        self.assertNotIn("KMHGN", str(report))

    def test_review_and_missing_year_are_reported_without_false_accuracy_denominator(self):
        row = self.row()
        row["fields"]["modelYear"] = None
        def predictor(row):
            value = self.prediction(row)
            value["fields"]["modelYear"] = {"value": None, "autoFill": False, "needsReview": True}
            return value
        stats = evaluate_module.evaluate([row], predictor)["fields"]["modelYear"]
        self.assertEqual(stats["expectedMissingCount"], 1)
        self.assertEqual(stats["manualReviewCount"], 1)
        self.assertEqual(stats["missingLeftBlankCount"], 1)
        self.assertIsNone(stats["exactRate"])
        self.assertEqual(stats["wrongAutoFillCount"], 0)

    def test_request_failure_is_counted_and_raw_exception_never_reported(self):
        def predictor(row):
            raise ValueError("PRIVATE SENTINEL original OCR text")
        report = evaluate_module.evaluate([self.row()], predictor)
        self.assertEqual(report["failedImages"], 1)
        self.assertEqual(report["fields"]["vin"]["manualReviewCount"], 1)
        self.assertNotIn("PRIVATE", str(report))

    def test_manifest_paths_are_scoped_and_fields_are_exact(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "answers.jsonl"
            path.write_text(json.dumps({**self.row(), "image": "test.jpg"}) + "\n")
            self.assertEqual(len(evaluate_module.read_manifest(path)), 1)
            path.write_text(json.dumps({**self.row(), "image": "../private.jpg"}) + "\n")
            with self.assertRaises(ValueError):
                evaluate_module.read_manifest(path)


if __name__ == "__main__":
    unittest.main()
