from dataclasses import replace
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from pocket_python.assets import ArtifactError, json_bytes
from pocket_python.cli import main
from pocket_python.compiled import build_compiled, compile_client, read_client, read_compiled


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('compiled_example', ROOT / 'examples/compiled_text_metrics.py')
EXAMPLE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXAMPLE)


@unittest.skipUnless(importlib.util.find_spec('JavaScript'), 'Install the declared compiled-build group.')
class CompiledTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.client = EXAMPLE.write_client(self.root / 'client')
        self.output = self.root / 'web'

    def test_profile_complete_closure_notices_and_determinism(self):
        receipt = build_compiled(self.client, self.output, title='<Metrics & text>')
        self.assertEqual(receipt, build_compiled(self.client, self.root / 'second', title='<Metrics & text>'))
        self.assertEqual(receipt['schema_version'], 2)
        self.assertEqual(receipt['profile'], 'compiled-javascript')
        self.assertEqual(receipt['target'], 'client')
        self.assertIsNone(receipt['engine'])
        self.assertIn("cache: 'reload'", (self.output / 'service-worker.js').read_text())
        self.assertEqual(receipt['size']['engine_bytes'], 0)
        files = {record['path'] for record in receipt['files']}
        for record in receipt['files']:
            data = (self.output / record['path']).read_bytes()
            self.assertEqual(len(data), record['size_bytes'])
            self.assertEqual(hashlib.sha256(data).hexdigest(), record['sha256'])
        for edge in receipt['imports']:
            self.assertIn(edge['from'], files)
            self.assertIn(edge['to'], files)
        self.assertTrue(set(receipt['licenses']) <= files)
        asset_root = Path(receipt['entrypoint']['path']).parent
        self.assertEqual((self.output / asset_root / 'LICENSES/shimify.txt').read_bytes(), (ROOT / 'LICENSE').read_bytes())
        self.assertEqual(receipt['size']['artifact_bytes'], sum(path.stat().st_size for path in self.output.rglob('*') if path.is_file()))
        buckets = ['emitted_module_bytes', 'helper_bytes', 'source_map_bytes', 'notice_bytes', 'data_bytes', 'assembly_module_bytes', 'receipt_bytes']
        self.assertEqual(receipt['size']['artifact_bytes'], sum(receipt['size'][key] for key in buckets))
        with patch('pocket_python.compiled.__version__', 'fixture-next'):
            changed = build_compiled(self.client, self.root / 'next-version', title='<Metrics & text>')
        self.assertNotEqual(receipt['cache_version'], changed['cache_version'])
        self.assertIn('&lt;Metrics &amp; text&gt;', (self.output / 'index.html').read_text())
        self.assertFalse(any(name.endswith('.wasm') or 'micropython' in name.lower() or 'pyodide' in name.lower() for name in files))

    def test_known_compiler_recompilation_rejects_rehashed_javascript(self):
        artifact = compile_client(self.client)
        root = self.root / 'compiled'
        root.mkdir()
        for item in artifact.files:
            path = root / item.path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(item.data)
        manifest_path = root / 'COMPILED-MANIFEST.json'
        manifest_path.write_bytes(artifact.manifest_bytes)
        snapshot = read_compiled(root, self.client)
        # Disk edits after validation do not change the verified snapshot.
        (root / 'app.mjs').write_bytes(b'import "https://example.test/remote.mjs";')
        receipt = build_compiled(self.client, self.output, compiled=snapshot)
        self.assertEqual((self.output / receipt['entrypoint']['path']).read_bytes(), next(item.data for item in artifact.files if item.path == 'app.mjs'))
        with self.assertRaises(ArtifactError):
            read_compiled(root, self.client)
        manifest = artifact.manifest
        data = (root / 'app.mjs').read_bytes()
        record = next(record for record in manifest['files'] if record['path'] == 'app.mjs')
        record.update(size=len(data), sha256=hashlib.sha256(data).hexdigest())
        manifest_path.write_bytes(json_bytes(manifest))
        with self.assertRaisesRegex(ArtifactError, 'manifest differs'):
            read_compiled(root, self.client)
        forged = replace(snapshot, files=tuple((name, b'changed' if name == 'app.mjs' else data) for name, data in snapshot.files))
        with self.assertRaisesRegex(ArtifactError, 'snapshot differs'):
            build_compiled(self.client, self.root / 'forged', compiled=forged)

    def test_source_map_policy_regenerates_maps_and_references_together(self):
        original = build_compiled(self.client, self.output)
        omitted = build_compiled(self.client, self.root / 'no-maps', omit_source_maps=True)
        self.assertFalse(omitted['source_map'])
        self.assertEqual(omitted['size']['source_map_bytes'], 0)
        self.assertNotEqual(original['cache_version'], omitted['cache_version'])
        self.assertNotEqual(original['entrypoint']['path'], omitted['entrypoint']['path'])
        for path in (self.root / 'no-maps').rglob('*'):
            if path.is_file():
                self.assertNotEqual(path.suffix, '.map')
                if path.suffix == '.mjs':
                    self.assertNotIn(b'sourceMappingURL', path.read_bytes())

    def test_explicit_client_boundary_and_unsupported_manifests(self):
        path = self.client.root / 'CLIENT-SOURCES.json'
        original = json.loads(path.read_bytes())
        for change in [{'target': 'server'}, {'schema_version': 2}, {'profile': 'pyodide'}, {'source_map': 1}, {'fetch_urls': ['https://user:secret@example.test/']}, {'fetch_urls': ['https://example.test']}, {'fetch_urls': ['https://example.test:443/']}, {'fetch_urls': ['https://127.000.000.1/']}]:
            with self.subTest(change=change), self.assertRaises(ArtifactError):
                path.write_bytes(json_bytes({**original, **change}))
                read_client(path)
        for key, value in [('path', '../server.py'), ('path', '/private.py'), ('path', 'a#b.py'), ('role', 'server-source')]:
            manifest = json.loads(json_bytes(original))
            manifest['sources'][0][key] = value
            path.write_bytes(json_bytes(manifest))
            with self.subTest(key=key, value=value), self.assertRaises(ArtifactError):
                read_client(path)
        path.write_bytes(json_bytes(original))
        (self.client.root / 'private.py').write_bytes(b'PRIVATE_TEST_CANARY = "server only"')
        build_compiled(read_client(path), self.output)
        self.assertFalse(any(b'PRIVATE_TEST_CANARY' in file.read_bytes() for file in self.output.rglob('*') if file.is_file()))

    def test_source_tamper_limits_symlinks_and_snapshot_safety(self):
        first_name, _ = self.client.files[0]
        path = self.client.root / first_name
        path.write_bytes(b'changed')
        with self.assertRaises(ArtifactError):
            read_client(self.client.root / 'CLIENT-SOURCES.json')
        build_compiled(self.client, self.output)
        path.unlink()
        try:
            path.symlink_to(self.client.root / 'text_metrics.py')
        except (OSError, NotImplementedError):
            pass
        else:
            with self.assertRaisesRegex(ArtifactError, 'Symlink'):
                read_client(self.client.root / 'CLIENT-SOURCES.json')
        forged = replace(self.client, files=((first_name, b'tampered'), *self.client.files[1:]))
        with self.assertRaises(ArtifactError):
            build_compiled(forged, self.root / 'bad')

    def test_output_exclusivity_overlap_and_publication_rollback(self):
        with self.assertRaisesRegex(ArtifactError, 'overlaps'):
            build_compiled(self.client, self.client.root / 'web')
        with patch('pocket_python.web.os.link', side_effect=OSError('fixture publication failure')):
            with self.assertRaises(OSError):
                build_compiled(self.client, self.output)
        self.assertFalse(self.output.exists())
        self.output.mkdir()
        (self.output / 'keep').write_bytes(b'keep')
        with self.assertRaisesRegex(ArtifactError, 'already exists'):
            build_compiled(self.client, self.output)
        self.assertEqual((self.output / 'keep').read_bytes(), b'keep')

    def test_compiler_identity_capability_refusals_and_cli(self):
        with patch('pocket_python.compiled.COMPILER_FINGERPRINT', '0' * 64):
            with self.assertRaisesRegex(ArtifactError, 'supported pinned build'):
                build_compiled(self.client, self.output)
        app = EXAMPLE.APP.replace('from JavaScript.browser import on_click', 'from JavaScript.browser import on_click, fetch_text')
        fetched = EXAMPLE.write_client(self.root / 'fetch-client', app=app)
        with self.assertRaisesRegex(ArtifactError, 'unavailable host capabilities'):
            build_compiled(fetched, self.output)
        path = fetched.root / 'CLIENT-SOURCES.json'
        descriptor = json.loads(path.read_bytes())
        descriptor['fetch_urls'] = ['https://example.test/']
        path.write_bytes(json_bytes(descriptor))
        granted = build_compiled(read_client(path), self.root / 'granted')
        self.assertEqual(granted['capabilities'][-1], {'id': 'fetch/1', 'urls': ['https://example.test/']})
        self.assertEqual(main(['compiled-web', str(self.client.root / 'CLIENT-SOURCES.json'), '--output', str(self.output)]), 0)


class OptionalCompilerTests(unittest.TestCase):
    def test_missing_compiler_is_explicit_and_does_not_install_or_publish(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            client = EXAMPLE.write_client(root / 'client')
            with patch('pocket_python.compiled.util.find_spec', return_value=None):
                with self.assertRaisesRegex(ArtifactError, 'compiled-build tooling'):
                    build_compiled(client, root / 'web')
            self.assertFalse((root / 'web').exists())
