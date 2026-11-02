import json
from pathlib import Path
import tempfile
import unittest

from scripts.update_test_costs import build_inventory
from scripts.test_manifest import checks, measured_costs
from scripts.run_tests import shards


class TestCostInventoryTests(unittest.TestCase):
    def test_measured_costs_control_balancing_without_changing_coverage_or_order(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'costs.json'
            fallback = checks(path)
            selected = [check for check in fallback if check.suite == 'browser-conformance']
            expensive = selected[0].id
            path.write_text(json.dumps({'schema_version': 1, 'seconds': {expensive: 10000}}), encoding='utf-8')
            measured = checks(path)
            self.assertEqual([check.id for check in fallback], [check.id for check in measured])
            self.assertEqual([check.command for check in fallback], [check.command for check in measured])
            self.assertEqual(measured[0].seconds, fallback[0].seconds)
            selected = [check for check in measured if check.suite == 'browser-conformance']
            self.assertEqual(selected[0].seconds, 10000)
            groups = shards(selected, 6)
            self.assertEqual([check.id for check in groups[0]], [expensive])
            self.assertCountEqual([check.id for group in groups for check in group], [check.id for check in selected])
            self.assertEqual(groups, shards(selected, 6))
            for invalid in (0, -1, float('nan'), float('inf'), True, 'slow'):
                path.write_text(json.dumps({'schema_version': 1, 'seconds': {'known': invalid}}), encoding='utf-8')
                with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                    measured_costs(path)

    def report(self, seconds=10):
        return {'schema_version': 1, 'revision': 'a' * 40, 'suites': ['browser-conformance'],
                'shard': 1, 'shards': 6,
                'checks': [{'id': 'known', 'seconds': seconds, 'returncode': 0}],
                'summary': {'pass': 1, 'fail': 0, 'selected': 1}}

    def test_medians_provenance_deduplication_and_stale_ids(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, seconds in [('one', 10), ('two', 20), ('duplicate', 20), ('three', 30)]:
                (root / f'{name}-1-of-1.json').write_text(json.dumps(self.report(seconds)), encoding='utf-8')
            stale = self.report(1000)
            stale['checks'][0]['id'] = 'removed'
            (root / 'stale-1-of-1.json').write_text(json.dumps(stale), encoding='utf-8')
            observed = build_inventory([root], 'workflow-url', ['known'])
            self.assertEqual(observed['seconds'], {'known': 20})
            self.assertEqual(len(observed['reports']), 4)
            self.assertEqual(observed['source'], 'workflow-url')
            self.assertEqual(observed, build_inventory([root, root], 'workflow-url', ['known']))
            self.assertTrue(all(row['revision'] == 'a' * 40 for row in observed['reports']))

    def test_incomplete_failed_duplicate_and_invalid_samples_are_rejected(self):
        reports = []
        for seconds in (-1, float('nan'), float('inf'), True, '10'):
            reports.append(self.report(seconds))
        failed = self.report()
        failed['checks'][0]['returncode'] = 1
        reports.append(failed)
        partial = self.report()
        partial['summary']['selected'] = 2
        reports.append(partial)
        failed_summary = self.report()
        failed_summary['summary']['fail'] = 1
        reports.append(failed_summary)
        duplicate = self.report()
        duplicate['checks'] *= 2
        duplicate['summary']['pass'] = duplicate['summary']['selected'] = 2
        reports.append(duplicate)
        for report in reports:
            with self.subTest(report=report), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / 'report.json'
                path.write_text(json.dumps(report), encoding='utf-8')
                with self.assertRaises(ValueError):
                    build_inventory([path], 'workflow-url', ['known'])

    def test_zero_duration_is_positive_and_unknown_inventory_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'report.json'
            path.write_text(json.dumps(self.report(0)), encoding='utf-8')
            self.assertEqual(build_inventory([path], 'local', ['known'])['seconds'], {'known': 0.001})
            with self.assertRaisesRegex(ValueError, 'No timings'):
                build_inventory([path], 'local', ['new'])
