"""Observe the committed maintenance audit corpus without changing the oracle."""

import argparse
import hashlib
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = reference_report()
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"]))
    for case in report["cases"]:
        if case["oracle"]["status"] == "mismatch":
            print(json.dumps(case))
    raise SystemExit(bool(report["summary"]["reference_mismatch"]))


if __name__ == "__main__":
    main()
