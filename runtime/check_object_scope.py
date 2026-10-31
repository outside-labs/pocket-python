"""Audit O-series scope, source refusals and the native ownership tables."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'docs/interpreter-object-scope.json'


def refusal_sites(root):
    sites = set()
    for path in (root / 'runtime').glob('*.mjs'):
        if path.name.endswith('.test.mjs'):
            continue
        for line in path.read_text(encoding='utf-8').splitlines():
            if 'UNSUPPORTED' in line or '.unsupported(' in line:
                sites.add((path.relative_to(root).as_posix(), line.strip()))
    return sites


def audit(root=ROOT):
    manifest = json.loads((root / MANIFEST.relative_to(ROOT)).read_bytes())
    assert manifest['reference_version'] == '3.14.7'
    allowed = {'#' + str(n) for n in manifest['neighbor_issues']} | set(manifest['boundaries'])
    corpora, boundaries, stages = {}, set(), set()
    for path in (root / 'tests/fixtures/interpreter').glob('*.json'):
        corpus = json.loads(path.read_bytes())
        if not any(re.fullmatch(r'O\d+', s) for s in corpus.get('implemented_stages', [])):
            continue
        relative = path.relative_to(root).as_posix()
        corpora[relative] = corpus
        stages.update(corpus['implemented_stages'])
        assert 'Future' not in corpus['implemented_stages'], relative
        for case in corpus['cases']:
            if case['stage'] not in corpus['implemented_stages']:
                assert case.get('owner') in allowed and case.get('boundary'), (relative, case['id'])
                boundaries.add((relative, case['id'], case['owner'], case['boundary']))
    assert set(corpora) == set(manifest['source_corpora']), 'O-corpus inventory drift'
    expected = {(row['corpus'], row['case'], row['owner'], row['boundary']) for row in manifest['boundary_cases']}
    assert boundaries == expected, 'Unreconciled O-corpus boundary'
    assert {f'O{n}' for n in range(1, 96)} <= stages, 'Missing delivered stage evidence'
    recorded = manifest['source_refusals']
    assert all(row['owner'] in allowed and row['boundary'] for row in recorded)
    assert refusal_sites(root) == {(r['path'], r['site']) for r in recorded}, 'Unreviewed source refusal'
    inventory = json.loads((root / 'docs/interpreter-compatibility.json').read_bytes())
    probes = {c['id']: c for c in json.loads((root / 'tests/fixtures/interpreter/compatibility.json').read_bytes())['cases']}
    for row in inventory['features'] + inventory['builtins']:
        assert 'INT-OBJECT-01' not in row['next_tasks'], row['id']
        for item in row.get('evidence', []):
            path, id = item.split(':', 1)
            if path not in corpora:
                continue
            case = next(c for c in corpora[path]['cases'] if c['id'] == id)
            assert case['stage'] in corpora[path]['implemented_stages'], ('Refusal earns no support credit', item)
        for item in row.get('boundary_evidence', []):
            path, id = item.split(':', 1)
            corpus = json.loads((root / path).read_bytes())
            case = next(c for c in corpus['cases'] if c['id'] == id)
            assert case['stage'] not in corpus['implemented_stages'], ('Stale boundary evidence', item)
        if row['status'] == 'supported':
            assert row.get('evidence') or any(probes[p]['classification'] == 'supported' for p in row['probes']), row['id']
    native = json.loads(subprocess.check_output(['node', 'scripts/object_scope_native.mjs'], cwd=root, text=True))
    layouts = json.loads((root / manifest['native_tables']['layouts']).read_bytes())
    assert set(native['types']) == {row['type'] for row in layouts['native_types']}, 'Missing native layout'
    native_cases = {case['id'] for case in corpora['tests/fixtures/interpreter/native-directory-closure.json']['cases']}
    for row in layouts['native_types']:
        assert row['type_case'] in native_cases, row['type']
        boundary = row.get('instance_boundary')
        assert row.get('instance_case') in native_cases or boundary and boundary['case'] in native_cases and boundary['owner'] in allowed, row['type']
    assert all(entry['owner'] for entry in native['entries'])
    return {'schema_version': 1, 'suite': manifest['suite'], 'reference_version': '3.14.7',
            'manifest_sha256': hashlib.sha256((root / MANIFEST.relative_to(ROOT)).read_bytes()).hexdigest(),
            'scope': manifest['support_credit'], 'native_ownership': native,
            'summary': {'source_corpora': len(corpora), 'boundary_cases': len(boundaries),
                        'source_refusal_sites': len(recorded), 'native_types': len(native['types']),
                        'native_namespace_entries': len(native['entries']), 'slot_names': len(native['slots']),
                        'inventory_rows': len(inventory['features']) + len(inventory['builtins'])}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = audit()
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report['summary']))
