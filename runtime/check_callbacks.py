"""Compare persistent callback source and results with pinned CPython."""

import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess

from check_conformance import run_browser
from check_functions import reference

ROOT = Path(__file__).resolve().parent


def check(target):
    path = ROOT.parent / 'tests/fixtures/interpreter/callbacks.json'
    corpus = json.loads(path.read_text())
    assert platform.python_version() == corpus['reference_version']
    requests = []
    for case in corpus['cases']:
        observed = reference(case['source'] + case['reference_tail'], 'sources/app.py')
        assert observed['ok'] and observed['stdout'] == case['stdout'], (case['id'], observed)
        requests.append({'id': case['id'], 'modules': [{'name': 'app', 'source': case['source'],
            'package': False, 'imports': [], 'notice': 'Synthetic callback conformance fixture'}],
            'events': case['events'], 'quantum': 1})
    if target == 'node':
        response = json.loads(subprocess.check_output(['node', str(ROOT / 'callback-runner.mjs')],
            input=json.dumps(requests), text=True, timeout=30))
        host, results = response['host'], response['results']
    else:
        host, results = run_browser({'worker': 'callback-worker.mjs'}, requests, None)
    assert len(results) == len(corpus['cases'])
    records = []
    for case, actual in zip(corpus['cases'], results, strict=True):
        passed = actual['id'] == case['id'] and actual['ok'] and actual['stdout'] == case['stdout']
        passed = passed and actual.get('results') == case['results']
        passed = passed and all(actual['closed'][key] == 0 for key in ['bytes', 'objects', 'roots', 'frames', 'external'])
        records.append({'id': case['id'], 'status': 'pass' if passed else 'fail', 'actual': actual})
    files = [p for p in ROOT.glob('*.mjs') if not p.name.endswith('.test.mjs')]
    return {'schema_version': 1, 'suite': corpus['suite'], 'reference_version': platform.python_version(),
            'target': target, 'host': host, 'driver': 'parked-serialized-events/1', 'cases': records,
            'corpus_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'inputs_sha256': {p.name: hashlib.sha256(p.read_bytes().replace(b'\r\n', b'\n')).hexdigest() for p in [*files, Path(__file__)]},
            'summary': {status: sum(record['status'] == status for record in records) for status in ['pass', 'fail']}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', choices=['node', 'browser'], default='node')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = check(args.target)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['summary']))
    for case in report['cases']:
        if case['status'] == 'fail':
            print(json.dumps(case))
    raise SystemExit(bool(report['summary']['fail']))
