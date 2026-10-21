"""Check the adopted class corpus with the pinned CPython reference."""

import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess

from check_conformance import run_browser

from check_functions import reference

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT.parent / 'tests/fixtures/interpreter/classes.json'


def references():
    raw = CORPUS.read_bytes()
    corpus = json.loads(raw)
    records = []
    for case in corpus['cases']:
        actual = reference(case['source'], 'sources/app.py')
        passed = actual['ok'] == ('error_type' not in case)
        passed = passed and actual['stdout'] == case.get('stdout', '')
        if 'error_type' in case:
            passed = passed and actual.get('error', {}).get('type') == case['error_type']
        records.append({'id': case['id'], 'stage': case['stage'],
                        'reference_status': 'pass' if passed else 'fail', 'reference': actual})
    return {'schema_version': 1, 'suite': 'interpreter-classes/1', 'profile': corpus['profile'],
            'mode': 'reference-only', 'reference_version': platform.python_version(),
            'corpus_sha256': hashlib.sha256(raw).hexdigest(), 'source_execution': False,
            'implementation_status': 'Reference mode does not execute the independent engine; see source-mode reports.',
            'cases': records, 'summary': {status: sum(r['reference_status'] == status for r in records)
                                        for status in ['pass', 'fail']}}


def check(target, channel=None):
    report = references()
    if report['summary']['fail']:
        raise AssertionError('The class reference corpus differs from its recorded expectations.')
    cases = json.loads(CORPUS.read_bytes())['cases']
    requests = [{'id': case['id'], 'modules': [{'name': 'app', 'package': False, 'imports': [],
        'notice': 'Synthetic class fixture notice\n', 'source': case['source']}],
        'compileOptions': {'languageProfile': 'classes-source/1'},
        'options': {'maxSteps': 50000, 'maxWork': 20000000}} for case in cases]
    if target == 'node':
        response = json.loads(subprocess.check_output(['node', str(ROOT / 'source-runner.mjs')],
            input=json.dumps(requests), text=True, encoding='utf-8', timeout=30))
        host, results = response['host'], response['results']
    else:
        host, results = run_browser({'worker': 'source-worker.mjs'}, requests, channel)
    assert len(results) == len(cases) and {r['id'] for r in results} == {c['id'] for c in cases}
    results = {item['id']: item for item in results}
    records = []
    for case, reference_case in zip(cases, report['cases']):
        actual, expected = results[case['id']], reference_case['reference']
        if case['stage'] == 'C1':
            passed = actual['ok'] == expected['ok'] and actual['stdout'] == expected['stdout']
            if not expected['ok']:
                passed = passed and actual.get('error', {}).get('type') == expected['error']['type']
            classification = 'reference'
        else:
            passed = not actual['ok'] and actual.get('error', {}).get('code') == 'UNSUPPORTED'
            classification = 'intentional-unsupported'
        if actual.get('compilation'):
            passed = passed and all(c['language_profile'] == 'classes-source/1' for c in actual['compilation'])
        if actual.get('stats'):
            passed = passed and actual['stats']['frames'] == 0
            passed = passed and all(actual['closed'][key] == 0 for key in ['bytes', 'roots', 'frames'])
        records.append({'id': case['id'], 'stage': case['stage'], 'classification': classification,
                        'status': 'pass' if passed else 'fail', 'reference': expected, 'actual': actual})
    files = [p for p in ROOT.glob('*.mjs') if not p.name.endswith('.test.mjs')]
    return {**report, 'mode': 'source', 'source_execution': True, 'target': target,
            'host_version': host, 'bytecode_version': 5,
            'implementation_status': 'C1 implemented; C2/C3 and deferred cases intentionally refuse.',
            'comparison': 'Common C1 stdout and error types match CPython; messages/repr identity are not compared. Later stages must refuse explicitly.',
            'inputs_sha256': {p.name: hashlib.sha256(p.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
                              for p in [*files, Path(__file__), ROOT / 'check_functions.py']},
            'cases': records, 'summary': {status: sum(r['status'] == status for r in records) for status in ['pass', 'fail']}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference-only', action='store_true')
    parser.add_argument('--target', choices=['node', 'browser'], default='node')
    parser.add_argument('--channel')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = references() if args.reference_only else check(args.target, args.channel)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report['summary']))
    for case in report['cases']:
        if case.get('status', case.get('reference_status')) == 'fail':
            print(json.dumps(case))
    raise SystemExit(bool(report['summary']['fail']))
