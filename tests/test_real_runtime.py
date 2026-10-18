import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from pocket_python.assets import read_runtime
from pocket_python.bundles import read_bundle
from pocket_python.web import build_web
from tests.helpers import make_bundle


@unittest.skipUnless(os.environ.get("POCKET_PYTHON_RUNTIME"), "Explicit pinned WASM fixture path is required")
class RealRuntimeTests(unittest.TestCase):
    def test_generated_worker_executes_reports_python_errors_and_can_be_stopped(self):
        runtime_path = Path(os.environ["POCKET_PYTHON_RUNTIME"]).resolve()
        runtime = read_runtime(runtime_path, runtime_path / "runtime-lock.json")
        runner = Path(__file__).resolve().parents[1] / "scripts/worker_smoke.mjs"
        for mode, source in [
            ("success", b"print('hello pocket')\n"),
            ("error", b"raise RuntimeError('known failure')\n"),
            ("stop", b"print('loop-start')\nwhile True:\n    pass\n"),
        ]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                output = root / "web"
                build_web(read_bundle(make_bundle(root, source)), runtime, output)
                result = subprocess.run(["node", str(runner), str(output), mode], capture_output=True, text=True, timeout=25)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn('"result":"passed"', result.stdout)
