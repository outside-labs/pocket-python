"""Assemble verified sources and a local MicroPython runtime as a PWA."""

import hashlib
import html
import json
import os
from pathlib import Path
import tempfile

from pocket_python import __version__
from pocket_python.assets import ArtifactError, RuntimeAssets, check_names, file_record, json_bytes, json_object
from pocket_python.bundles import SourceBundle
from pocket_python.templates import APP, ICON, PAGE, SERVICE_WORKER, WORKER


def _publish(destination: Path, files: dict[str, bytes]):
    check_names(files)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".pocket-python-", dir=destination.parent) as temporary:
        stage = Path(temporary)
        for name, content in files.items():
            path = stage / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        destination.mkdir()
        written, directories = [], {destination}
        try:
            for name in sorted(files):
                path = destination / name
                parents = []
                parent = path.parent
                while parent != destination:
                    parents.append(parent)
                    parent = parent.parent
                for parent in reversed(parents):
                    if parent not in directories:
                        parent.mkdir()
                        directories.add(parent)
                os.link(stage / name, path)
                written.append(path)
        except BaseException:
            for path in reversed(written):
                path.unlink(missing_ok=True)
            for path in sorted(directories, key=lambda p: len(p.parts), reverse=True):
                try:
                    path.rmdir()
                except OSError:
                    pass
            raise


def build_web(bundle: SourceBundle, runtime: RuntimeAssets, output: str | Path, *, title: str = "Pocket Python") -> dict:
    if json_object(bundle.files["SHIMIFY-MANIFEST.json"]) != bundle.manifest:
        raise ArtifactError("Source manifest snapshot changed after validation.")
    for records, snapshot, extra in [
        (bundle.manifest["files"], bundle.files, {"SHIMIFY-MANIFEST.json"}),
        (runtime.lock["files"], runtime.files, set()),
    ]:
        if set(snapshot) != {record["path"] for record in records} | extra:
            raise ArtifactError("Snapshot files changed after validation.")
        for record in records:
            if file_record(record["path"], snapshot[record["path"]]) != {key: record[key] for key in ["path", "sha256", "size_bytes"]}:
                raise ArtifactError("Snapshot hash or size changed after validation.")
    requested = Path(output).absolute()
    if requested.exists() or requested.is_symlink():
        raise ArtifactError("Output already exists; choose a new directory.")
    destination = requested.resolve()
    for root in [bundle.root.resolve(), runtime.root.resolve()]:
        if destination.is_relative_to(root) or root.is_relative_to(destination):
            raise ArtifactError("Output overlaps an input root.")
    if not isinstance(title, str) or not title.strip():
        raise ArtifactError("Application title must be nonempty.")
    sources = []
    for source in bundle.manifest["sources"]:
        name = source["output"]
        try:
            bundle.files[name].decode("utf-8")
        except UnicodeError as error:
            raise ArtifactError("The MicroPython profile requires UTF-8 application sources.") from error
        sources.append({"path": name.removeprefix("_sources/"), "url": "application/" + name})
    files = {"application/" + name: data for name, data in bundle.files.items()}
    files.update({"runtime/" + name: data for name, data in runtime.files.items()})
    files["runtime-lock.json"] = json_bytes(runtime.lock)
    files["index.html"] = PAGE.format(title=html.escape(title, quote=True)).encode()
    files["app.js"] = APP.encode()
    files["worker.js"] = WORKER.encode()
    files["icon.svg"] = ICON.encode()
    files["app-config.json"] = json_bytes({"entrypoint": bundle.manifest["entrypoint"].removeprefix("_sources/"), "sources": sorted(sources, key=lambda s: s["path"])})
    files["manifest.webmanifest"] = json_bytes({
        "name": title, "short_name": title[:24], "id": "./", "start_url": "./", "scope": "./",
        "display": "standalone", "theme_color": "#213b45", "background_color": "#213b45",
        "icons": [{"src": "./icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable"}],
    })
    records = [file_record(name, content) for name, content in sorted(files.items())]
    cache_version = hashlib.sha256(json_bytes({"files": records})).hexdigest()
    precache = ["./", *sorted(files), "service-worker.js", "POCKET-PYTHON.json"]
    files["service-worker.js"] = SERVICE_WORKER.replace("__FILES__", json.dumps(precache)).replace("__VERSION__", cache_version).encode()
    manifest = {
        "schema_version": 1,
        "kind": "pocket-python-web",
        "pocket_python_version": __version__,
        "title": title,
        "entrypoint": "index.html",
        "runtime": {key: runtime.lock[key] for key in ["implementation", "version", "source_url", "license_files"]},
        "source_bundle": "application/SHIMIFY-MANIFEST.json",
        "runtime_lock": "runtime-lock.json",
        "cache_version": cache_version,
        "size": {
            "application_source_bytes": bundle.report()["source_size_bytes"],
            "source_bundle_bytes": sum(map(len, bundle.files.values())),
            "runtime_asset_bytes": sum(map(len, runtime.files.values())),
            "artifact_bytes": 0,
        },
        "files": [file_record(name, content) for name, content in sorted(files.items())],
        "direct_stdlib_modules": bundle.manifest["stdlib_modules"],
        "limitations": [
            "MicroPython compatibility must be tested for this application; CPython syntax and stdlib APIs may differ.",
            "Supplied runtime assets are preserved, not automatically rebuilt or trimmed.",
            "Offline use requires initial installation over HTTPS/localhost and retained browser cache.",
            "License material is preserved; redistribution compliance is not certified.",
        ],
    }
    # The manifest excludes its own file hash, but its total byte count includes
    # itself. Iterate until the decimal length of the total is stable.
    payload_size = sum(map(len, files.values()))
    while True:
        content = json_bytes(manifest)
        total = payload_size + len(content)
        if manifest["size"]["artifact_bytes"] == total:
            break
        manifest["size"]["artifact_bytes"] = total
    files["POCKET-PYTHON.json"] = content
    _publish(destination, files)
    return manifest
