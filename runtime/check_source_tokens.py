"""Compare independent source tokens/literals/spans with CPython test oracles."""

import argparse
import ast
import hashlib
import io
import json
import keyword
from pathlib import Path
import platform
import struct
import subprocess
import tokenize
import unicodedata

from check_conformance import run_browser

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT.parent / "tests/fixtures/interpreter/source-tokens.json"


def tagged(value):
    if type(value) is int:
        return {"type": "int", "value": str(value)}
    if type(value) is float:
        return {"type": "float", "bits": struct.pack(">d", value).hex()}
    if type(value) is str:
        return {"type": "str", "codepoints": list(map(ord, value))}
    raise ValueError("Unadopted lexical literal")


def reference(source):
    source = source.replace("\r\n", "\n").replace("\r", "\n")
    compile(source, "reference.py", "exec")  # Only committed test inputs; no execution.
    lines = source.split("\n")
    def span(position):
        line, column = position
        return [line, len(lines[line - 1][:column].encode("utf-8")) + 1]
    result = []
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type in {tokenize.NL, tokenize.COMMENT, tokenize.ENCODING}:
            continue
        kinds = {tokenize.NAME: "keyword" if keyword.iskeyword(token.string) else "name",
                 tokenize.NUMBER: "number", tokenize.STRING: "string", tokenize.OP: "op",
                 tokenize.NEWLINE: "newline", tokenize.INDENT: "indent", tokenize.DEDENT: "dedent", tokenize.ENDMARKER: "eof"}
        kind = kinds.get(token.type)
        if kind is None:
            raise ValueError("Unexpected reference token " + repr(token))
        item = {"kind": kind}
        if kind in {"keyword", "name", "op", "number", "string"}:
            item.update(value=unicodedata.normalize("NFKC", token.string) if kind in {"name", "keyword"} else token.string,
                        span=span(token.start) + span(token.end))
        if kind in {"number", "string"}:
            item["literal"] = tagged(ast.literal_eval(token.string))
        result.append(item)
    return result


def canonical(tokens):
    return [{key: value for key, value in item.items() if key in
             ({"kind", "value", "span", "literal"} if item["kind"] in {"keyword", "name", "op", "number", "string"} else {"kind"})}
            for item in tokens]


def check(target, channel=None):
    inputs = {"source-tokens.json": CORPUS.read_bytes()}
    cases = json.loads(inputs["source-tokens.json"])["cases"]
    # Existing semantic sources also exercise scanning, without claiming execution.
    for filename in ["functions.json", "values.json"]:
        raw = CORPUS.with_name(filename).read_bytes()
        inputs[filename] = raw
        cases.extend({"id": filename.removesuffix(".json") + ":" + c["id"], "source": c["source"]}
                     for c in json.loads(raw)["cases"])
    requests = [{"id": c["id"], **{key: c[key] for key in ("source", "bytes", "options") if key in c}} for c in cases]
    assert len({case["id"] for case in cases}) == len(cases)
    if target == "node":
        process = subprocess.run(["node", str(ROOT / "source-token-runner.mjs")], input=json.dumps(requests),
                                 text=True, encoding="utf-8", capture_output=True, check=True, timeout=30)
        response = json.loads(process.stdout)
        version, results = response["host"], response["results"]
    else:
        version, results = run_browser({"worker": "source-token-worker.mjs"}, requests, channel)
    assert len(results) == len(cases) and {r["id"] for r in results} == {c["id"] for c in cases}
    results = {r["id"]: r for r in results}
    records = []
    for case in cases:
        actual = results[case["id"]]
        expected = None
        if "code" in case:
            passed = not actual["ok"] and actual.get("error", {}).get("code") == case["code"]
            if "type" in case:
                passed = passed and actual["error"]["type"] == case["type"]
        else:
            source = case.get("source") if "source" in case else bytes(case["bytes"]).decode("utf-8-sig")
            expected = reference(source)
            passed = actual["ok"] and canonical(actual["tokens"]) == expected
        records.append({"id": case["id"], "status": "pass" if passed else "fail", "expected": expected, "actual": actual})
    return {"schema_version": 1, "suite": "interpreter-source-tokens/1", "input_mode": "source-lexing", "source_execution": False,
            "target": target, "host_version": version, "oracle": {"implementation": "CPython", "version": platform.python_version(),
            "unicode": unicodedata.unidata_version}, "corpus_sha256": {name: hashlib.sha256(raw).hexdigest() for name, raw in inputs.items()},
            "inputs_sha256": {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in
                              ["source-tokens.mjs", "source-identifiers.mjs", "licenses/UNICODE.txt", "source-token-request.mjs", "source-token-runner.mjs", "source-token-worker.mjs", "check_source_tokens.py"]},
            "cases": records, "summary": {status: sum(r["status"] == status for r in records) for status in ["pass", "fail"]}}


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
