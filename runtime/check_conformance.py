"""Compare supported engine bytecode fixtures with a CPython oracle, without fallback."""

import argparse
from functools import partial
import hashlib
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import platform
import random
import string
import subprocess
import sys
from threading import Thread


ROOT = Path(__file__).resolve().parent
CORPUS = ROOT.parent / "tests/fixtures/interpreter/language.json"


def oracle(expression):
    # Only expressions in the committed acceptance corpus reach this test oracle.
    source = (
        "import json\ntry:\n    value = (" + expression + ")\n"
        "    kind = 'bool' if type(value) is bool else 'int' if type(value) is int else None\n"
        "    if kind is None: raise TypeError('No adopted reference encoding')\n"
        "    print(json.dumps({'ok': True, 'result': {'type': kind, 'value': value if kind == 'bool' else str(value)}}))\n"
        "except Exception as error:\n    print(json.dumps({'ok': False, 'error': {'type': type(error).__name__, 'message': str(error)}}))\n"
    )
    result = subprocess.run([sys.executable, "-I", "-X", "utf8", "-S", "-c", source],
                            check=True, capture_output=True, text=True, encoding="utf-8", timeout=5)
    return json.loads(result.stdout)


def run_node(engine, requests):
    process = subprocess.run(["node", str(ROOT / "conformance.mjs"), engine],
                             input=json.dumps(requests), check=True, capture_output=True,
                             text=True, encoding="utf-8", timeout=15)
    response = json.loads(process.stdout)
    return response["host"], response["results"]


def run_browser(engine, requests, channel):
    from browser_smoke import Handler
    from playwright.sync_api import sync_playwright

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel=channel)
            try:
                page = browser.new_page()
                page.goto(origin)
                responses = page.evaluate("""async ({workerPath, requests}) => {
                  const results = [];
                  for (const request of requests) {
                    const result = await new Promise((resolve, reject) => {
                      const worker = new Worker(workerPath, {type: 'module'});
                      const timer = setTimeout(() => {
                        worker.terminate(); reject(new Error('Conformance worker timed out.'));
                      }, 10000);
                      worker.onmessage = event => {
                        clearTimeout(timer); worker.terminate(); resolve(event.data);
                      };
                      worker.onerror = event => {
                        clearTimeout(timer); worker.terminate(); reject(new Error(event.message));
                      };
                      worker.postMessage(request);
                    });
                    results.push({id: request.id, ...result});
                  }
                  return results;
                }""", {"workerPath": "/" + engine["worker"], "requests": requests})
                return browser.version, responses
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def validation_requests(engine_name):
    if engine_name == "vm1":
        def program(instructions, values=("1",)):
            return {"format": "pocket-python-bytecode", "version": 1,
                    "constants": [{"type": "int", "value": value} for value in values], "instructions": instructions}
        invalid = [
            ("budget-loop", program([["jump", 0]]), "BUDGET"),
            ("jump-outside", program([["jump", 100]]), "BYTECODE"),
            ("stack-underflow", program([["add"]]), "BYTECODE"),
            ("unreachable-unknown", program([["const", 0], ["return"], ["unknown"]]), "BYTECODE"),
            ("constant-limit", program([["const", 0], ["return"]], ["1" * 4097]), "BYTECODE"),
            ("integer-growth-limit", program([["const", 0], ["const", 1], ["add"], ["return"]], ["9" * 4096, "1"]), "BUDGET"),
            ("stack-growing-loop", program([["const", 0], ["jump", 0]]), "BYTECODE"),
            ("fallthrough", program([["const", 0]]), "BYTECODE"),
            ("version", {**program([["jump", 0]]), "version": 99}, "BYTECODE"),
        ]
        randomizer = random.Random(20261020)
        for index in range(8):
            invalid.append(("malformed-" + str(index), program([["const", randomizer.randrange(2, 1000)], ["return"]]), "BYTECODE"))
        return [{"id": name, "program": code, "maxSteps": 10, "expected_code": expected}
                for name, code, expected in invalid]
    if engine_name != "prototype":
        raise ValueError("Add version-specific validation cases for this engine.")
    def program(instructions):
        return {"format": "pocket-python-prototype", "version": 0, "instructions": instructions}
    cases = [
        ("budget-loop", [["jump", 0]], "BUDGET"),
        ("jump-outside", [["jump", 100]], "BYTECODE"),
        ("stack-underflow", [["add"]], "BYTECODE"),
        ("unreachable-unknown", [["const", "1"], ["return"], ["unknown"]], "BYTECODE"),
        ("constant-limit", [["const", "1" * 4097], ["return"]], "BYTECODE"),
        ("integer-growth-limit", [["const", "9" * 4096], ["const", "1"], ["add"], ["return"]], "BUDGET"),
    ]
    randomizer = random.Random(20261020)
    for index in range(8):
        operation = "invalid_" + "".join(randomizer.choices(string.ascii_letters, k=8))
        cases.append(("malformed-" + str(index), [[operation]], "BYTECODE"))
    return [{"id": name, "program": program(instructions), "maxSteps": 10,
             "expected_code": code} for name, instructions, code in cases]


