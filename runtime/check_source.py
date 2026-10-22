"""Differential source-to-result checks for the independent JavaScript VM front end."""

import argparse
import hashlib
import json
from pathlib import Path
import platform
import random
import subprocess
import unicodedata
import warnings

from check_conformance import oracle, run_browser
from check_functions import reference as function_reference
from check_modules import reference as module_reference, sources as module_sources

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT.parent / "tests/fixtures/interpreter/source.json"


def prepared():
    inputs = {name: CORPUS.with_name(name).read_bytes() for name in
              ["source.json", "functions.json", "modules.json", "language.json", "values.json"]}
    corpus = {name: json.loads(raw) for name, raw in inputs.items()}
    cases = [*corpus["source.json"]["cases"], *corpus["source.json"]["boundaries"],
             *corpus["source.json"]["malformed_source"], *corpus["source.json"]["limits"]]
    cases.extend({**case, "id": "functions:" + case["id"]} for case in corpus["functions.json"]["cases"] + corpus["functions.json"]["limits"])
    cases.extend({**case, "id": "modules:" + case["id"]} for case in corpus["modules.json"]["cases"] + corpus["modules.json"]["limits"])
    cases.extend({**case, "id": "language:" + case["id"]} for case in corpus["language.json"]["cases"]
                 if case["id"] in {"closure", "exception-finally", "argument-default"})
    cases.extend({**case, "id": "language-syntax:" + case["id"], "code": "SYNTAX"}
                 for case in corpus["language.json"].get("malformed_source", []))
    deferred = []
    for case in corpus["values.json"]["cases"]:
        expression = case.get("expression")
        if expression is None or any(word in expression for word in ["float(", "**", "lambda", "tuple("]):
            deferred.append({"id": "values:" + case["id"], "status": "unsupported",
                             "reason": "Requires a separately adopted source builtin/operator or statement fixture"})
        else:
            cases.append({**case, "id": "values:" + case["id"], "source": "result=(" + expression + ")\n", "expression": expression})
    rng = random.Random(3819)
    for index in range(24):
        a, b, c = (rng.randint(-30, 30) for _ in range(3))
        expression = f"(({a}) + ({b}) * ({c})) // {rng.randint(1, 9)}"
        cases.append({"id": f"generated-precedence:{index}", "source": "result=" + expression + "\n",
                      "expression": expression, "features": ["source.precedence", "int.floor-divide"]})
    return cases, deferred, inputs


def request(case):
    modules = module_sources(case) if "modules" in case else {"app": {"source": case["source"]}}
    # Grants come from the test's explicit supplied registry, never parser discovery.
    supplied = [{"name": name, "source": details["source"], "package": details.get("package", False),
                 "imports": details.get("imports", list(modules)), "notice": details.get("notice", "Synthetic test fixture notice\n")}
                for name, details in modules.items()]
    return {"id": case["id"], "modules": supplied, "entry": case.get("entry", "app"),
            "options": {"maxSteps": 50000, "maxWork": 20000000, **case.get("options", {})},
            "memoryLimits": case.get("memoryLimits", {}), "compileOptions": case.get("compileOptions", {}),
            "exports": ["result"] if "expression" in case else []}, modules


