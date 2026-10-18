import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from pocket_python.assets import ArtifactError, read_runtime
from pocket_python.bundles import read_bundle
from pocket_python.web import build_web
from tests.helpers import make_bundle, make_runtime


class WebTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.bundle = read_bundle(make_bundle(self.root))
        self.runtime = read_runtime(*make_runtime(self.root))
        self.output = self.root / "web"

    def test_manifest_hashes_sizes_local_urls_and_notices_are_complete(self):
        manifest = build_web(self.bundle, self.runtime, self.output, title="<Pocket & Python>")
        self.assertEqual(manifest, json.loads((self.output / "POCKET-PYTHON.json").read_bytes()))
        self.assertEqual(manifest["size"]["artifact_bytes"], sum(path.stat().st_size for path in self.output.rglob("*") if path.is_file()))
        for record in manifest["files"]:
            content = (self.output / record["path"]).read_bytes()
            self.assertEqual(record["sha256"], hashlib.sha256(content).hexdigest())
        self.assertIn("&lt;Pocket &amp; Python&gt;", (self.output / "index.html").read_text())
        self.assertEqual((self.output / "runtime/LICENSE").read_bytes(), self.runtime.files["LICENSE"])
        self.assertEqual((self.output / "application/LICENSES/local-1/LICENSE").read_bytes(), b"Synthetic fixture license\n")
        self.assertEqual(json.loads((self.output / "manifest.webmanifest").read_bytes())["scope"], "./")
        for name in ["app.js", "worker.js", "service-worker.js"]:
            self.assertNotIn("https://", (self.output / name).read_text())
            subprocess.run(["node", "--check", str(self.output / name)], check=True, capture_output=True)

    def test_build_is_deterministic_and_runtime_changes_invalidate_cache(self):
        first = build_web(self.bundle, self.runtime, self.output)
        second = build_web(self.bundle, self.runtime, self.root / "second")
        self.assertEqual(first, second)
        self.runtime.files["micropython.wasm"] += b"changed fixture snapshot"
        third = build_web(self.bundle, self.runtime, self.root / "third")
        self.assertNotEqual(first["cache_version"], third["cache_version"])

    def test_assembly_uses_verified_snapshots_without_reading_changed_inputs(self):
        original = self.bundle.files["_sources/app.py"]
        (self.bundle.root / "_sources/app.py").write_bytes(b"changed after validation")
        build_web(self.bundle, self.runtime, self.output)
        self.assertEqual((self.output / "application/_sources/app.py").read_bytes(), original)

    def test_existing_overlap_and_publication_failure_are_safe(self):
        for output in [self.bundle.root / "new", self.runtime.root / "new"]:
            with self.assertRaisesRegex(ArtifactError, "overlaps"):
                build_web(self.bundle, self.runtime, output)
        with patch("pocket_python.web.os.link", side_effect=OSError("test failure")):
            with self.assertRaises(OSError):
                build_web(self.bundle, self.runtime, self.output)
        self.assertFalse(self.output.exists())
        self.output.mkdir()
        (self.output / "keep").write_text("keep")
        with self.assertRaisesRegex(ArtifactError, "already exists"):
            build_web(self.bundle, self.runtime, self.output)
        self.assertEqual((self.output / "keep").read_text(), "keep")

    def test_service_worker_cache_cleanup_is_scoped(self):
        build_web(self.bundle, self.runtime, self.output)
        code = (self.output / "service-worker.js").read_text()
        self.assertIn('self.registration.scope + ":"', code)
        self.assertIn("key.startsWith(PREFIX) && key !== CACHE", code)
        self.assertIn("url.origin !== self.location.origin", code)
