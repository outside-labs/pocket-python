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
if sys.argv[2] == "compiled":
    from pocket_python._compiler_lock import COMPILER_VERSION, COMPILER_FINGERPRINT
    from pocket_python.compiled import build_compiled, read_client
    assert metadata.version("Python-JavaScript") == COMPILER_VERSION == "0.2.0"
    client = root / "client"
    client.mkdir()
    source = b"from JavaScript.browser import on_click\\nasync def show(text):\\n    print(len(text))\\nasync def main():\\n    await on_click('run', show)\\n"
    (client / "app.py").write_bytes(source)
    (client / "LICENSES").mkdir()
    notice = b"Synthetic installed-artifact fixture notice"
    (client / "LICENSES/test.txt").write_bytes(notice)
    manifest = {"kind": "pocket-python-client", "schema_version": 1, "target": "client", "entrypoint": "app", "source_map": True,
        "sources": [{**file_record("app.py", source), "module": "app", "is_package": False, "role": "client-source"}],
        "notices": [{**file_record("LICENSES/test.txt", notice), "role": "notice"}], "fetch_urls": []}
    (client / "CLIENT-SOURCES.json").write_bytes(json_bytes(manifest))
    receipt = build_compiled(read_client(client / "CLIENT-SOURCES.json"), root / "compiled-web")
    assert receipt["schema_version"] == 2 and receipt["profile"] == "compiled-javascript" and receipt["engine"] is None
    assert receipt["pocket_python_version"] == __version__
    assert receipt["producer"]["source_fingerprint"] == COMPILER_FINGERPRINT
    assert receipt["size"]["artifact_bytes"] == sum(p.stat().st_size for p in (root / "compiled-web").rglob("*") if p.is_file())
    assert not any(p.suffix == ".wasm" for p in (root / "compiled-web").rglob("*"))
else:
    from pocket_python.assets import ArtifactError
    from pocket_python.compiled import _compiler
    try:
        _compiler()
    except ArtifactError:
        pass
    else:
        raise AssertionError("A default installation unexpectedly supplied compiler tooling")
print("Installed distribution verified", __version__, sys.argv[2])
from pocket_python.interpreter import build_interpreter, read_console_source, read_interpreter
client = root / "console-source"
(client / "LICENSES").mkdir(parents=True)
source, notice = b"print('installed console')", b"Synthetic supplied-source notice"
(client / "app.py").write_bytes(source)
(client / "LICENSES/source.txt").write_bytes(notice)
manifest = {"kind": "pocket-python-console-source", "schema_version": 1, "target": "client",
    "source": {**file_record("app.py", source), "role": "client-source"},
    "notice": {**file_record("LICENSES/source.txt", notice), "role": "notice"}}
(client / "CONSOLE-SOURCE.json").write_bytes(json_bytes(manifest))
receipt = build_interpreter(read_console_source(client / "CONSOLE-SOURCE.json"), read_interpreter(sys.argv[3]), root / "console")
assert receipt["profile"] == "in-house-interpreter" and receipt["source_execution"]
assert receipt["size"]["artifact_bytes"] == sum(path.stat().st_size for path in (root / "console").rglob("*") if path.is_file())
assert not any(path.suffix == ".wasm" for path in (root / "console").rglob("*"))
print("Installed source-console assembly verified with explicitly supplied engine assets")
''')
    for index, artifact in enumerate([wheels[0], sdists[0]]):
        for profile in ["default", "compiled"]:
            work = root / (str(index) + "-" + profile)
            work.mkdir()
            tooling = ["--with", "Python-JavaScript==0.2.0"] if profile == "compiled" else []
            subprocess.run(["uv", "run", "--isolated", "--no-project", "--python", sys.executable,
                "--with", str(artifact.resolve()), *tooling, "python", "-I", str(script), version, profile,
                str(Path('runtime').resolve())], check=True, cwd=work)