def check(target, channel=None):
    cases, deferred, inputs = prepared()
    requests, modules = [], {}
    for case in cases:
        item, registry = request(case); requests.append(item); modules[case["id"]] = registry
    assert len({case["id"] for case in cases}) == len(cases)
    if target == "node":
        process = subprocess.run(["node", str(ROOT / "source-runner.mjs")], input=json.dumps(requests),
                                 text=True, encoding="utf-8", capture_output=True, check=True, timeout=60)
        response = json.loads(process.stdout); version, results = response["host"], response["results"]
    else:
        version, results = run_browser({"worker": "source-worker.mjs"}, requests, channel)
    assert len(results) == len(cases) and {r["id"] for r in results} == {c["id"] for c in cases}
    results = {r["id"]: r for r in results}; records = []
    for case in cases:
        actual = results[case["id"]]; expected = None
        if "code" in case:
            if case["code"] == "SYNTAX":
                try:
                    compile(case["source"], "syntax.py", "exec")
                except SyntaxError:
                    pass
                else:
                    raise ValueError("Malformed-source fixture is valid in the reference: " + case["id"])
            if case["id"].startswith("unsupported-"):
                compile(case["source"], "boundary.py", "exec")
            passed = not actual["ok"] and actual.get("error", {}).get("code") == case["code"]
            if "span" in case:
                passed = passed and actual["error"].get("location", {}).get("span") == case["span"]
            if "phase" in case:
                passed = passed and actual["error"].get("phase") == case["phase"]
            if "message_contains" in case:
                passed = passed and case["message_contains"] in actual["error"]["message"]
            if "stdout" in case:
                passed = passed and actual["stdout"] == case["stdout"]
            if case["code"] in {"SYNTAX", "UNSUPPORTED", "COMPILE_BUDGET"} and actual.get("compilation") is None:
                passed = passed and actual["stdout"] == ""
        elif "expression" in case:
            expected = oracle(case["expression"])
            passed = actual["ok"] == expected["ok"] and actual["stdout"] == ""
            if expected["ok"]:
                passed = passed and actual.get("exports", {}).get("result") == expected["result"]
            else:
                passed = passed and actual.get("error", {}).get("type") == expected["error"]["type"] and actual["error"]["message"] == expected["error"]["message"]
        else:
            expected = (module_reference(modules[case["id"]], case.get("entry", "app")) if "modules" in case
                        else function_reference(case["source"], "sources/app.py"))
            passed = actual["ok"] == expected["ok"] and actual["stdout"] == expected["stdout"]
            if not expected["ok"]:
                passed = passed and actual.get("error", {}).get("type") == expected["error"]["type"]
                if case.get("compare_message", True):
                    passed = passed and actual["error"]["message"] == expected["error"]["message"]
                if case.get("traceback", True):
                    frames = [{"function": f["function"], "line": f["location"]["span"][0]} for f in actual["error"]["traceback"]]
                    passed = passed and frames == [{"function": f["function"], "line": f["line"]} for f in expected["error"]["frames"]]
                    if "modules" in case:
                        passed = passed and [f["location"]["filename"] for f in actual["error"]["traceback"]] == [f["filename"] for f in expected["error"]["frames"]]
                passed = passed and actual["error"].get("context") == expected["error"]["context"]
        if actual.get("stats") is not None:
            passed = passed and actual["stats"]["frames"] == 0 and actual["stats"]["roots"] == 1 and actual["closed"]["bytes"] == 0 and actual["closed"]["roots"] == 0
        records.append({"id": case["id"], "features": case.get("features", []), "status": "pass" if passed else "fail", "expected": expected, "actual": actual})
    engine_files = [p for p in ROOT.glob("*.mjs") if not p.name.endswith(".test.mjs")]
    return {"schema_version": 1, "suite": "interpreter-source/1", "engine": "pocket-python-source/1", "backend": "javascript-vm",
            "profile": "core-source/1", "input_mode": "source", "source_execution": True, "target": target, "host_version": version,
            "oracle": {"implementation": "CPython", "version": platform.python_version(), "unicode": unicodedata.unidata_version},
            "corpus_sha256": {name: hashlib.sha256(raw).hexdigest() for name, raw in inputs.items()},
            "inputs_sha256": {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in
                              [*engine_files, ROOT / "check_source.py", ROOT / "check_functions.py", ROOT / "check_modules.py", ROOT / "check_conformance.py", ROOT / "licenses/UNICODE.txt"]},
            "cases": records, "deferred": deferred, "summary": {**{s: sum(r["status"] == s for r in records) for s in ["pass", "fail"]}, "unsupported": len(deferred)}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["node", "browser"], default="node")
    parser.add_argument("--channel")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SyntaxWarning)
        report = check(args.target, args.channel)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key not in {"cases", "deferred"}}))
    for case in report["cases"]:
        if case["status"] == "fail":
            print(json.dumps(case))
    if report["summary"]["fail"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
