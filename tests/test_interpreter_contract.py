import ast
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest


CORPUS = Path(__file__).parent / "fixtures" / "interpreter" / "language.json"


class InterpreterContractTests(unittest.TestCase):
    def test_adopted_reference_cases_and_boundaries(self):
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
        cases = corpus["cases"] + corpus["boundaries"]
        self.assertEqual(len({case["id"] for case in cases}), len(cases))
        for case in corpus["cases"]:
            with self.subTest(case=case["id"]):
                process = subprocess.run(
                    [sys.executable, "-I", "-S", "-c", case["source"]],
                    capture_output=True, text=True, encoding="utf-8", timeout=5,
                    env={**os.environ, "PYTHONIOENCODING": "utf-8"},
                )
                if "exception" in case:
                    self.assertNotEqual(process.returncode, 0)
                    self.assertIn(case["exception"] + ": " + case["message"], process.stderr)
                else:
                    self.assertEqual(process.returncode, 0, process.stderr)
                    self.assertEqual(process.stdout.replace("\r\n", "\n"), case["stdout"])
        for case in corpus["boundaries"]:
            with self.subTest(boundary=case["id"]):
                self.assertIn(case["classification"], {"rejected", "deferred"})
                ast.parse(case["source"])
