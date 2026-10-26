"""Observe the committed maintenance audit corpus without changing the oracle."""

import argparse
import hashlib
from importlib.metadata import version as distribution_version
import json
from pathlib import Path
import platform
import re
import subprocess
import sys
import unicodedata


ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests/fixtures/interpreter/version-audit"
MANIFEST = FIXTURES / "cases.json"
ORACLE = {"implementation": "CPython", "version": "3.14.7", "unicode": "16.0.0"}
PROFILES = ("core-source/1", "classes-source/1")
CLASSIFICATIONS = {"supported", "unsupported", "unavailable-builtin", "denied-import", "syntax-rejection"}

# This script receives only sources loaded from the bounded committed corpus.
# Application code never runs inside the audit process or an engine adapter.
REFERENCE_SCRIPT = """import contextlib,io,json
source = json.loads(input())
output = io.StringIO()
try:
    with contextlib.redirect_stdout(output):
        exec(compile(source, 'sources/app.py', 'exec'), {})
    result = {'ok': True}
except BaseException as error:
    result = {'ok': False, 'error': {'type': type(error).__name__, 'message': str(error)}}
    if isinstance(error, SyntaxError):
        result['error']['diagnostic'] = {key: getattr(error, key, None) for key in
            ['msg', 'lineno', 'offset', 'end_lineno', 'end_offset']}
print(json.dumps({**result, 'stdout': output.getvalue()}))
"""


def sha256(path):
    # Match existing cross-platform engine reports' text normalization.
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def oracle_identity():
    return {"implementation": platform.python_implementation(),
            "version": platform.python_version(), "unicode": unicodedata.unidata_version}


def require_oracle():
    identity = oracle_identity()
    if identity != ORACLE:
        raise ValueError(f"Audit requires the unchanged semantic oracle {ORACLE}; got {identity}")
    return identity


def validate_expected(expected):
    if not isinstance(expected, dict) or type(expected.get("ok")) is not bool:
        raise ValueError("An observation must declare a boolean ok field")
    if not isinstance(expected.get("stdout"), str):
        raise ValueError("An observation must declare stdout")
    if not expected["ok"] and not isinstance(expected.get("error", {}).get("type"), str):
        raise ValueError("An error observation must declare its exception type")


def load_corpus():
    corpus = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if corpus.get("schema_version") != 1 or corpus.get("oracle") != ORACLE:
        raise ValueError("Unknown audit schema or semantic oracle")
    cases = corpus.get("cases", [])
    if not 1 <= len(cases) <= 32:
        raise ValueError("Audit corpus must contain 1 to 32 bounded programs")
    ids, files, prepared = set(), set(), []
    for case in cases:
        name, identifier = case.get("source_file", ""), case.get("id", "")
        if not re.fullmatch(r"[a-z][a-z0-9-]*", identifier) or identifier in ids:
            raise ValueError("Audit case IDs must be nonempty and unique")
        if not re.fullmatch(r"[a-z][a-z0-9-]*\.py", name) or name in files:
            raise ValueError("Audit sources must be unique local Python filenames")
        path = FIXTURES / name
        if path.is_symlink() or path.resolve().parent != FIXTURES.resolve():
            raise ValueError("Audit sources must stay inside the committed fixture directory")
        source = path.read_text(encoding="utf-8")
        if not 1 <= len(source.encode("utf-8")) <= 8192:
            raise ValueError("Audit source exceeds its 8 KiB limit")
        if case.get("kind") not in {"control", "semantic-delta", "diagnostic-delta"}:
            raise ValueError("Unknown audit case kind")
        if not case.get("upstream") or any(not url.startswith("https://github.com/python/cpython/")
                                            for url in case["upstream"]):
            raise ValueError("Each case needs official CPython source evidence")
        validate_expected(case["pinned_expected"])
        later = case.get("later")
        if later:
            if later.get("verification") != "source-only" or later.get("since") not in {"3.14.8", "3.14.9"}:
                raise ValueError("Later expectations must retain their source-only provenance")
            validate_expected(later["expected"])
        elif case["kind"] != "control":
            raise ValueError("A delta needs a separately labelled later expectation")
        expectation = case.get("engine_expectation")
        if expectation:
            if expectation.get("classification") not in CLASSIFICATIONS:
                raise ValueError("Unknown engine observation classification")
            validate_expected(expectation["expected"])
            if expectation["classification"] == "supported" and (
                    case["kind"] != "control" or not expectation["expected"]["ok"]):
                raise ValueError("Refusals and delta expectations cannot receive compatibility credit")
        ids.add(identifier)
        files.add(name)
        prepared.append({**case, "source": source, "source_sha256": sha256(path)})
    return corpus, prepared