def check(engine_name, target, channel=None):
    engines = json.loads((ROOT / "engines.json").read_text(encoding="utf-8"))
    engine = engines[engine_name]
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    supported, records = [], []
    for case in corpus["cases"]:
        missing = sorted(set(case["features"]) - set(engine["features"]))
        record = {"id": case["id"], "features": case["features"],
                  "source_sha256": hashlib.sha256(case["source"].encode("utf-8")).hexdigest()}
        if missing:
            records.append({**record, "status": "unsupported", "missing_features": missing})
        else:
            if engine_name not in case.get("programs", {}) or "expression" not in case:
                raise ValueError("Supported case lacks its engine fixture/reference: " + case["id"])
            supported.append((case, record))
    requests = [{"id": case["id"], "program": case["programs"][engine_name], "maxSteps": 100}
                for case, _ in supported]
    negative = validation_requests(engine_name)
    requests.extend({key: value for key, value in case.items() if key != "expected_code"} for case in negative)
    if len({request["id"] for request in requests}) != len(requests):
        raise ValueError("Conformance request IDs must be unique.")
    for case in corpus.get("malformed_source", []):
        if engine["source_execution"]:
            raise ValueError("Add a source-input adapter before claiming parser conformance.")
        records.append({"id": case["id"], "kind": "malformed-source", "status": "unsupported",
                        "missing_features": ["parser.source"],
                        "source_sha256": hashlib.sha256(case["source"].encode("utf-8")).hexdigest()})
    if not supported:
        raise ValueError("Engine declares no executable conformance cases.")
    host, results = run_node(engine_name, requests) if target == "node" else run_browser(engine, requests, channel)
    if len(results) != len(requests) or {result["id"] for result in results} != {request["id"] for request in requests}:
        raise ValueError("Engine response IDs/count do not match submitted cases.")
    results = {result["id"]: result for result in results}
    for case, record in supported:
        expected, actual = oracle(case["expression"]), results[case["id"]]
        if expected["ok"]:
            passed = actual["ok"] and actual["result"] == expected["result"]
        else:
            passed = not actual["ok"] and actual["error"].get("type") == expected["error"]["type"]
        records.append({**record, "status": "pass" if passed else "fail", "expected": expected, "actual": actual})
    for case in negative:
        actual = results[case["id"]]
        passed = not actual["ok"] and actual["error"].get("code") == case["expected_code"]
        records.append({"id": case["id"], "kind": "validation", "status": "pass" if passed else "fail", "actual": actual})
    return {"schema_version": 1, "engine": engine["identity"], "backend": engine["backend"],
            "corpus_sha256": hashlib.sha256(CORPUS.read_bytes()).hexdigest(),
            "input_mode": engine["input_mode"], "source_execution": engine["source_execution"],
            "features": engine["features"], "target": target, "host_version": host,
            "oracle": {"implementation": platform.python_implementation(), "version": platform.python_version()},
            "cases": records}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", default="prototype", choices=json.loads((ROOT / "engines.json").read_text(encoding="utf-8")))
    parser.add_argument("--target", default="node", choices=["node", "browser"])
    parser.add_argument("--channel")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = check(args.engine, args.target, args.channel)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    counts = {status: sum(case["status"] == status for case in report["cases"])
              for status in ["pass", "unsupported", "fail"]}
    print(json.dumps({"engine": report["engine"], "target": args.target,
                      "input_mode": report["input_mode"], "source_execution": report["source_execution"],
                      "host_version": report["host_version"], "oracle": report["oracle"], **counts}))
    if counts["fail"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
