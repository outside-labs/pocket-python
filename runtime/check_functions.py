"""Compare trusted function fixtures with CPython in Node or a browser worker."""

import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys

from check_conformance import run_browser
from function_fixtures import compile_fixture

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT.parent / "tests/fixtures/interpreter/functions.json"


def reference(source, filename):
    # Only the committed trusted corpus enters this oracle. No engine fallback.
    script = """import contextlib,io,json,traceback
source,filename = json.loads(input())
output = io.StringIO()
try:
    with contextlib.redirect_stdout(output):
        exec(compile(source, filename, 'exec'), {})
    result = {'ok': True}
except BaseException as error:
    result = {'ok': False, 'error': {'type': type(error).__name__, 'message': str(error),
      'frames': [{'function': frame.name, 'line': frame.lineno} for frame in traceback.extract_tb(error.__traceback__) if frame.filename == filename],
      'context': {'type': type(error.__context__).__name__, 'message': str(error.__context__)} if error.__context__ else None}}
print(json.dumps({**result, 'stdout': output.getvalue()}))
"""
    response = subprocess.run([sys.executable, "-I", "-X", "utf8", "-S", "-c", script],
                              input=json.dumps([source, filename]), capture_output=True, check=True,
                              text=True, encoding="utf-8", timeout=5)
    return json.loads(response.stdout)


def check(target, channel=None):
    raw = CORPUS.read_bytes()
    corpus = json.loads(raw)
    cases = corpus["cases"]
    language_raw = CORPUS.with_name("language.json").read_bytes()
    adopted = json.loads(language_raw)
    selected = {"closure", "exception-finally", "argument-default"}
    cases.extend({**case, "compare_message": True, "traceback": True}
                 for case in adopted["cases"] if case["id"] in selected)
    requests = [{"id": case["id"], "program": compile_fixture(case["source"], case["id"] + ".py"),
                 "options": {"maxSteps": 20000, "maxWork": 20000000}} for case in cases]
    requests.extend({"id": case["id"], "program": compile_fixture(case["source"], case["id"] + ".py"),
                     "options": case.get("options", {}), "memoryLimits": case.get("memoryLimits", {})}
                    for case in corpus["limits"])
    if len({request["id"] for request in requests}) != len(requests):
        raise ValueError("Conformance IDs must be unique")
    if target == "node":
        response = subprocess.run(["node", str(ROOT / "function-runner.mjs")], input=json.dumps(requests),
                                  text=True, encoding="utf-8", check=True, capture_output=True, timeout=30)
        response = json.loads(response.stdout)
        version, results = response["host"], response["results"]
    else:
        version, results = run_browser({"worker": "function-worker.mjs"}, requests, channel)
    if len(results) != len(requests) or {result["id"] for result in results} != {request["id"] for request in requests}:
        raise ValueError("Incomplete function conformance response")
    results = {result["id"]: result for result in results}
    records = []
    for case in cases:
        actual = results[case["id"]]
        expected = reference(case["source"], case["id"] + ".py")
        passed = actual["ok"] == expected["ok"] and actual["stdout"] == expected["stdout"]
        if not expected["ok"]:
            passed = passed and actual.get("error", {}).get("type") == expected["error"]["type"]
            if case.get("compare_message", True):
                passed = passed and actual.get("error", {}).get("message") == expected["error"]["message"]
            if case.get("traceback", True):
                frames = [{"function": frame["function"], "line": frame["location"]["span"][0]}
                          for frame in actual.get("error", {}).get("traceback", [])]
                passed = passed and frames == expected["error"]["frames"]
            passed = passed and actual.get("error", {}).get("context") == expected["error"]["context"]
        passed = passed and actual["stats"]["frames"] == 0 and actual["stats"]["roots"] == 0
        records.append({"id": case["id"], "features": case["features"], "source_sha256": hashlib.sha256(case["source"].encode()).hexdigest(),
                        "status": "pass" if passed else "fail", "expected": expected, "actual": actual})
    for case in corpus["limits"]:
        actual = results[case["id"]]
        passed = (not actual["ok"] and actual.get("error", {}).get("code") == case["code"] and
                  actual["stdout"] == case.get("stdout", "") and actual["stats"]["frames"] == 0)
        records.append({"id": case["id"], "features": ["function.resources"], "status": "pass" if passed else "fail", "actual": actual})
    digest = hashlib.sha256()
    for data in (raw, language_raw):
        digest.update(len(data).to_bytes(8, "big")); digest.update(data)
    report = {"schema_version": 1, "suite": "interpreter-functions/1", "engine": "pocket-python-bytecode/3", "target": target,
              "version": version, "reference": platform.python_version(), "input_mode": "trusted-bytecode-fixture",
              "source_execution": False, "corpus_sha256": digest.hexdigest(),
              "fixture_compiler_sha256": hashlib.sha256((ROOT / "function_fixtures.py").read_bytes()).hexdigest(), "cases": records,
              "summary": {status: sum(record["status"] == status for record in records) for status in ("pass", "fail")}}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["node", "browser"], default="node")
    parser.add_argument("--channel")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = check(args.target, args.channel)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "cases"}))
    if report["summary"]["fail"]:
        for case in report["cases"]:
            if case["status"] == "fail":
                print(json.dumps(case))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
