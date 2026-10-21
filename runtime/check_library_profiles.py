"""Compare explicit full/reduced source-library profiles in Node and Chromium."""

import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys

from check_conformance import run_browser
from check_functions import reference

ROOT = Path(__file__).resolve().parent


def cases():
    computation = (ROOT.parent / 'examples/shared_text_metrics/computation.py').read_text(encoding='utf-8')
    common = [('empty', ''), ('unicode', 'A😀 é\nline two'), ('non-ascii-space', 'a\u00a0b')]
    result = [{'id': 'metrics-' + name, 'source': computation + '\nvalue=metrics(' + repr(text) + ')\nprint(value[0],value[1],value[2])\n'} for name, text in common]
    result += [{'id': 'closure', 'source': 'def outer(x):\n    def inner(y):\n        return x+y\n    return inner\nprint(outer(9007199254740993)(1))\n'},
               {'id': 'aliases', 'source': "a=[1]\nb=a\na+=[2]\nprint(a is b,len(b),b[1])\n"},
               {'id': 'caught-exception', 'source': "try:\n    1//0\nexcept ZeroDivisionError:\n    print('caught')\n"}]
    for name, expression in [
        ('add', 'operator.add(9007199254740993,1)'), ('sub', 'operator.sub(2,7)'),
        ('mul', 'operator.mul(7,-3)'), ('floordiv', 'operator.floordiv(-7,3)'), ('mod', 'operator.mod(-7,3)'),
        ('eq', 'operator.eq(True,1)'), ('lt', "operator.lt('A','😀')"), ('neg', 'operator.neg(5)'),
        ('not', 'operator.not_([])'), ('truth', "operator.truth('x')"), ('getitem', 'operator.getitem([4,5],-1)')]:
        result.append({'id': 'operator-' + name, 'source': 'import operator\nprint(' + expression + ')\n', 'operator': True})
    result.append({'id': 'operator-error', 'source': 'import operator\noperator.floordiv(1,0)\n', 'operator': True})
    return result


def check(target, channel=None):
    library = [{'name': 'operator', 'package': False, 'imports': [],
                'source': (ROOT / 'library/operator.py').read_text(encoding='utf-8'),
                'notice': (ROOT / 'licenses/POCKET-PYTHON.txt').read_text(encoding='utf-8')}]
    requests, expected, classification = [], {}, {}
    for case in cases():
        oracle = reference(case['source'], 'sources/app.py')
        for profile in ['core-only/1', 'operator/1']:
            identity = profile + ':' + case['id']
            requests.append({'id': identity, 'source': case['source'], 'profile': profile,
                             'libraries': library if profile == 'operator/1' else [],
                             'options': {'maxSteps': 50000, 'maxWork': 20000000}})
            expected[identity] = ({'ok': False, 'error': {'type': 'ImportError'}, 'stdout': ''}
                                  if case.get('operator') and profile == 'core-only/1' else oracle)
            classification[identity] = 'missing-library' if case.get('operator') and profile == 'core-only/1' else 'reference'
    for identity, options, code in [('unknown-profile', {'profile': 'os/1'}, 'LIBRARY_PROFILE'),
                                     ('missing-source', {'profile': 'operator/1'}, 'LIBRARY_PROFILE'),
                                     ('unavailable-host', {'host': 'fetch/1'}, 'UNAVAILABLE'),
                                     ('compile-budget', {'profile': 'operator/1', 'libraries': library, 'compileOptions': {'maxWork': 1}}, 'COMPILE_BUDGET')]:
        requests.append({'id': identity, 'source': "print('never')\n", **options})
        expected[identity] = {'ok': False, 'code': code, 'stdout': ''}; classification[identity] = 'policy'
    if target == 'node':
        response = json.loads(subprocess.check_output(['node', str(ROOT / 'library-profile-runner.mjs')], input=json.dumps(requests), text=True, encoding='utf-8', timeout=30))
        version, results = response['host'], response['results']
    else:
        version, results = run_browser({'worker': 'library-profile-worker.mjs'}, requests, channel)
    assert len(results) == len(requests) and {item['id'] for item in results} == set(expected)
    records = []
    for item in results:
        wanted = expected[item['id']]
        passed = item['ok'] == wanted['ok'] and item['stdout'] == wanted['stdout']
        if not wanted['ok']:
            passed = passed and (item['error']['code'] == wanted['code'] if 'code' in wanted else item['error']['type'] == wanted['error']['type'])
        if item['stats'] is not None:
            passed = passed and item['stats']['frames'] == 0 and item['closed']['bytes'] == 0 and item['closed']['roots'] == 0
        records.append({'id': item['id'], 'classification': classification[item['id']], 'status': 'pass' if passed else 'fail', 'expected': wanted, 'actual': item})
    files = ['library-profiles.mjs', 'library-selection.mjs', 'library-catalog.mjs', 'library-profile-request.mjs', 'library/operator.py', 'licenses/POCKET-PYTHON.txt', 'check_library_profiles.py']
    return {'schema_version': 1, 'suite': 'interpreter-library-profiles/1', 'source_execution': True,
            'engine': 'pocket-python-source/1', 'language_profile': 'core-source/1', 'target': target,
            'host_version': version, 'reference': platform.python_version(),
            'inputs_sha256': {name: hashlib.sha256((ROOT / name).read_bytes().replace(b'\r\n', b'\n')).hexdigest() for name in files},
            'comparison': 'Common source compares stdout and error types with CPython. Missing-library cases intentionally refuse; wrapper traceback frames are retained, not equated to native stdlib frames.',
            'cases': records, 'summary': {status: sum(item['status'] == status for item in records) for status in ['pass', 'fail']}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', choices=['node', 'browser'], default='node')
    parser.add_argument('--channel')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = check(args.target, args.channel)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report['summary']))
    for case in report['cases']:
        if case['status'] == 'fail':
            print(json.dumps(case))
    sys.exit(bool(report['summary']['fail']))
