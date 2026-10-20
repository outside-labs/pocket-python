"""Read explicit, hashed runtime assets without loading executable code."""

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
from urllib.parse import urlparse


class ArtifactError(ValueError):
    """An unsupported, changed, or unsafe artifact input."""


def relative_path(value: str) -> str:
    if not isinstance(value, str):
        raise ArtifactError("Artifact paths must be strings.")
    path = PurePosixPath(value)
    reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
    if not path.parts or path.is_absolute() or ".." in path.parts or str(path) != value:
        raise ArtifactError(f"Unsafe artifact path: {value!r}")
    for part in path.parts:
        if part.split(".")[0].upper() in reserved or part.endswith((".", " ")) or any(ord(c) < 32 or c in '\\:*?"<>|#%' for c in part):
            raise ArtifactError(f"Nonportable artifact path: {value!r}")
    return value


def read_asset(root: Path, name: str, *, max_bytes: int | None = None) -> bytes:
    relative_path(name)
    current = root
    if root.is_symlink() or not root.is_dir():
        raise ArtifactError("Asset root must be an ordinary directory.")
    for part in PurePosixPath(name).parts:
        current = current / part
        if current.is_symlink():
            raise ArtifactError(f"Symlink asset is unsupported: {name}")
    if not current.is_file() or not current.resolve().is_relative_to(root.resolve()):
        raise ArtifactError(f"Asset is missing or escapes its root: {name}")
    if max_bytes is None:
        return current.read_bytes()
    if type(max_bytes) is not int or max_bytes < 0:
        raise ArtifactError("Asset read limit must be a nonnegative integer.")
    with current.open("rb") as stream:
        data = stream.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ArtifactError(f"Asset exceeds its read limit: {name}")
    return data


def file_record(name: str, content: bytes) -> dict:
    return {"path": name, "sha256": hashlib.sha256(content).hexdigest(), "size_bytes": len(content)}


def check_names(names):
    seen = set()
    for name in names:
        key = relative_path(name).casefold()
        if key in seen or any(key.startswith(other + "/") or other.startswith(key + "/") for other in seen):
            raise ArtifactError(f"Artifact path collision: {name}")
        seen.add(key)


def verified_files(root: Path, records: list) -> dict[str, bytes]:
    if not isinstance(records, list) or not records:
        raise ArtifactError("Expected a nonempty file record list.")
    if any(not isinstance(record, dict) or not isinstance(record.get("path"), str) for record in records):
        raise ArtifactError("Invalid file record.")
    check_names(record["path"] for record in records)
    files = {}
    for record in records:
        digest, size = record.get("sha256"), record.get("size_bytes")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest) or type(size) is not int or size < 0:
            raise ArtifactError("Invalid file hash/size record.")
        content = read_asset(root, record["path"])
        if file_record(record["path"], content) != {key: record[key] for key in ["path", "sha256", "size_bytes"]}:
            raise ArtifactError(f"Asset hash or size mismatch: {record['path']}")
        files[record["path"]] = content
    return files


def json_object(content: bytes) -> dict:
    try:
        value = json.loads(content)
    except (ValueError, UnicodeError) as error:
        raise ArtifactError(f"Invalid JSON: {error}") from error
    if not isinstance(value, dict):
        raise ArtifactError("Expected a JSON object.")
    return value


def json_bytes(value: dict) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def runtime_lock(root: str | Path, *, version: str, source_url: str, files: list[str], license_files: list[str]) -> dict:
    if not isinstance(version, str) or not version.strip():
        raise ArtifactError("Runtime version must be nonempty.")
    if not isinstance(source_url, str):
        raise ArtifactError("Runtime source must be an HTTPS URL.")
    source = urlparse(source_url)
    if source.scheme != "https" or not source.netloc or source.username or source.password:
        raise ArtifactError("Runtime source must be an HTTPS URL without credentials.")
    if not license_files:
        raise ArtifactError("At least one runtime license file is required.")
    names = sorted(set(files) | set(license_files))
    check_names(names)
    content = {name: read_asset(Path(root), name) for name in names}
    for name in license_files:
        if not content[name].strip():
            raise ArtifactError(f"Empty runtime license file: {name}")
    if not {"micropython.mjs", "micropython.wasm"} <= content.keys():
        raise ArtifactError("MicroPython requires micropython.mjs and micropython.wasm.")
    return {
        "schema_version": 1,
        "kind": "pocket-python-runtime",
        "implementation": "micropython",
        "version": version,
        "source_url": source_url,
        "entrypoint": "micropython.mjs",
        "license_files": sorted(set(license_files)),
        "files": [file_record(name, data) for name, data in sorted(content.items())],
    }


@dataclass
class RuntimeAssets:
    root: Path
    lock: dict
    files: dict[str, bytes]


def read_runtime(root: str | Path, lock_path: str | Path) -> RuntimeAssets:
    path = Path(lock_path)
    if path.is_symlink():
        raise ArtifactError("Runtime lock must not be a symlink.")
    lock = json_object(path.read_bytes())
    if type(lock.get("schema_version")) is not int or lock["schema_version"] != 1 or lock.get("kind") != "pocket-python-runtime":
        raise ArtifactError("Unsupported runtime lock schema.")
    if lock.get("implementation") != "micropython" or lock.get("entrypoint") != "micropython.mjs":
        raise ArtifactError("Only the MicroPython WebAssembly profile is supported.")
    root = Path(root).absolute()
    files = verified_files(root, lock.get("files"))
    licenses = lock.get("license_files")
    if not isinstance(licenses, list) or not licenses or any(not isinstance(name, str) or name not in files or not files[name].strip() for name in licenses):
        raise ArtifactError("Missing or empty locked runtime license files.")
    expected = runtime_lock(root, version=lock.get("version"), source_url=lock.get("source_url", ""), files=list(files), license_files=licenses)
    if lock != expected:
        raise ArtifactError("Runtime lock differs from the supported schema.")
    return RuntimeAssets(root, lock, files)
