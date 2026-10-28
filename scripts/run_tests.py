"""Run named validation suites locally or as deterministic CI shards."""

import argparse
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.test_manifest import SUITES, checks


def select_checks(suites, features=()):
    selected = {group for suite in suites for group in SUITES[suite]}
    return [check for check in checks() if check.suite in selected and
            (not features or any(feature in check.id for feature in features))]


def shards(selected, count):
    """Greedy longest-first balancing, retaining manifest order within a shard."""
    if count < 1:
        raise ValueError('Shard count must be positive')
    if count > 1 and any(check.suite in {'python', 'prepare-browser', 'smoke'} for check in selected):
        raise ValueError('Preparation and packaging checks must run in order without sharding')
    assignments, totals = [[] for _ in range(count)], [0] * count
    for index, check in sorted(enumerate(selected), key=lambda item: (-item[1].seconds, item[0])):
        shard = min(range(count), key=lambda i: (totals[i], i))
        assignments[shard].append((index, check))
        totals[shard] += check.seconds
    return [[check for _, check in sorted(group)] for group in assignments]


def git_output(*args):
    try:
        return subprocess.check_output(['git', *args], cwd=ROOT, text=True,
                                       stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def run(selected, report_path, metadata):
    report_path.parent.mkdir(parents=True, exist_ok=True)
    logs = report_path.with_suffix('')
    logs.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env['PYTHONPATH'] = os.pathsep.join(filter(None, [str(ROOT / 'src'), env.get('PYTHONPATH')]))
    env.setdefault('POCKET_PYTHON_RUNTIME', str(ROOT / 'build/runtime'))
    report = {
        'schema_version': 1, 'revision': git_output('rev-parse', 'HEAD'),
        'working_tree_modified': bool(git_output('status', '--porcelain')),
        'started_at': datetime.now(UTC).isoformat(), **metadata, 'checks': [],
    }
    try:
        for check in selected:
            command = [sys.executable if arg == 'python' and i == 0 else arg
                       for i, arg in enumerate(check.command)]
            log = logs / (check.id + '.log')
            print(f'[{check.id}] {shlex.join(command)}', flush=True)
            start = time.monotonic()
            with log.open('w', encoding='utf-8') as output:
                try:
                    code = subprocess.run(command, cwd=ROOT, env=env, stdout=output,
                                          stderr=subprocess.STDOUT).returncode
                except OSError as error:
                    output.write(str(error) + '\n')
                    code = 127
            elapsed = round(time.monotonic() - start, 3)
            report['checks'].append({'id': check.id, 'command': command, 'returncode': code,
                                     'seconds': elapsed, 'log': str(log)})
            print(f'[{check.id}] {"PASS" if code == 0 else "FAIL"} ({elapsed:.1f}s)', flush=True)
            if code:
                print('\n'.join(log.read_text(encoding='utf-8', errors='replace').splitlines()[-30:]), flush=True)
    finally:
        report['summary'] = {
            'pass': sum(row['returncode'] == 0 for row in report['checks']),
            'fail': sum(row['returncode'] != 0 for row in report['checks']),
            'selected': len(selected),
            'seconds': round(sum(row['seconds'] for row in report['checks']), 3),
        }
        report_path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Report: {report_path} {report["summary"]}', flush=True)
    return int(report['summary']['fail'] != 0)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('suites', nargs='+', choices=SUITES)
    parser.add_argument('--feature', action='append', default=[], help='Select matching check IDs (repeatable)')
    parser.add_argument('--shard', type=int, default=1, help='One-based shard index')
    parser.add_argument('--shards', type=int, default=1)
    parser.add_argument('--list', '--dry-run', action='store_true', dest='list_only')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args(argv)
    if not 1 <= args.shard <= args.shards:
        parser.error('--shard must be between 1 and --shards')
    selected = select_checks(args.suites, args.feature)
    if not selected:
        parser.error('No checks match the selected suites/features')
    try:
        selected = shards(selected, args.shards)[args.shard - 1]
    except ValueError as error:
        parser.error(str(error))
    if args.list_only:
        for check in selected:
            print(f'{check.id}: {shlex.join(check.command)}')
        print(f'{len(selected)} checks; estimated {sum(check.seconds for check in selected):.0f}s')
        return 0
    name = '-'.join(args.suites) + f'-{args.shard}-of-{args.shards}'
    report = args.report or ROOT / f'build/test-results/{name}.json'
    return run(selected, report, {'suites': args.suites, 'features': args.feature,
                                  'shard': args.shard, 'shards': args.shards})


if __name__ == '__main__':
    raise SystemExit(main())
