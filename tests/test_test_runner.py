import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

from scripts import run_tests
from scripts.test_manifest import Check, CORPORA, checks


class TestRunnerTests(unittest.TestCase):
    def test_focused_selection_contains_only_matching_node_checks(self):
        selected = run_tests.select_checks(['focused'], ['native-descriptors'])
        self.assertEqual(len(selected), 4)  # Unit plus drain/step/parked conformance.
        self.assertTrue(all('native-descriptors' in check.id for check in selected))
        self.assertEqual({check.suite for check in selected}, {'node-unit', 'node-conformance'})

    def test_shards_are_complete_disjoint_balanced_and_deterministic(self):
        for suite, count in [('interpreter', 4), ('browser-conformance', 4), ('browser-integration', 3)]:
            with self.subTest(suite=suite):
                selected = run_tests.select_checks([suite])
                groups = run_tests.shards(selected, count)
                flattened = [check.id for group in groups for check in group]
                self.assertCountEqual(flattened, [check.id for check in selected])
                self.assertEqual(len(flattened), len(set(flattened)))
                self.assertEqual(groups, run_tests.shards(selected, count))
                totals = [sum(check.seconds for check in group) for group in groups]
                self.assertLessEqual(max(totals) - min(totals), max(check.seconds for check in selected))

    def test_manifest_covers_every_node_file_and_source_matrix(self):
        inventory = checks()
        self.assertEqual(len({check.id for check in inventory}), len(inventory))
        self.assertEqual({check.command[-1] for check in inventory if check.suite == 'node-unit'},
                         {path.relative_to(run_tests.ROOT).as_posix()
                          for path in (run_tests.ROOT / 'runtime').glob('*.test.mjs')})
        for target in ('node', 'browser'):
            for corpus in CORPORA:
                self.assertIn(f'{corpus}-classes-drain-{target}', {check.id for check in inventory})
                self.assertIn(f'{corpus}-classes-stepped-{target}', {check.id for check in inventory})
        self.assertEqual(run_tests.select_checks(['full', 'focused']), run_tests.select_checks(['full']))

    def test_packaging_order_survives_unsharded_selection(self):
        for suite in ('python', 'smoke'):
            selected = run_tests.select_checks([suite])
            self.assertEqual(run_tests.shards(selected, 1), [selected])
            with self.assertRaisesRegex(ValueError, 'without sharding'):
                run_tests.shards(selected, 2)

    def test_pr_retains_regressions_while_full_adds_reference_and_measurements(self):
        pr = run_tests.select_checks(['pr'])
        exhaustive = run_tests.select_checks(['full'])
        self.assertTrue({check.id for check in pr} < {check.id for check in exhaustive})
        self.assertFalse({'reference', 'measurements'} & {check.suite for check in pr})
        self.assertTrue({'node-unit', 'node-conformance', 'browser-conformance',
                         'browser-integration', 'python'} <= {check.suite for check in pr})

    def test_failure_is_reported_and_does_not_hide_later_results(self):
        selected = [Check('fails', 'unit', ('python', '-c', 'print("failure detail"); raise SystemExit(3)')),
                    Check('passes', 'unit', ('python', '-c', 'print("next check")')),
                    Check('missing', 'unit', ('/missing-test-program',))]
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()) as output:
            report_path = Path(directory) / 'report.json'
            code = run_tests.run(selected, report_path, {'suites': ['unit']})
            report = json.loads(report_path.read_text())
            self.assertEqual(code, 1)
            self.assertEqual(report['summary']['pass'], 1)
            self.assertEqual(report['summary']['fail'], 2)
            self.assertEqual(report['summary']['selected'], 3)
            self.assertEqual([row['returncode'] for row in report['checks']], [3, 0, 127])
            self.assertEqual(report['checks'][0]['command'][0], sys.executable)
            self.assertTrue(all(Path(row['log']).exists() for row in report['checks']))
            self.assertIn('failure detail', output.getvalue())
            self.assertIn('revision', report)

    def test_cli_rejects_empty_selection_and_invalid_shard(self):
        with contextlib.redirect_stderr(io.StringIO()):
            for args in (['focused', '--feature', 'no-such-feature'],
                         ['focused', '--shard', '0'], ['focused', '--shards', '0']):
                with self.subTest(args=args), self.assertRaises(SystemExit) as error:
                    run_tests.main(args)
                self.assertEqual(error.exception.code, 2)

    def test_list_does_not_execute_checks(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(run_tests.main(['focused', '--feature', 'native-descriptors', '--list']), 0)
        self.assertIn('4 checks', output.getvalue())
