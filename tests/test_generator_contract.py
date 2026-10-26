import json
from pathlib import Path
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]


class GeneratorObjectContractTests(unittest.TestCase):
    def test_pinned_reference_contracts(self):
        for name in ("generators", "object-protocols"):
            with self.subTest(corpus=name):
                path = ROOT / "tests/fixtures/interpreter" / (name + ".json")
                corpus = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(corpus["reference_version"], "3.14.7")
                self.assertEqual(len(corpus["cases"]), len({c["id"] for c in corpus["cases"]}))
                process = subprocess.run(
                    [sys.executable, "runtime/check_classes.py", "--reference-only", "--corpus", str(path)],
                    cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=30,
                )
                self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
