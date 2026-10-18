import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest

from pocket_python.assets import ArtifactError, json_bytes, read_runtime, relative_path, runtime_lock
from pocket_python.bundles import read_bundle
from pocket_python.cli import main
from tests.helpers import make_bundle, make_runtime


class AssetTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_runtime_lock_is_deterministic_verified_and_does_not_include_unlisted_files(self):
        directory, lock = make_runtime(self.root)
        (directory / "unlisted.txt").write_text("not included")
        first = read_runtime(directory, lock)
        self.assertEqual(first.lock, read_runtime(directory, lock).lock)
        self.assertEqual(set(first.files), {"micropython.mjs", "micropython.wasm", "LICENSE"})
        (directory / "micropython.wasm").write_bytes(b"changed")
        with self.assertRaisesRegex(ArtifactError, "mismatch"):
            read_runtime(directory, lock)

    def test_missing_and_empty_licenses_are_refused(self):
        directory, lock = make_runtime(self.root)
        (directory / "LICENSE").write_bytes(b"")
        with self.assertRaisesRegex(ArtifactError, "Empty runtime license"):
            runtime_lock(directory, version="1", source_url="https://example.test", files=["micropython.mjs", "micropython.wasm"], license_files=["LICENSE"])

    def test_path_boundary_matrix(self):
        for name in ["", ".", "../escape", "/absolute", "C:/drive", "a\\b", "a//b", "a/./b", "CON.txt", "trailing.", "a?x", "a#x", "a%20", "a\x00b"]:
            with self.subTest(path=name), self.assertRaises(ArtifactError):
                relative_path(name)

    def test_symlink_asset_is_refused(self):
        directory, lock = make_runtime(self.root)
        (directory / "micropython.wasm").unlink()
        outside = self.root / "outside"
        outside.write_bytes(b"synthetic")
        try:
            (directory / "micropython.wasm").symlink_to(outside)
        except OSError:
            self.skipTest("Host cannot create symlinks")
        with self.assertRaisesRegex(ArtifactError, "Symlink"):
            read_runtime(directory, lock)

    def test_bundle_verifies_sources_and_ignores_unlisted_files(self):
        directory = make_bundle(self.root)
        (directory / "unlisted.txt").write_text("not published")
        bundle = read_bundle(directory)
        self.assertEqual(bundle.report()["source_modules"], 1)
        self.assertFalse(bundle.report()["runtime_closure_complete"])
        self.assertNotIn("unlisted.txt", bundle.files)
        (directory / "_sources/app.py").write_text("raise RuntimeError('must never run')")
        with self.assertRaisesRegex(ArtifactError, "mismatch"):
            read_bundle(directory)

    def test_invalid_source_mapping_is_refused(self):
        directory = make_bundle(self.root)
        path = directory / "SHIMIFY-MANIFEST.json"
        manifest = json.loads(path.read_bytes())
        manifest["sources"][0]["module"] = "wrong"
        path.write_bytes(json_bytes(manifest))
        with self.assertRaisesRegex(ArtifactError, "mapping"):
            read_bundle(directory)

    def test_cli_success_errors_and_existing_lock(self):
        directory, path = make_runtime(self.root)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(["inspect", str(make_bundle(self.root))]), 0)
        args = ["lock-runtime", str(directory), "--runtime-version", "1", "--source-url", "https://example.test", "--file", "micropython.mjs", "--file", "micropython.wasm", "--license-file", "LICENSE", "--output", str(path)]
        before = path.read_bytes()
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(args), 2)
        self.assertEqual(path.read_bytes(), before)
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(["inspect", str(self.root / "missing")]), 1)