def matches(expected, actual):
    """Compare the declared signature; preserve additional observed diagnostics."""
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(key in actual and matches(value, actual[key])
                                                for key, value in expected.items())
    return type(expected) is type(actual) and expected == actual


def observe_reference(source):
    process = subprocess.run([sys.executable, "-I", "-X", "utf8", "-S", "-c", REFERENCE_SCRIPT],
                             input=json.dumps(source), text=True, encoding="utf-8",
                             capture_output=True, check=True, timeout=5)
    if process.stderr or len(process.stdout.encode("utf-8")) > 65536:
        raise ValueError("Reference produced unexpected stderr or excessive output")
    result = json.loads(process.stdout)
    validate_expected(result)
    return result


def reference_report():
    identity = require_oracle()
    corpus, cases = load_corpus()
    records = []
    for case in cases:
        actual = observe_reference(case["source"])
        record = {key: case[key] for key in ["id", "kind", "category", "affected_api", "source_file", "source_sha256", "upstream"]}
        record["oracle"] = {"status": "verified" if matches(case["pinned_expected"], actual) else "mismatch",
                            "expected": case["pinned_expected"], "actual": actual}
        record["later"] = ({**case["later"], "status": "not-independently-verified",
                            "reason": "Later interpreter unavailable; expectation comes from official source, not execution"}
                           if case.get("later") else {"status": "control-only", "reason": case["purpose"]})
        records.append(record)
    return {"schema_version": 1, "suite": corpus["suite"], "mode": "reference-only",
            "source_execution": False, "engine_observations": [],
            "oracle": {**identity, "build": sys.version},
            "corpus_sha256": sha256(MANIFEST),
            "harness_sha256": sha256(Path(__file__)),
            "source_ledger_sha256": sha256(ROOT / "docs/version-audit/sources.json"),
            "cases": records, "unexecuted": corpus["unexecuted"],
            "summary": {"reference_verified": sum(r["oracle"]["status"] == "verified" for r in records),
                        "reference_mismatch": sum(r["oracle"]["status"] == "mismatch" for r in records),
                        "later_unverified": sum(r["later"]["status"] == "not-independently-verified" for r in records),
                        "engine_executed": 0}}


def source_requests(cases):
    return [{"id": profile + ":" + case["id"],
             "modules": [{"name": "app", "package": False, "source": case["source"],
                          "imports": [], "notice": "Synthetic maintenance audit fixture\n"}],
             "compileOptions": {"languageProfile": profile},
             "options": {"maxSteps": 10000, "maxWork": 1000000}}
            for profile in PROFILES for case in cases]


def run_engine(target, requests, channel=None):
    if target == "node":
        process = subprocess.run(["node", str(ROOT / "runtime/source-runner.mjs")],
                                 input=json.dumps(requests), text=True, encoding="utf-8",
                                 capture_output=True, check=True, timeout=30)
        if process.stderr:
            raise ValueError("Unexpected Node adapter stderr")
        response = json.loads(process.stdout)
        return response["host"], response["results"]
    if target == "browser":
        # Existing adapter uses a real module worker and terminates each worker;
        # the HTTP server and browser are closed in its finally blocks.
        from check_conformance import run_browser
        return run_browser({"worker": "source-worker.mjs"}, requests, channel)
    raise ValueError("Unknown independent engine target")


def validate_response_ids(requests, results):
    expected = [request["id"] for request in requests]
    actual = [result["id"] for result in results]
    if len(set(expected)) != len(expected) or len(set(actual)) != len(actual) or set(expected) != set(actual):
        raise ValueError("Engine response IDs must match every request exactly once")


