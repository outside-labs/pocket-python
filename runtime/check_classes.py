"""Check the adopted class corpus with the pinned CPython reference."""

import argparse
import hashlib
import json
from pathlib import Path
import platform

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
            'implementation_status': 'C1, C2 and C3 remain staged until engine evidence is recorded.',
            'cases': records, 'summary': {status: sum(r['reference_status'] == status for r in records)
                                        for status in ['pass', 'fail']}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference-only', action='store_true', required=True)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = references()
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report['summary']))
    for case in report['cases']:
        if case['reference_status'] == 'fail':
            print(json.dumps(case))
    raise SystemExit(bool(report['summary']['fail']))
