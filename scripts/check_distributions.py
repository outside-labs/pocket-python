"""Enforce distribution allowlists and test isolated installed artifacts."""

from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import tomllib
import zipfile

directory = Path(sys.argv[1] if len(sys.argv) > 1 else "dist")
project = tomllib.loads(Path("pyproject.toml").read_text())["project"]
version = project["version"]
modules = {path.relative_to("src").as_posix() for path in Path("src/pocket_python").rglob("*") if path.is_file() and (path.suffix == ".py" or path.name == "py.typed")}
info = f"pocket_python-{version}.dist-info"
wheels = list(directory.glob("pocket_python-*.whl"))
sdists = list(directory.glob("pocket_python-*.tar.gz"))
assert len(wheels) == len(sdists) == 1
with zipfile.ZipFile(wheels[0]) as archive:
    expected = modules | {f"{info}/{name}" for name in ["METADATA", "WHEEL", "entry_points.txt", "RECORD", "licenses/LICENSE"]}
    assert {item.filename for item in archive.infolist() if not item.is_dir()} == expected, "Unexpected wheel files"
    for name in modules:
        assert archive.read(name) == (Path("src") / name).read_bytes()
    metadata = archive.read(f"{info}/METADATA").decode()
    assert f"Version: {version}\n" in metadata and "License-Expression: MIT\n" in metadata
    assert "Requires-Dist:" not in metadata
with tarfile.open(sdists[0]) as archive:
    expected = {f"pocket_python-{version}/{name}" for name in ["pyproject.toml", "pyproject.toml.orig", "README.md", "LICENSE", "PKG-INFO"]}
    expected |= {f"pocket_python-{version}/src/{name}" for name in modules}
    assert {item.name for item in archive.getmembers() if item.isfile()} == expected, "Unexpected source distribution files"

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    script = root / "installed_check.py"
    script.write_text('''import importlib.metadata as metadata
import json
from pathlib import Path
import sys
from pocket_python import __version__
from pocket_python.assets import file_record, json_bytes, read_runtime, runtime_lock
from pocket_python.bundles import read_bundle
from pocket_python.cli import main
from pocket_python.web import build_web
assert __version__ == metadata.version("pocket-python") == sys.argv[1]
assert metadata.metadata("pocket-python")["License-Expression"] == "MIT"
assert not metadata.requires("pocket-python")
root = Path.cwd()
runtime = root / "runtime"
runtime.mkdir()
for name, data in {"micropython.mjs": b"// synthetic smoke fixture", "micropython.wasm": b"fixture", "LICENSE": b"Synthetic test license"}.items():
    (runtime / name).write_bytes(data)
assert main(["lock-runtime", str(runtime), "--runtime-version", "test", "--source-url", "https://example.test/runtime", "--file", "micropython.mjs", "--file", "micropython.wasm", "--license-file", "LICENSE", "--output", str(root / "lock.json")]) == 0
bundle = root / "bundle"
(bundle / "_sources").mkdir(parents=True)
files = {"_sources/app.py": b"print('installed smoke')", "run.py": b"# fixture"}
for name, data in files.items():
    (bundle / name).write_bytes(data)
source = file_record("_sources/app.py", files["_sources/app.py"])
manifest = {"schema_version": 1, "mode": "modules", "entrypoint": "_sources/app.py", "launcher": "run.py", "stdlib_modules": [], "distributions": [], "sources": [{"module": "__main__", "output": "_sources/app.py", "sha256": source["sha256"], "size_bytes": source["size_bytes"], "distribution": None}], "files": [file_record(name, data) for name,data in files.items()]}
(bundle / "SHIMIFY-MANIFEST.json").write_bytes(json_bytes(manifest))
assert main(["inspect", str(bundle)]) == 0
assert main(["web", str(bundle), "--runtime", str(runtime), "--runtime-lock", str(root / "lock.json"), "--output", str(root / "web")]) == 0
artifact = json.loads((root / "web/POCKET-PYTHON.json").read_bytes())
assert artifact["pocket_python_version"] == __version__
assert (root / "web/runtime/LICENSE").read_bytes() == b"Synthetic test license"
print("Installed distribution verified", __version__)
''')
    for index, artifact in enumerate([wheels[0], sdists[0]]):
        work = root / str(index)
        work.mkdir()
        subprocess.run(["uv", "run", "--isolated", "--no-project", "--python", "3.14", "--with", str(artifact.resolve()), "python", "-I", str(script), version], check=True, cwd=work)