def teardown_observation(actual):
    if actual.get("stats") is None:
        valid = (actual.get("ok") is False and actual.get("compilation") is None
                 and actual.get("closed") is None and actual.get("stdout") == ""
                 and actual.get("error", {}).get("phase") in {"tokenize", "parse", "bind", "compile"})
        return {"status": "session-not-created" if valid else "invalid-session-evidence",
                "zero_teardown_measured": False}, valid
    closed = actual.get("closed") or {}
    counters = {key: closed.get(key) for key in ["bytes", "objects", "roots", "frames", "external"]}
    valid = (actual["stats"].get("frames") == 0 and closed.get("state") == "closed"
             and all(type(value) is int and value == 0 for value in counters.values()))
    return {"status": "zero" if valid else "nonzero-or-missing",
            "zero_teardown_measured": valid, "closed": counters}, valid


def classify_observation(case, profile, actual):
    expectation = case["engine_expectation"]
    classification = expectation["classification"]
    passed = matches(expectation["expected"], actual)
    if classification == "supported":
        passed = passed and actual.get("ok") is True and matches(case["pinned_expected"], actual)
    teardown, teardown_valid = teardown_observation(actual)
    passed = passed and teardown_valid
    compilation = actual.get("compilation")
    if actual.get("stats") is not None:
        passed = (passed and isinstance(compilation, list) and len(compilation) == 1
                  and compilation[0].get("language_profile") == profile
                  and compilation[0].get("source", {}).get("sha256") == case["source_sha256"])
    return {"id": profile + ":" + case["id"], "case_id": case["id"], "profile": profile,
            "classification": classification, "status": "observed" if passed else "mismatch",
            "compatibility_credit": passed and classification == "supported", "teardown": teardown,
            "diagnostic_comparison": ("Not compared: engine UTF-8 spans and messages have a separate contract"
                                      if classification == "syntax-rejection" else None),
            "actual": actual}


def engine_hashes():
    runtime = ROOT / "runtime"
    files = sorted(path for path in runtime.glob("*.mjs") if not path.name.endswith(".test.mjs"))
    files.extend([runtime / "check_conformance.py", runtime / "browser_smoke.py", runtime / "licenses/UNICODE.txt"])
    return {path.relative_to(ROOT).as_posix(): sha256(path) for path in files}


def engine_report(target, channel=None):
    report = reference_report()
    if report["summary"]["reference_mismatch"]:
        raise ValueError("Reference mismatch; independent engine comparison was not started")
    _, cases = load_corpus()
    if any("engine_expectation" not in case for case in cases):
        raise ValueError("Every independent observation needs an explicit expectation")
    requests = source_requests(cases)
    hashes = engine_hashes()
    host, results = run_engine(target, requests, channel)
    validate_response_ids(requests, results)
    if engine_hashes() != hashes:
        raise ValueError("Engine source changed during observation")
    results = {result["id"]: result for result in results}
    records = [classify_observation(case, profile, results[profile + ":" + case["id"]])
               for profile in PROFILES for case in cases]
    identity = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT,
                              text=True, capture_output=True, check=True, timeout=5).stdout.strip()
    return {**report, "mode": "source", "source_execution": True, "target": target,
            "host_version": host, "profiles": list(PROFILES),
            "browser_driver": {"name": "playwright", "version": distribution_version("playwright"),
                               "channel": channel or "chromium"} if target == "browser" else None,
            "engine": {"name": "pocket-python-source/1", "input_mode": "independently-compiled-source",
                       "node_entry": "runtime/source-runner.mjs", "browser_entry": "runtime/source-worker.mjs",
                       "checkout_commit": identity, "inputs_sha256": hashes,
                       "identity_note": "Hashes identify the observed logical text, including local changes; checkout commit alone is insufficient"},
            "engine_observations": records,
            "summary": {**report["summary"], "engine_source_requests": len(records),
                        "engine_executed": sum(r["actual"].get("stats") is not None for r in records),
                        "engine_mismatch": sum(r["status"] == "mismatch" for r in records),
                        "supported_observations": sum(r["compatibility_credit"] for r in records),
                        "zero_teardown": sum(r["teardown"]["status"] == "zero" for r in records),
                        "session_not_created": sum(r["teardown"]["status"] == "session-not-created" for r in records),
                        "classifications": {name: sum(r["classification"] == name for r in records)
                                            for name in sorted(CLASSIFICATIONS)}}}


