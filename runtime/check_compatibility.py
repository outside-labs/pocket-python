"""Validate the versioned capability inventory and execute its representative probes."""

import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess

from check_conformance import run_browser
from check_functions import reference

ROOT = Path(__file__).resolve().parent
INVENTORY = ROOT.parent / 'docs/interpreter-compatibility.json'
PROBES = ROOT.parent / 'tests/fixtures/interpreter/compatibility.json'


def read_inventory():
    inventory = json.loads(INVENTORY.read_bytes())
    corpus = json.loads(PROBES.read_bytes())
    assert inventory['schema_version'] == corpus['schema_version'] == 1
    assert inventory['reference_version'] == corpus['reference_version'] == '3.14.7'
    ids = {case['id'] for case in corpus['cases']}
    assert {case['classification'] for case in corpus['cases']} <= {'supported', 'deferred', 'known-divergence', 'host-restricted'}
    tasks = {task['id'] for task in inventory['work_packages']}
    assert len(tasks) == len(inventory['work_packages'])
    assert len(ids) == len(corpus['cases'])
    statuses = {'supported', 'partial', 'deferred', 'host-restricted'}
    assert len({row['id'] for row in inventory['features']}) == len(inventory['features'])
    for row in [*inventory['features'], *inventory['builtins']]:
        assert row['status'] in statuses and row['scope'] and row['gaps'] is not None
        assert row['reference_version'] == '3.14.7' and row['targets'] == ['node', 'browser']
        assert row['next_tasks'] or row['status'] == 'supported'
        assert set(row['next_tasks']) <= tasks
        assert row['probes'] or row.get('evidence') or row['status'] in {'deferred', 'host-restricted'}
        for probe in row['probes']:
            assert probe in ids, (row['id'], probe)
        for evidence in row.get('evidence', []):
            path, case = evidence.split(':', 1)
            recorded = json.loads((ROOT.parent / path).read_bytes())['cases']
            assert isinstance(recorded, list) and any(item['id'] == case for item in recorded), evidence
    builtins = inventory['builtins']
    assert len(builtins) == 71 and len({row['id'] for row in builtins}) == 71
    assert {row['id'] for row in builtins} == set(inventory['builtin_reference_names'])
    assert {row['probes'][0] for row in builtins} <= ids
    return inventory, corpus


def check(target, channel=None):
    inventory, corpus = read_inventory()
    assert platform.python_version() == corpus['reference_version'], 'Oracle changes require an explicit version decision.'
    requests = [{'id': case['id'], 'modules': [{'name': 'app', 'package': False, 'imports': [],
        'notice': 'Synthetic coverage probe notice\n', 'source': case['source']}],
        'compileOptions': {'languageProfile': corpus['language_profile']}} for case in corpus['cases']]
    if target == 'node':
        response = json.loads(subprocess.check_output(['node', str(ROOT / 'source-runner.mjs')],
            input=json.dumps(requests), text=True, encoding='utf-8', timeout=30))
        host, actual = response['host'], response['results']
    else:
        host, actual = run_browser({'worker': 'source-worker.mjs'}, requests, channel)
    assert len(actual) == len(requests) and {r['id'] for r in actual} == {r['id'] for r in requests}
    actual = {result['id']: result for result in actual}
    records = []
    for case in corpus['cases']:
        expected, result = case['reference'], actual[case['id']]
        oracle = reference(case['source'], 'sources/app.py')
        reference_ok = oracle['stdout'] == expected['stdout'] and oracle['ok'] == (expected['error_type'] is None)
        if expected['error_type']:
            reference_ok = reference_ok and oracle['error']['type'] == expected['error_type']
        expected = case['engine']
        passed = reference_ok and result['stdout'] == expected['stdout']
        passed = passed and result['ok'] == (expected.get('error_type') is None and not expected.get('code'))
        for key, actual_key in [('error_type', 'type'), ('code', 'code'), ('phase', 'phase')]:
            if expected.get(key):
                passed = passed and result.get('error', {}).get(actual_key) == expected[key]
        if result.get('stats'):
            passed = passed and result['stats']['frames'] == 0
            passed = passed and all(result['closed'][key] == 0 for key in ['bytes', 'objects', 'roots', 'frames', 'external'])
        classification = case['classification']
        if classification == 'supported':
            passed = passed and result['stdout'] == oracle['stdout'] and result['ok'] == oracle['ok']
        records.append({'id': case['id'], 'classification': classification,
            'status': 'pass' if passed else 'fail', 'support_credit': classification == 'supported' and passed,
            'reference': oracle, 'actual': result})
    return {'schema_version': 1, 'suite': corpus['suite'], 'reference_version': platform.python_version(),
        'target': target, 'host_version': host, 'source_execution': True,
        'scope': 'Representative source/availability probes, not a percentage of Python coverage. Deferred/restricted/divergent observations earn no support credit.',
        'inventory_sha256': hashlib.sha256(INVENTORY.read_bytes()).hexdigest(),
        'corpus_sha256': hashlib.sha256(PROBES.read_bytes()).hexdigest(),
        'inputs_sha256': {p.name: hashlib.sha256(p.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
            for p in [*ROOT.glob('*.mjs'), Path(__file__), ROOT / 'check_functions.py'] if not p.name.endswith('.test.mjs')},
        'features': len(inventory['features']), 'builtin_names': len(inventory['builtins']), 'cases': records,
        'summary': {'pass': sum(c['status'] == 'pass' for c in records), 'fail': sum(c['status'] == 'fail' for c in records)},
        'observations': {kind: sum(c['classification'] == kind for c in records)
            for kind in ['supported', 'deferred', 'known-divergence', 'host-restricted']}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', choices=['node', 'browser'], default='node')
    parser.add_argument('--channel')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    result = check(args.target, args.channel)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'summary': result['summary'], 'observations': result['observations']}))
    for case in result['cases']:
        if case['status'] == 'fail':
            print(json.dumps(case))
    raise SystemExit(bool(result['summary']['fail']))
