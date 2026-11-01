import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


with patch.object(sys, "path", [str(Path(__file__).resolve().parents[1] / "runtime"), *sys.path]):
    import check_classes


class ReferenceDiagnosticsTests(unittest.TestCase):
    def test_failed_process_identifies_the_case_and_preserves_the_cause(self):
        corpus = {"profile": "classes-source/1", "cases": [{"id": "failing-input", "stage": "test", "source": "pass"}]}
        for failure, detail in [(subprocess.CalledProcessError(-11, ["reference"]), "exit -11"),
                                (subprocess.TimeoutExpired(["reference"], 5), "timeout after 5s")]:
            with self.subTest(detail=detail), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / "corpus.json"
                path.write_text(json.dumps(corpus), encoding="utf-8")
                with patch.object(check_classes, "reference_case", side_effect=failure):
                    with self.assertRaisesRegex(RuntimeError, "failing-input.*" + detail) as raised:
                        check_classes.references(path)
                self.assertIs(raised.exception.__cause__, failure)

    def test_qualified_crashes_are_reported_without_reference_execution(self):
        boundary = {"id": "crashing-input", "owner": "#124", "classification": "retained-divergence", "boundary": "native crash"}
        corpus = {"profile": "classes-source/1", "cases": [], "reference_boundaries": [boundary]}
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "corpus.json"
            path.write_text(json.dumps(corpus), encoding="utf-8")
            with patch.object(check_classes, "reference_case") as reference:
                report = check_classes.references(path)
            reference.assert_not_called()
        self.assertEqual(report["reference_qualifications"], [boundary])
        self.assertEqual(report["summary"], {"pass": 0, "fail": 0})
