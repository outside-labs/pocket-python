"""Check the adopted class corpus with the pinned CPython reference."""

import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import tempfile

from check_conformance import run_browser

from check_functions import reference

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT.parent / 'tests/fixtures/interpreter/classes.json'


def reference_case(case):
    if not case.get('modules'):
        return reference(case['source'], 'sources/app.py')
    # Trusted synthetic registry fixtures get real isolated Python imports.
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        for module in case['modules']:
            parts = module['name'].split('.')
            path = root.joinpath(*parts, '__init__.py') if module.get('package') else root.joinpath(*parts).with_suffix('.py')
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(module['source'], encoding='utf-8')
        source = "__import__('sys').path.insert(0, " + repr(str(root)) + ')\n' + case['source']
        return reference(source, 'sources/app.py')


def references(corpus_path=CORPUS):
    raw = corpus_path.read_bytes()
    corpus = json.loads(raw)
    if corpus.get('reference_version') and platform.python_version() != corpus['reference_version']:
        raise AssertionError('The corpus requires its explicitly pinned reference version.')
    records = []
    for case in corpus['cases']:
        actual = reference_case(case)
        passed = actual['ok'] == ('error_type' not in case)
        passed = passed and actual['stdout'] == case.get('stdout', '')
        if 'error_type' in case:
            passed = passed and actual.get('error', {}).get('type') == case['error_type']
        if 'error_frames' in case:
            passed = passed and actual.get('error', {}).get('frames') == case['error_frames']
        if 'error_context_type' in case:
            passed = passed and (actual.get('error', {}).get('context') or {}).get('type') == case['error_context_type']
        records.append({'id': case['id'], 'stage': case['stage'],
                        'reference_status': 'pass' if passed else 'fail', 'reference': actual})
    return {'schema_version': 1, 'suite': corpus.get('suite', 'interpreter-classes/1'), 'profile': corpus['profile'],
            'mode': 'reference-only', 'reference_version': platform.python_version(),
            'corpus_sha256': hashlib.sha256(raw).hexdigest(), 'source_execution': False,
            'implementation_status': 'Reference mode does not execute the independent engine; see source-mode reports.',
            'cases': records, 'summary': {status: sum(r['reference_status'] == status for r in records)
                                        for status in ['pass', 'fail']}}


