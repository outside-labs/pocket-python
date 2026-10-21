import copy
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

from pocket_python.assets import ArtifactError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
SPEC = importlib.util.spec_from_file_location('interpreter_measurements', ROOT / 'scripts/interpreter_measurements.py')
MEASURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MEASURE)


class InterpreterMeasurementTests(unittest.TestCase):
    def test_common_program_matches_the_canonical_cpython_computation(self):
        program = MEASURE.workload()
        self.assertEqual(program['expected_stdout'], '0 0 0\n14 4 2\n3 1 1\n')
        self.assertEqual(program['computation_sha256'], 'cd0fc16e047b4c81230a1272446b0257ef741f937b1ea0857d2a94bb3d0bb350')
        self.assertEqual(hashlib.sha256(program['source'].encode()).hexdigest(), program['source_sha256'])

    def test_full_reduced_payload_buckets_and_archives_describe_all_verified_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            rows = MEASURE.prepare(root, MEASURE.workload())
            results = []
            for row in rows:
                sizes, records, archive = MEASURE.payload(row['directory'], row['receipt'])
                self.assertEqual(sum(sizes[key] for key in MEASURE.BUCKETS), sizes['complete_payload_bytes'])
                self.assertEqual(sizes['complete_payload_bytes'], row['receipt']['size']['artifact_bytes'])
                self.assertEqual(sum(record['gzip_bytes'] for record in records), sizes['gzip_file_transfer_bytes'])
                self.assertEqual(hashlib.sha256(archive).hexdigest(), sizes['gzip_tar_sha256'])
                with tarfile.open(fileobj=io.BytesIO(gzip.decompress(archive)), mode='r:') as package:
                    self.assertEqual({item.name for item in package.getmembers()}, {item['path'] for item in records})
                    for item in package.getmembers():
                        self.assertEqual(item.mtime, 0)
                        self.assertEqual(item.mode, 0o644)
                        self.assertEqual(package.extractfile(item).read(), (row['directory'] / item.name).read_bytes())
                self.assertEqual((sizes, records, archive), MEASURE.payload(row['directory'], row['receipt']))
                results.append(sizes)
            core, full = results
            self.assertEqual(core['engine_bytes'], full['engine_bytes'])
            self.assertEqual(core['bridge_bytes'], full['bridge_bytes'])
            self.assertEqual(core['library_bytes'], 0)
            self.assertGreater(full['library_bytes'], 0)
            self.assertGreater(full['complete_payload_bytes'], core['complete_payload_bytes'])
            self.assertGreater(core['bridge_bytes'], 0)

    def test_changed_missing_extra_or_unsupported_payloads_are_not_measured(self):
        for change in ['extra', 'changed', 'missing', 'receipt', 'role']:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temporary:
                row = MEASURE.prepare(Path(temporary), MEASURE.workload())[0]
                receipt = copy.deepcopy(row['receipt'])
                path = row['directory'] / receipt['entrypoint']['path']
                if change == 'extra':
                    (row['directory'] / 'private.py').write_bytes(b'unselected fixture')
                elif change == 'changed':
                    path.write_bytes(b'changed')
                elif change == 'missing':
                    path.unlink()
                elif change == 'receipt':
                    (row['directory'] / 'POCKET-PYTHON.json').write_text('{}')
                else:
                    receipt['files'][0]['role'] = 'unknown'
                    (row['directory'] / 'POCKET-PYTHON.json').write_bytes(MEASURE.json_bytes(receipt))
                with self.assertRaises(ArtifactError):
                    MEASURE.payload(row['directory'], receipt)

    def test_explicit_micropython_source_fixture_is_validated_without_running_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            program = MEASURE.workload()
            bundle = MEASURE.source_bundle(Path(temporary) / 'bundle', program['source'])
            self.assertEqual(bundle.files['_sources/app.py'], program['source'].encode())
            self.assertEqual(bundle.manifest['stdlib_modules'], [])
            self.assertEqual(bundle.manifest['distributions'], [])
            self.assertTrue(bundle.files['LICENSES/source.txt'].strip())

    def test_invalid_sample_counts_and_existing_outputs_fail_before_observation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for repeats in [True, 0, 2, 32, 3.0]:
                with self.subTest(repeats=repeats), self.assertRaisesRegex(ValueError, '3–31'):
                    MEASURE.measure(root / 'new', repeats=repeats, browser=False)
            (root / 'keep').write_bytes(b'keep')
            with self.assertRaisesRegex(ValueError, 'new measurement'):
                MEASURE.measure(root, browser=False)
            self.assertEqual((root / 'keep').read_bytes(), b'keep')
