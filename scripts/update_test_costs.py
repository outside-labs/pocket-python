"""Build deterministic shard costs from successful validation runner reports."""

import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.test_manifest import checks


def build_inventory(paths, source, known_ids=None):
    known_ids = {check.id for check in checks()} if known_ids is None else set(known_ids)
    files = sorted({file for path in paths for file in
                    (path.rglob('*-of-*.json') if path.is_dir() else [path])})
    samples, sources, seen = defaultdict(list), [], set()
    for path in files:
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest in seen:
            continue
        seen.add(digest)
        report = json.loads(raw)
        rows, summary = report['checks'], report['summary']
        if (report['schema_version'] != 1 or summary['fail'] != 0 or
                summary['pass'] != len(rows) or summary['selected'] != len(rows) or not rows):
            raise ValueError(f'{path}: requires a complete successful runner report')
        ids = set()
        for row in rows:
            seconds = row['seconds']
            if (row['returncode'] != 0 or row['id'] in ids or
                    isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or
                    not math.isfinite(seconds) or seconds < 0):
                raise ValueError(f'{path}: invalid or failed timing sample')
            ids.add(row['id'])
            if row['id'] in known_ids:
                samples[row['id']].append(max(0.001, seconds))
        sources.append({'sha256': digest, 'revision': report['revision'],
                        **{key: report[key] for key in ('suites', 'shard', 'shards', 'host') if key in report}})
    if not samples:
        raise ValueError('No timings match the current validation inventory')
    return {'schema_version': 1, 'source': source, 'reports': sources,
            'seconds': {id: round(statistics.median(values), 3) for id, values in sorted(samples.items())}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reports', nargs='+', type=Path, help='Runner JSON files or artifact directories')
    parser.add_argument('--source', required=True, help='Workflow run URL or measurement provenance')
    parser.add_argument('--output', type=Path, default=ROOT / 'scripts/test_costs.json')
    args = parser.parse_args(argv)
    try:
        inventory = build_inventory(args.reports, args.source)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(inventory, indent=2) + '\n', encoding='utf-8')
    print(f'{len(inventory["seconds"])} measured costs from {len(inventory["reports"])} reports: {args.output}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