def check(target, channel=None, corpus_path=CORPUS, stages=None, stepped=False, profile=None):
    report = references(corpus_path)
    if report['summary']['fail']:
        raise AssertionError('The class reference corpus differs from its recorded expectations.')
    corpus = json.loads(corpus_path.read_bytes())
    selected_profile = profile or corpus['profile']
    available = {case['stage'] for case in corpus['cases']}
    if stages and not set(stages) <= available:
        raise ValueError('Unknown corpus stage selection.')
    cases = [case for case in corpus['cases'] if (not stages or case['stage'] in stages) and
             selected_profile in case.get('profiles', [corpus['profile']])]
    if not cases:
        raise ValueError('No source cases belong to the selected profile/stages.')
    report['profile'] = selected_profile
    reference_by_id = {case['id']: case['reference'] for case in report['cases']}
    adopted = corpus.get('implemented_stages', ['C1'])
    requests = [{'id': case['id'], 'modules': [{'name': 'app', 'package': False, 'imports': case.get('imports', []),
        'notice': 'Synthetic class fixture notice\n', 'source': case['source']}] +
        [{**module, 'notice': 'Synthetic class fixture notice\n'} for module in case.get('modules', [])],
        'compileOptions': {'languageProfile': report['profile']},
        'options': {'maxSteps': 50000, 'maxWork': 20000000}} for case in cases]
    if target == 'node':
        response = json.loads(subprocess.check_output(['node', str(ROOT / ('execution-runner.mjs' if stepped else 'source-runner.mjs'))],
            input=json.dumps(requests), text=True, encoding='utf-8', timeout=30))
        host, results = response['host'], response['results']
    else:
        host, results = run_browser({'worker': 'execution-worker.mjs' if stepped else 'source-worker.mjs'}, requests, channel)
    assert len(results) == len(cases) and {r['id'] for r in results} == {c['id'] for c in cases}
    results = {item['id']: item for item in results}
    records = []
    for case in cases:
        actual, expected = results[case['id']], reference_by_id[case['id']]
        if case['stage'] in adopted:
            passed = actual['ok'] == expected['ok'] and actual['stdout'] == expected['stdout']
            if not expected['ok']:
                passed = passed and actual.get('error', {}).get('type') == expected['error']['type']
            if 'error_frames' in case:
                frames = [{'function': frame['function'], 'line': frame['location']['span'][0] if frame.get('location') else None}
                          for frame in actual.get('error', {}).get('traceback', [])]
                passed = passed and frames == case['error_frames']
            if 'error_context_type' in case:
                passed = passed and (actual.get('error', {}).get('context') or {}).get('type') == case['error_context_type']
            classification = 'reference'
        else:
            passed = not actual['ok'] and actual.get('error', {}).get('code') == 'UNSUPPORTED'
            classification = 'intentional-unsupported'
        if actual.get('compilation'):
            passed = passed and all(c['language_profile'] == report['profile'] for c in actual['compilation'])
        if actual.get('stats'):
            passed = passed and actual['stats']['frames'] == 0
            passed = passed and all(actual['closed'][key] == 0 for key in ['bytes', 'roots', 'frames'])
        records.append({'id': case['id'], 'stage': case['stage'], 'classification': classification,
                        'status': 'pass' if passed else 'fail', 'reference': expected, 'actual': actual})
    files = [p for p in ROOT.glob('*.mjs') if not p.name.endswith('.test.mjs')]
    return {**report, 'mode': 'source', 'source_execution': True, 'target': target, 'execution_driver': 'instruction-boundary' if stepped else 'drain',
            'host_version': host, 'bytecode_version': 4 if selected_profile == 'core-source/1' else 5,
            'corpus_cases': len(corpus['cases']), 'source_cases': len(cases),
            'selected_stages': sorted({case['stage'] for case in cases}),
            'omitted_stages': sorted(available - {case['stage'] for case in cases}),
            'omitted_profile_cases': [case['id'] for case in corpus['cases'] if selected_profile not in case.get('profiles', [corpus['profile']])],
            'reference_summary': report['summary'],
            'implementation_status': 'Implemented stages: ' + ', '.join(adopted) + '. Other recorded stages must refuse.',
            'comparison': 'Adopted stdout and error types match CPython; messages/repr identity are not compared. Later stages must refuse explicitly.',
            'inputs_sha256': {p.name: hashlib.sha256(p.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
                              for p in [*files, Path(__file__), ROOT / 'check_functions.py']},
            'cases': records, 'summary': {status: sum(r['status'] == status for r in records) for status in ['pass', 'fail']}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference-only', action='store_true')
    parser.add_argument('--target', choices=['node', 'browser'], default='node')
    parser.add_argument('--channel')
    parser.add_argument('--stepped', action='store_true', help='Advance the internal owned execution one instruction at a time.')
    parser.add_argument('--corpus', type=Path, default=CORPUS)
    parser.add_argument('--stages', nargs='+', help='Execute only these source stages; reference validation still covers the complete corpus.')
    parser.add_argument('--profile', choices=['core-source/1', 'classes-source/1'], help='Select explicitly profiled source cases from the corpus.')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = references(args.corpus) if args.reference_only else check(args.target, args.channel, args.corpus, args.stages, args.stepped, args.profile)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report['summary']))
    for case in report['cases']:
        if case.get('status', case.get('reference_status')) == 'fail':
            print(json.dumps(case))
    raise SystemExit(bool(report['summary']['fail']))
