import copy
import importlib.util
import json
from pathlib import Path
import platform
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("version_audit", ROOT / "runtime/check_version_audit.py")
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)
PINNED = audit.oracle_identity() == audit.ORACLE


class VersionAuditTests(unittest.TestCase):
    def test_corpus_distinguishes_deltas_controls_and_unexecuted_work(self):
        corpus, cases = audit.load_corpus()
        self.assertEqual({case["source_file"] for case in cases},
                         {path.name for path in audit.FIXTURES.glob("*.py")})
        self.assertEqual({case["kind"] for case in cases},
                         {"control", "semantic-delta", "diagnostic-delta"})
        self.assertTrue(corpus["unexecuted"])
        for case in cases:
            if case["kind"] != "control":
                self.assertFalse(audit.matches(case["pinned_expected"], case["later"]["expected"]), case["id"])

    def test_refuses_oracle_drift_before_executing_sources(self):
        with patch.object(audit, "oracle_identity", return_value={**audit.ORACLE, "version": "3.14.9"}), \
                patch.object(audit, "observe_reference") as observe:
            with self.assertRaisesRegex(ValueError, "unchanged semantic oracle"):
                audit.reference_report()
            observe.assert_not_called()

    def test_refuses_fixture_escape_and_duplicate_cases(self):
        original = json.loads(audit.MANIFEST.read_text(encoding="utf-8"))
        variants = [copy.deepcopy(original) for _ in range(2)]
        variants[0]["cases"][0]["source_file"] = "../outside.py"
        variants[1]["cases"][1]["id"] = variants[1]["cases"][0]["id"]
        for corpus in variants:
            with self.subTest(source=corpus["cases"][0]["source_file"]), tempfile.TemporaryDirectory() as temporary:
                manifest = Path(temporary) / "cases.json"
                manifest.write_text(json.dumps(corpus), encoding="utf-8")
                with patch.object(audit, "MANIFEST", manifest), self.assertRaises(ValueError):
                    audit.load_corpus()

    def test_refuses_promoted_source_only_expectations(self):
        original = json.loads(audit.MANIFEST.read_text(encoding="utf-8"))
        next(case for case in original["cases"] if case.get("later"))["later"]["verification"] = "verified"
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "cases.json"
            manifest.write_text(json.dumps(original), encoding="utf-8")
            with patch.object(audit, "MANIFEST", manifest), self.assertRaisesRegex(ValueError, "source-only"):
                audit.load_corpus()

    @unittest.skipUnless(PINNED, "Reference execution requires CPython 3.14.7 / Unicode 16.0.0")
    def test_reference_observations_never_receive_engine_credit(self):
        report = audit.reference_report()
        self.assertEqual(report["summary"]["reference_mismatch"], 0)
        self.assertFalse(report["source_execution"])
        self.assertEqual(report["summary"]["engine_executed"], 0)
        self.assertEqual(report["engine_observations"], [])
        for case in report["cases"]:
            if case["kind"] != "control":
                self.assertEqual(case["later"]["status"], "not-independently-verified")

    @unittest.skipUnless(PINNED, "Reference execution requires CPython 3.14.7 / Unicode 16.0.0")
    def test_reference_disagreement_is_reported_as_mismatch(self):
        corpus, cases = audit.load_corpus()
        cases[0]["pinned_expected"] = {"ok": True, "stdout": "incorrect expectation\n"}
        with patch.object(audit, "load_corpus", return_value=(corpus, cases)):
            report = audit.reference_report()
        self.assertEqual(report["summary"]["reference_mismatch"], 1)
        self.assertEqual(report["cases"][0]["oracle"]["status"], "mismatch")


if __name__ == "__main__":
    unittest.main()
