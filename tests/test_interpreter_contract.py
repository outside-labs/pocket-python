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
        corpus["cases"].extend(json.loads(CORPUS.with_name("values.json").read_text(encoding="utf-8"))["cases"])
        cases = corpus["cases"] + corpus["boundaries"] + corpus.get("malformed_source", [])
        self.assertEqual(len({case["id"] for case in cases}), len(cases))
        for case in corpus["cases"]:
            with self.subTest(case=case["id"]):
                process = subprocess.run(
                    [sys.executable, "-I", "-X", "utf8", "-S", "-c", case["source"]],
                    capture_output=True, text=True, encoding="utf-8", timeout=5,
                )
                if "exception" in case:
                    self.assertNotEqual(process.returncode, 0)
                    expected = case["exception"] + (": " + case["message"] if case["message"] else "")
                    self.assertEqual(process.stderr.splitlines()[-1], expected)
                else:
                    self.assertEqual(process.returncode, 0, process.stderr)
                    self.assertEqual(process.stdout.replace("\r\n", "\n"), case["stdout"])
        for case in corpus["boundaries"]:
            with self.subTest(boundary=case["id"]):
                self.assertIn(case["classification"], {"rejected", "deferred"})
                ast.parse(case["source"])
        for case in corpus.get("malformed_source", []):
            with self.subTest(malformed=case["id"]), self.assertRaises(SyntaxError):
                ast.parse(case["source"])

    def test_directory_mutation_reference_is_independent_of_hash_seed(self):
        corpus = json.loads(CORPUS.with_name("instance-directories.json").read_text(encoding="utf-8"))
        case = next(case for case in corpus["cases"] if case["id"] == "collision-delete-current-key")
        for seed in range(16):
            with self.subTest(seed=seed):
                # -I would ignore PYTHONHASHSEED; this trusted synthetic source needs
                # different real table probe sequences to check callback idempotence.
                process = subprocess.run(
                    [sys.executable, "-X", "utf8", "-S", "-c", case["source"]],
                    env={**os.environ, "PYTHONHASHSEED": str(seed)},
                    capture_output=True, text=True, encoding="utf-8", timeout=5,
                )
                self.assertNotEqual(process.returncode, 0)
                self.assertEqual(process.stdout, case["stdout"])
                self.assertTrue(process.stderr.splitlines()[-1].startswith(case["error_type"] + ":"), process.stderr)
