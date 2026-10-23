import json
from pathlib import Path
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "tests/fixtures/interpreter/sequences.json"


class SequenceContractTests(unittest.TestCase):
    def test_reference_contract(self):
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
        self.assertEqual(corpus["reference_version"], "3.14.7")
        cases = corpus["cases"]
        self.assertEqual(len({case["id"] for case in cases}), len(cases))
        self.assertLessEqual(set(corpus["implemented_stages"]), {"Q1", "Q2", "Q3"})
        process = subprocess.run(
            [sys.executable, "runtime/check_classes.py", "--reference-only", "--corpus", str(CORPUS)],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=30,
        )
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
