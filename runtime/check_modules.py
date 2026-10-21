"""CPython differential and policy checks for verified independent VM modules."""

import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys

from check_conformance import run_browser
from module_fixtures import build_registry

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT.parent / "tests/fixtures/interpreter/modules.json"


def sources(case):
    modules = {name: dict(details) for name, details in case["modules"].items()}
    notice = (ROOT.parent / "LICENSE").read_text(encoding="utf-8")
    for name, details in modules.items():
        if "fixture" in details:
            paths = {"operator": ROOT / "library/operator.py", "text-metrics": ROOT.parent / "examples/shared_text_metrics/computation.py"}
            details["source"] = paths[details.pop("fixture")].read_text(encoding="utf-8")
            details["notice"] = notice
    return modules


def reference(modules, entry):
    script = '''import contextlib,importlib,io,json,pathlib,sys,tempfile,traceback
modules,entry=json.loads(input())
with tempfile.TemporaryDirectory() as temp:
    root=pathlib.Path(temp)
    for name,details in modules.items():
        path=root/'sources'/pathlib.Path(*name.split('.'))
        path=path/'__init__.py' if details.get('package',False) else path.with_suffix('.py')
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(details['source'],encoding='utf-8')
    sys.path.insert(0,str(root/'sources'))
    output=io.StringIO()
    try:
        with contextlib.redirect_stdout(output):
            importlib.import_module(entry)
        result={'ok':True}
    except BaseException as error:
        frames=[{'function':frame.name,'line':frame.lineno,'filename':str(pathlib.Path(frame.filename).relative_to(root)).replace('\\\\','/')} for frame in traceback.extract_tb(error.__traceback__) if pathlib.Path(frame.filename).is_relative_to(root)]
        result={'ok':False,'error':{'type':type(error).__name__,'message':str(error),'frames':frames,'context':{'type':type(error.__context__).__name__,'message':str(error.__context__)} if error.__context__ else None}}
    print(json.dumps({**result,'stdout':output.getvalue()}))
'''
    result = subprocess.run([sys.executable, "-I", "-X", "utf8", "-S", "-c", script], input=json.dumps([modules, entry]),
                            text=True, encoding="utf-8", capture_output=True, check=True, timeout=5)
    return json.loads(result.stdout)


def check(target, channel=None):
    raw = CORPUS.read_bytes()
    corpus = json.loads(raw)
    cases = corpus["cases"] + corpus["limits"]
    requests, prepared = [], []
    for case in cases:
        modules = sources(case)
        bundle = build_registry(modules, case.get("entry", "app"))
        prepared.append((case, modules, bundle))
        requests.append({"id": case["id"], **bundle, "options": {"maxSteps": 50000, "maxWork": 20000000, **case.get("options", {})},
                         "memoryLimits": case.get("memoryLimits", {})})
    if len({request["id"] for request in requests}) != len(requests):
        raise ValueError("Module request IDs must be unique")
    if target == "node":
        process = subprocess.run(["node", str(ROOT / "module-runner.mjs")], input=json.dumps(requests),
                                 text=True, encoding="utf-8", capture_output=True, check=True, timeout=30)
        response = json.loads(process.stdout)
        version, results = response["host"], response["results"]
    else:
        version, results = run_browser({"worker": "module-worker.mjs"}, requests, channel)
    if len(results) != len(requests) or {result["id"] for result in results} != {request["id"] for request in requests}:
        raise ValueError("Incomplete module conformance response")
    results = {result["id"]: result for result in results}
    records = []
    for case, modules, bundle in prepared:
        actual = results[case["id"]]
        expected = None
        if "code" in case:
            passed = not actual["ok"] and actual.get("error", {}).get("code") == case["code"]
            if "message_contains" in case:
                passed = passed and case["message_contains"] in actual["error"]["message"]
            if "stdout" in case:
                passed = passed and actual["stdout"] == case["stdout"]
        else:
            expected = reference(modules, case.get("entry", "app"))
            passed = actual["ok"] == expected["ok"] and actual["stdout"] == expected["stdout"]
            if not expected["ok"]:
                passed = passed and actual.get("error", {}).get("type") == expected["error"]["type"]
                if case.get("compare_message", True):
                    passed = passed and actual["error"]["message"] == expected["error"]["message"]
                frames = [{"function": frame["function"], "line": frame["location"]["span"][0], "filename": frame["location"]["filename"]}
                          for frame in actual["error"].get("traceback", [])]
                passed = passed and frames == expected["error"]["frames"]
                passed = passed and actual["error"].get("context") == expected["error"]["context"]
        passed = passed and actual.get("stats", {}).get("frames") == 0 and actual["stats"]["roots"] == 1 and actual["closed"]["bytes"] == 0 and actual["closed"]["roots"] == 0
        records.append({"id": case["id"], "features": case["features"], "status": "pass" if passed else "fail", "expected": expected, "actual": actual,
                        "modules": {record["name"]: {key: record[key] for key in ("source", "bytecode", "licenses")} for record in bundle["manifest"]["modules"]}})
    return {"schema_version": 1, "suite": "interpreter-modules/1", "engine": "pocket-python-bytecode/4", "backend": "javascript-vm",
            "profile": "core-modules/1", "cycle_policy": "reject-initializing-target",
            "input_mode": "registry-fixture", "source_execution": False, "target": target, "host_version": version,
            "oracle": {"implementation": "CPython", "version": platform.python_version()}, "corpus_sha256": hashlib.sha256(raw).hexdigest(),
            "inputs_sha256": {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in
                              ("check_modules.py", "module_fixtures.py", "function_fixtures.py", "module-registry.mjs", "module-context.mjs",
                               "module-session.mjs", "functions.mjs", "function-bytecode.mjs", "function-objects.mjs", "values.mjs", "memory.mjs", "library/operator.py")},
            "cases": records, "summary": {status: sum(record["status"] == status for record in records) for status in ("pass", "fail")}}


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
    for case in report["cases"]:
        if case["status"] == "fail":
            print(json.dumps(case))
    if report["summary"]["fail"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
