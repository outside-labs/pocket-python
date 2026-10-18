import json
from pathlib import Path

from pocket_python.assets import file_record, json_bytes, runtime_lock


def make_bundle(root: Path, source=b"print('hello pocket')\n") -> Path:
    directory = root / "bundle"
    directory.mkdir()
    files = {"_sources/app.py": source, "run.py": b"# synthetic launcher\n", "LICENSES/local-1/LICENSE": b"Synthetic fixture license\n"}
    manifest = {
        "schema_version": 1, "mode": "modules", "entrypoint": "_sources/app.py", "launcher": "run.py",
        "sources": [{"module": "__main__", "output": "_sources/app.py", "distribution": None, **{k:v for k,v in file_record("_sources/app.py", source).items() if k != "path"}}],
        "stdlib_modules": [], "distributions": [],
        "files": [file_record(name, data) for name, data in sorted(files.items())],
    }
    for name, data in files.items():
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    (directory / "SHIMIFY-MANIFEST.json").write_bytes(json_bytes(manifest))
    return directory


def make_runtime(root: Path, wrapper=b"// synthetic test runtime\n") -> tuple[Path, Path]:
    directory = root / "runtime"
    directory.mkdir()
    for name, data in {"micropython.mjs": wrapper, "micropython.wasm": b"synthetic", "LICENSE": b"Synthetic runtime license\n"}.items():
        (directory / name).write_bytes(data)
    lock = runtime_lock(directory, version="test-1", source_url="https://example.test/runtime", files=["micropython.mjs", "micropython.wasm"], license_files=["LICENSE"])
    path = root / "runtime-lock.json"
    path.write_bytes(json_bytes(lock))
    return directory, path
