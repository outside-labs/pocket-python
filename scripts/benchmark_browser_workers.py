"""Compare isolated browser worker pool sizes on the same differential corpus."""

import argparse
import json
import os
from pathlib import Path
import platform
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
from check_classes import cached_references, check


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', type=Path, default=ROOT / 'tests/fixtures/interpreter/exceptions.json')
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--channel')
    parser.add_argument('--report', type=Path, default=ROOT / 'build/browser-worker-benchmark.json')
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error('--repeats must be positive')
    reference_start = time.monotonic()
    reference = cached_references(args.corpus)
    if reference['summary']['fail']:
        raise AssertionError(reference['summary'])
    reference_seconds = round(time.monotonic() - reference_start, 3)
    baseline, measurements = None, []
    original = os.environ.get('POCKET_PYTHON_BROWSER_WORKERS')
    try:
        for concurrency in (1, 2, 4, 8):
            durations = []
            os.environ['POCKET_PYTHON_BROWSER_WORKERS'] = str(concurrency)
            for _ in range(args.repeats):
                start = time.monotonic()
                report = check('browser', args.channel, args.corpus)
                durations.append(round(time.monotonic() - start, 3))
                if report['summary']['fail']:
                    raise AssertionError(report['summary'])
                observed = [(case['id'], case['status'], case['actual']) for case in report['cases']]
                if baseline is None:
                    baseline = observed
                if observed != baseline:
                    raise AssertionError('Pool size changed the ordered differential results')
            row = {'workers': concurrency, 'seconds': durations,
                   'median_seconds': statistics.median(durations), 'cases': len(baseline)}
            measurements.append(row)
            print(json.dumps(row), flush=True)
    finally:
        if original is None:
            os.environ.pop('POCKET_PYTHON_BROWSER_WORKERS', None)
        else:
            os.environ['POCKET_PYTHON_BROWSER_WORKERS'] = original
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps({'schema_version': 1, 'python': platform.python_version(),
        'host': platform.platform(), 'browser': report['host_version'],
        'corpus_sha256': report['corpus_sha256'], 'repeats': args.repeats,
        'reference_setup': {'seconds': reference_seconds, 'summary': reference['summary'],
                            'cache': reference['reference_cache']},
        'measurements': measurements}, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