def compact_observation(record):
    actual = record["actual"]
    compilation = actual.get("compilation")
    return {key: record[key] for key in ["classification", "status", "compatibility_credit", "teardown"]} | {
        "ok": actual["ok"], "stdout": actual["stdout"], "error": actual.get("error"),
        "compilation": [{key: item[key] for key in ["module", "language_profile", "source", "bytecode"]}
                        for item in compilation] if compilation else None,
        "live_frames": actual["stats"]["frames"] if actual.get("stats") is not None else None}


def matrix_from_reports(node, browser):
    for target, report in [("node", node), ("browser", browser)]:
        if report.get("mode") != "source" or report.get("source_execution") is not True or report.get("target") != target:
            raise ValueError("The matrix requires independent source reports from both hosts")
    for key in ["oracle", "corpus_sha256", "harness_sha256", "source_ledger_sha256", "cases", "profiles"]:
        if node[key] != browser[key]:
            raise ValueError("Host reports describe different oracle or source inputs: " + key)
    if node["engine"]["inputs_sha256"] != browser["engine"]["inputs_sha256"]:
        raise ValueError("Host reports describe different independent engine sources")
    observations = {}
    for target, report in [("node", node), ("browser", browser)]:
        expected = [{"id": profile + ":" + case["id"]} for profile in PROFILES for case in report["cases"]]
        validate_response_ids(expected, report["engine_observations"])
        observations[target] = {item["id"]: compact_observation(item) for item in report["engine_observations"]}
    parity = observations["node"] == observations["browser"]
    records = [{**case, "observations": {profile: {target: observations[target][profile + ":" + case["id"]]
                                                  for target in ["node", "browser"]} for profile in PROFILES}}
               for case in node["cases"]]
    return {"schema_version": 1, "suite": node["suite"], "mode": "source-matrix", "source_execution": True,
            "oracle": node["oracle"],
            "identities": {**{key: node[key] for key in ["corpus_sha256", "harness_sha256", "source_ledger_sha256"]},
                           "checkout_commits": {target: report["engine"]["checkout_commit"]
                                                for target, report in [("node", node), ("browser", browser)]},
                           "engine_inputs_sha256": node["engine"]["inputs_sha256"]},
            "hosts": {"node": node["host_version"], "chromium": browser["host_version"],
                      "browser_driver": browser["browser_driver"]},
            "profiles": list(PROFILES), "cases": records, "unexecuted": node["unexecuted"],
            "summary": {"reference_verified": node["summary"]["reference_verified"],
                        "reference_mismatch": node["summary"]["reference_mismatch"],
                        "later_unverified": node["summary"]["later_unverified"],
                        "hosts_agree": parity,
                        "engine_mismatch": node["summary"]["engine_mismatch"] + browser["summary"]["engine_mismatch"] + int(not parity),
                        "per_host": {target: report["summary"] for target, report in [("node", node), ("browser", browser)]}}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["reference", "node", "browser", "matrix"], default="reference")
    parser.add_argument("--channel", help="Existing browser channel, e.g. chrome")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.target == "matrix":
        report = matrix_from_reports(engine_report("node"), engine_report("browser", args.channel))
    else:
        report = reference_report() if args.target == "reference" else engine_report(args.target, args.channel)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"]))
    for case in report["cases"]:
        if case["oracle"]["status"] == "mismatch":
            print(json.dumps(case))
    for observation in report.get("engine_observations", []):
        if observation["status"] == "mismatch":
            print(json.dumps(observation))
    raise SystemExit(bool(report["summary"]["reference_mismatch"] or report["summary"].get("engine_mismatch")))


if __name__ == "__main__":
    main()
