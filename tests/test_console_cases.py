import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.console_cases import program_expectations, reference_stdout


class ConsoleCasesTests(unittest.TestCase):
    def test_bulk_expectations_reuse_adopted_cases_and_reference_only_new_examples(self):
        corpus = {'implemented_stages': ['C1'], 'cases': [
            {'source': 'adopted', 'stage': 'C1', 'stdout': '7\n'},
            {'source': 'later', 'stage': 'Future', 'stdout': 'future\n'},
            {'source': 'error', 'stage': 'C1', 'stdout': 'prefix\n', 'error_type': 'ValueError'},
            {'source': 'module', 'stage': 'C1', 'stdout': 'module\n', 'modules': [{'name': 'app'}]},
        ]}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'one.json').write_text(json.dumps(corpus), encoding='utf-8')
            with patch('scripts.console_cases.reference_stdout', side_effect=lambda source: source + '\n') as oracle:
                observed = program_expectations(['adopted', 'new', 'later', 'error', 'module', 'adopted'], root)
            self.assertEqual(observed, ['7\n', 'new\n', 'later\n', 'error\n', 'module\n', '7\n'])
            self.assertEqual([call.args[0] for call in oracle.call_args_list], ['new', 'later', 'error', 'module'])
            (root / 'two.json').write_text(json.dumps({'implemented_stages': ['C1'], 'cases': [
                {'source': 'adopted', 'stage': 'C1', 'stdout': 'different'}]}), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Conflicting'):
                program_expectations(['adopted'], root)

    def test_examples_run_isolated_cpython_only_once_per_source(self):
        reference_stdout.cache_clear()
        try:
            with patch('scripts.console_cases.subprocess.check_output', return_value='7\n') as oracle:
                self.assertEqual(reference_stdout('print(7)'), '7\n')
                self.assertEqual(reference_stdout('print(7)'), '7\n')
                oracle.assert_called_once()
                self.assertIn('-I', oracle.call_args.args[0])
                self.assertEqual(oracle.call_args.kwargs['timeout'], 5)
        finally:
            reference_stdout.cache_clear()
