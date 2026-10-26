import copy
import importlib.util
import json
from pathlib import Path
import shutil
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

    def test_missing_duplicate_or_foreign_engine_results_are_rejected(self):
        requests = [{"id": "one"}, {"id": "two"}]
        for results in [[{"id": "one"}], [{"id": "one"}, {"id": "one"}],
                        [{"id": "one"}, {"id": "foreign"}]]:
            with self.subTest(results=results), self.assertRaisesRegex(ValueError, "exactly once"):
                audit.validate_response_ids(requests, results)

    def test_oracle_shaped_output_cannot_stand_in_for_engine_execution(self):
        _, cases = audit.load_corpus()
        case = next(case for case in cases if case["engine_expectation"]["classification"] == "supported")
        record = audit.classify_observation(case, "core-source/1", case["pinned_expected"])
        self.assertEqual(record["status"], "mismatch")
        self.assertFalse(record["compatibility_credit"])

    def test_profile_source_identity_and_zero_teardown_are_required(self):
        _, cases = audit.load_corpus()
        case = next(case for case in cases if case["engine_expectation"]["classification"] == "supported")
        actual = {**case["pinned_expected"], "stats": {"frames": 0},
                  "closed": {"state": "closed", "bytes": 0, "objects": 0, "roots": 0, "frames": 0, "external": 0},
                  "compilation": [{"language_profile": "core-source/1", "source": {"sha256": case["source_sha256"]}}]}
        good = audit.classify_observation(case, "core-source/1", actual)
        self.assertTrue(good["compatibility_credit"])
        variants = [copy.deepcopy(actual) for _ in range(4)]
        variants[0]["closed"]["bytes"] = 1
        del variants[1]["closed"]
        variants[2]["compilation"][0]["language_profile"] = "classes-source/1"
        variants[3]["compilation"][0]["source"]["sha256"] = "different source"
        for observation in variants:
            with self.subTest(observation=observation):
                record = audit.classify_observation(case, "core-source/1", observation)
                self.assertEqual(record["status"], "mismatch")
                self.assertFalse(record["compatibility_credit"])

    def test_compile_refusal_has_no_compatibility_or_measured_teardown_credit(self):
        _, cases = audit.load_corpus()
        case = next(case for case in cases if case["engine_expectation"]["classification"] == "unsupported")
        actual = {**case["engine_expectation"]["expected"], "stats": None, "compilation": None}
        record = audit.classify_observation(case, "core-source/1", actual)
        self.assertEqual(record["status"], "observed")
        self.assertFalse(record["compatibility_credit"])
        self.assertEqual(record["teardown"]["status"], "session-not-created")
        self.assertFalse(record["teardown"]["zero_teardown_measured"])
        malformed = copy.deepcopy(actual)
        malformed["error"]["phase"] = "registry"
        self.assertEqual(audit.classify_observation(case, "core-source/1", malformed)["status"], "mismatch")

    def test_matrix_rejects_reference_only_reports(self):
        with self.assertRaisesRegex(ValueError, "independent source reports"):
            audit.matrix_from_reports({"mode": "reference-only", "source_execution": False}, {})

    def test_profile_specific_pre_session_refusals_receive_no_teardown_credit(self):
        _, cases = audit.load_corpus()
        case = next(case for case in cases if case["id"] == "bytes-lookup-error")
        for profile, phase in [("core-source/1", "parse"), ("classes-source/1", "bind")]:
            with self.subTest(profile=profile):
                actual = copy.deepcopy(case["engine_expectation"]["expected"])
                actual.update(stats=None, compilation=None)
                actual["error"]["phase"] = phase
                record = audit.classify_observation(case, profile, actual)
                self.assertEqual(record["status"], "observed")
                self.assertFalse(record["compatibility_credit"])
                self.assertFalse(record["teardown"]["zero_teardown_measured"])

    @unittest.skipUnless(PINNED and shutil.which("node"), "Requires the pinned oracle and installed Node")
    def test_real_node_observations_preserve_profile_and_evidence_boundaries(self):
        report = audit.engine_report("node")
        self.assertEqual(report["summary"]["engine_mismatch"], 0)
        self.assertEqual(report["summary"]["reference_mismatch"], 0)
        self.assertTrue(report["source_execution"])
        self.assertEqual(len(report["engine_observations"]), 2 * len(report["cases"]))
        self.assertEqual(set(report["profiles"]), {"core-source/1", "classes-source/1"})
        self.assertGreater(report["summary"]["supported_observations"], 0)
        self.assertEqual(report["summary"]["engine_executed"], report["summary"]["zero_teardown"])
        for observation in report["engine_observations"]:
            if observation["classification"] != "supported":
                self.assertFalse(observation["compatibility_credit"])
        # Synthetic report mutations test matrix validation; only the separate
        # real Chromium command can create browser execution evidence.
        synthetic_browser = copy.deepcopy(report)
        synthetic_browser.update(target="browser", host_version="synthetic-test-host", browser_driver={"name": "test-double"})
        synthetic_browser["corpus_sha256"] = "different-corpus"
        with self.assertRaisesRegex(ValueError, "different oracle or source inputs"):
            audit.matrix_from_reports(report, synthetic_browser)
        synthetic_browser["corpus_sha256"] = report["corpus_sha256"]
        synthetic_browser["engine_observations"][0]["actual"]["stdout"] = "cross-host disagreement\n"
        matrix = audit.matrix_from_reports(report, synthetic_browser)
        self.assertFalse(matrix["summary"]["hosts_agree"])
        self.assertEqual(matrix["summary"]["engine_mismatch"], 1)


if __name__ == "__main__":
    unittest.main()
