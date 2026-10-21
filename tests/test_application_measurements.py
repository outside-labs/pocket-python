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

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
SPEC = importlib.util.spec_from_file_location('application_measurements',ROOT/'scripts/measure_applications.py')
MEASURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MEASURE)


def component_fixture():
    source_hash=hashlib.sha256(MEASURE.shared.computation_bytes()).hexdigest()
    return {'kind':'python-javascript-compiler-measurements','schema_version':1,'suite':'compiler-footprint/1',
            'compiler_source_sha256':MEASURE.installed_compiler_hashes(),'compiler_version':'fixture',
            'python':'fixture','node':'fixture','host':{'system':'fixture'},'methods':{'scope':'synthetic component fixture'},
            'helper_conformance':{'node':'pass','browser':'pass'},'browser':{'version':'fixture','playwright_version':'fixture'},
            'applications':[{'fixture':'text-metrics','variant':variant,'language_profile':'python-browser-modules/1',
                             'sources':[{'path':'text_metrics.py','sha256':source_hash}],
                             'sizes':{'input_source_bytes':581,'complete_payload_bytes':1000,'gzip_file_transfer_bytes':500},
                             'browser':{'fixture':True}}
                            for variant in ['required-maps','required-no-maps','all-profile-maps','all-profile-no-maps']]}


class ApplicationMeasurementTests(unittest.TestCase):
    def test_component_schema_source_identity_and_recorded_conformance_are_required(self):
        original=component_fixture()
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'component.json'
            path.write_text(json.dumps(original),encoding='utf-8')
            loaded,data=MEASURE.read_component_report(path)
            self.assertEqual(loaded,original)
            self.assertEqual(json.loads(data),original)
            changes=[]
            altered=copy.deepcopy(original);altered['schema_version']=2;changes.append(altered)
            altered=copy.deepcopy(original);altered['compiler_source_sha256']={};changes.append(altered)
            altered=copy.deepcopy(original);altered['helper_conformance']['browser']='not-run';changes.append(altered)
            altered=copy.deepcopy(original);altered['applications'][0]['sources'][0]['sha256']='0'*64;changes.append(altered)
            altered=copy.deepcopy(original);altered['applications'][0]['sizes']['complete_payload_bytes']=-1;changes.append(altered)
            altered=copy.deepcopy(original);altered['browser']=None;changes.append(altered)
            for altered in changes:
                with self.subTest(altered=altered),self.assertRaises(ValueError):
                    path.write_text(json.dumps(altered),encoding='utf-8')
                    MEASURE.read_component_report(path)

    def test_complete_pwa_buckets_and_maps_share_behavior_without_missing_payload(self):
        with tempfile.TemporaryDirectory() as temporary:
            rows=MEASURE.prepare(Path(temporary),3)
            self.assertEqual({row['id'] for row,_,_ in rows},{'compiled-maps','compiled-no-maps'})
            for row,directory,archive in rows:
                counts=row['sizes']
                self.assertEqual(sum(counts[key] for key in MEASURE.BUCKETS),counts['complete_payload_bytes'])
                self.assertEqual(counts['complete_payload_bytes'],sum(path.stat().st_size for path in directory.rglob('*') if path.is_file()))
                self.assertEqual(counts['gzip_file_transfer_bytes'],sum(record['gzip_bytes'] for record in row['files']))
                self.assertEqual(counts['application_source_bytes'],0)
                self.assertEqual(counts['interpreter_asset_bytes'],0)
                self.assertIsNone(row['engine'])
                self.assertFalse(row['new_source_after_deployment'])
                self.assertEqual(row['source_map'],counts['source_map_bytes']>0)
                self.assertEqual(len(row['build_ns']),3)
                self.assertEqual(len(gzip.decompress(archive)),counts['canonical_tar_bytes'])
                self.assertEqual(hashlib.sha256(archive).hexdigest(),counts['gzip_tar_sha256'])
                with tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz') as packed:
                    for record in row['files']:
                        self.assertEqual(packed.extractfile(record['path']).read(),(directory/record['path']).read_bytes())
            row,directory,_=rows[0]
            receipt=json.loads((directory/'POCKET-PYTHON.json').read_bytes())
            extra=directory/'unlisted.txt';extra.write_bytes(b'not selected')
            with self.assertRaisesRegex(ValueError,'undeclared'):
                MEASURE.payload(directory,receipt)
            extra.unlink()
            launcher=directory/receipt['launcher'];launcher.write_bytes(launcher.read_bytes()+b'\n')
            with self.assertRaises(ValueError):
                MEASURE.payload(directory,receipt)

    def test_unavailable_inputs_and_existing_outputs_do_not_become_measurements(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            marker=root/'keep';marker.write_bytes(b'keep')
            with self.assertRaisesRegex(ValueError,'new measurement output'):
                MEASURE.measure(root,root/'missing.json')
            self.assertEqual(marker.read_bytes(),b'keep')
            for repeats in [True,2,32]:
                with self.subTest(repeats=repeats),self.assertRaises(ValueError):
                    MEASURE.measure(root/'new',root/'missing.json',repeats=repeats)
