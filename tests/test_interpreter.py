from dataclasses import replace
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from pocket_python._interpreter_lock import ENGINE_FILES, ENGINE_FINGERPRINT
from pocket_python.assets import ArtifactError, json_bytes
from pocket_python.cli import main
from pocket_python.interpreter import build_interpreter, read_console_source, read_interpreter


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('console_example', ROOT / 'examples/interpreter_console.py')
EXAMPLE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXAMPLE)


class InterpreterTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = EXAMPLE.write_source(self.root / 'client')
        self.engine = read_interpreter(ROOT / 'runtime')
        self.output = self.root / 'console'

    def test_exact_engine_source_notice_and_local_dependency_closure(self):
        with patch('subprocess.run', side_effect=AssertionError('Assembly must not execute application code')):
            receipt = build_interpreter(self.source, self.engine, self.output, title='<Python & source>')
        self.assertEqual(receipt, build_interpreter(self.source, self.engine, self.root / 'second', title='<Python & source>'))
        self.assertEqual(receipt['schema_version'], 2)
        self.assertEqual(receipt['profile'], 'in-house-interpreter')
        self.assertEqual(receipt['engine']['fingerprint'], ENGINE_FINGERPRINT)
        self.assertEqual(receipt['engine']['bytecode_version'], 4)
        self.assertTrue(receipt['source_execution'])
        files = {record['path'] for record in receipt['files']}
        for record in receipt['files']:
            data = (self.output / record['path']).read_bytes()
            self.assertEqual(record['size_bytes'], len(data))
            self.assertEqual(record['sha256'], hashlib.sha256(data).hexdigest())
        self.assertEqual(files | {'POCKET-PYTHON.json'}, {path.relative_to(self.output).as_posix() for path in self.output.rglob('*') if path.is_file()})
        self.assertEqual((self.output / receipt['entrypoint']['path']).read_bytes(), EXAMPLE.SOURCE.encode())
        self.assertEqual(len([name for name in files if name.startswith('engine/')]), len(ENGINE_FILES))
        for edge in receipt['imports']:
            self.assertIn(edge['from'], files)
            self.assertIn(edge['to'], files)
        for path in receipt['licenses']:
            self.assertTrue((self.output / path).read_bytes().strip())
        for name in ['POCKET-PYTHON', 'UNICODE']:
            self.assertTrue(any(path.endswith('/licenses/' + name + '.txt') for path in receipt['licenses']))
        self.assertFalse(any(path.endswith('.wasm') or path.endswith('source-runner.mjs') or 'pyodide' in path for path in files))
        size = receipt['size']
        self.assertEqual(size['artifact_bytes'], sum(path.stat().st_size for path in self.output.rglob('*') if path.is_file()))
        self.assertEqual(size['artifact_bytes'], sum(size[key] for key in ['source_bytes', 'engine_bytes', 'notice_bytes', 'data_bytes', 'assembly_module_bytes', 'receipt_bytes']))
        page = (self.output / 'index.html').read_text(encoding='utf-8')
        self.assertIn('&lt;Python &amp; source&gt;', page)
        self.assertIn("script-src 'self'", page)
        worker = (self.output / 'service-worker.js').read_text(encoding='utf-8')
        self.assertIn("integrity:'sha256-'", worker)
        self.assertNotIn('skipWaiting', worker)
        self.assertNotIn('https://', (self.output / receipt['launcher']).read_text())

    def test_engine_pin_refuses_changed_files_and_immutable_snapshot_forgery(self):
        root = self.root / 'engine'
        for name, data in self.engine.files:
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        known = read_interpreter(root)
        (root / 'source-compiler.mjs').write_bytes(b'// changed implementation')
        with self.assertRaisesRegex(ArtifactError, 'pinned build'):
            read_interpreter(root)
        build_interpreter(self.source, known, self.output)
        first, _ = known.files[0]
        forged = replace(known, files=tuple((name, b'changed' if name == first else data) for name, data in known.files))
        with self.assertRaisesRegex(ArtifactError, 'pinned build'):
            build_interpreter(self.source, forged, self.root / 'forged')
        with self.assertRaisesRegex(ArtifactError, 'file set'):
            build_interpreter(self.source, replace(known, files=known.files[:-1]), self.root / 'missing')

    def test_engine_checkout_crlf_is_canonical_and_unselected_files_stay_private(self):
        root = self.root / 'engine'
        for name, data in self.engine.files:
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data.replace(b'\n', b'\r\n'))
        (root / 'unselected.mjs').write_bytes(b'PRIVATE_ENGINE_CANARY')
        (self.source.root / 'server.py').write_bytes(b'PRIVATE_SERVER_CANARY')
        receipt = build_interpreter(self.source, read_interpreter(root), self.output)
        self.assertEqual(receipt['engine']['fingerprint'], ENGINE_FINGERPRINT)
        for path in self.output.rglob('*'):
            if path.is_file():
                self.assertNotIn(b'PRIVATE_ENGINE_CANARY', path.read_bytes())
                self.assertNotIn(b'PRIVATE_SERVER_CANARY', path.read_bytes())

    def test_manifest_boundary_duplicate_fields_versions_paths_and_input_bounds(self):
        path = self.source.root / 'CONSOLE-SOURCE.json'
        original = json.loads(self.source.manifest_bytes)
        for change in [{'target': 'server'}, {'schema_version': True}, {'profile': 'pyodide'}, {'source': []}, {'notice': None}]:
            path.write_bytes(json_bytes({**original, **change}))
            with self.subTest(change=change), self.assertRaises(ArtifactError):
                read_console_source(path)
        for key, field, value in [('source', 'role', 'server-source'), ('source', 'path', '../private.py'),
                                  ('source', 'path', '/private.py'), ('source', 'path', 'x#y.py'),
                                  ('source', 'size_bytes', 65537), ('notice', 'size_bytes', 0),
                                  ('source', 'size_bytes', True), ('notice', 'path', 'notice.txt')]:
            value_manifest = json.loads(self.source.manifest_bytes)
            value_manifest[key][field] = value
            path.write_bytes(json_bytes(value_manifest))
            with self.subTest(field=field, value=value), self.assertRaises(ArtifactError):
                read_console_source(path)
        path.write_bytes(self.source.manifest_bytes.replace(b'"target": "client"', b'"target": "client", "target": "client"'))
        with self.assertRaisesRegex(ArtifactError, 'Duplicate'):
            read_console_source(path)

    def test_tampered_source_and_input_symlinks_fail_before_publication(self):
        path = self.source.root / 'app.py'
        path.write_bytes(b'changed')
        with self.assertRaisesRegex(ArtifactError, 'hash/size'):
            read_console_source(self.source.root / 'CONSOLE-SOURCE.json')
        build_interpreter(self.source, self.engine, self.output)
        forged = replace(self.source, files=(('app.py', b'changed'), self.source.files[1]))
        with self.assertRaises(ArtifactError):
            build_interpreter(forged, self.engine, self.root / 'forged')
        path.unlink()
        try:
            path.symlink_to(self.source.root / 'CONSOLE-SOURCE.json')
        except (OSError, NotImplementedError):
            pass
        else:
            with self.assertRaisesRegex(ArtifactError, 'Symlink'):
                read_console_source(self.source.root / 'CONSOLE-SOURCE.json')

    def test_empty_source_and_utf8_notice_are_explicit_without_build_time_execution(self):
        empty = EXAMPLE.write_source(self.root / 'empty', source='')
        receipt = build_interpreter(empty, self.engine, self.output)
        self.assertEqual(receipt['size']['source_bytes'], 0)
        for data, field in [(b'\xff', 'source'), (b'\xef\xbb\xbfpass', 'source'), (b'   ', 'notice')]:
            manifest = json.loads(self.source.manifest_bytes)
            target = manifest[field]['path']
            manifest[field].update(size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
            entries = tuple((name, data if name == target else content) for name, content in self.source.files)
            with self.subTest(data=data), self.assertRaises(ArtifactError):
                build_interpreter(replace(self.source, manifest_bytes=json_bytes(manifest), files=entries), self.engine, self.root / 'bad-encoding')

    def test_output_exclusivity_overlap_rollback_and_cli(self):
        with self.assertRaisesRegex(ArtifactError, 'overlaps'):
            build_interpreter(self.source, self.engine, self.source.root / 'output')
        with patch('pocket_python.web.os.link', side_effect=OSError('fixture publication failure')):
            with self.assertRaises(OSError):
                build_interpreter(self.source, self.engine, self.output)
        self.assertFalse(self.output.exists())
        self.assertEqual(main(['interpreter-web', str(self.source.root / 'CONSOLE-SOURCE.json'), '--engine', str(ROOT / 'runtime'), '--output', str(self.output)]), 0)
        with self.assertRaisesRegex(ArtifactError, 'already exists'):
            build_interpreter(self.source, self.engine, self.output)
        with patch('pocket_python.interpreter.__version__', 'fixture-next'):
            updated = build_interpreter(self.source, self.engine, self.root / 'updated')
        current = json.loads((self.output / 'POCKET-PYTHON.json').read_bytes())
        self.assertNotEqual(current['cache_version'], updated['cache_version'])
