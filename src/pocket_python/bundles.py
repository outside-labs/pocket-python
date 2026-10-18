"""Validate Shimify source-bundle snapshots without executing them."""

from dataclasses import dataclass
from pathlib import Path

from pocket_python.assets import ArtifactError, file_record, json_object, read_asset, verified_files


@dataclass
class SourceBundle:
    root: Path
    manifest: dict
    files: dict[str, bytes]

    def report(self) -> dict:
        return {
            "schema_version": 1,
            "kind": "pocket-python-source-inspection",
            "entrypoint": self.manifest["entrypoint"],
            "source_modules": len(self.manifest["sources"]),
            "source_size_bytes": sum(item["size_bytes"] for item in self.manifest["sources"]),
            "bundle_size_bytes": sum(map(len, self.files.values())),
            "direct_stdlib_modules": self.manifest["stdlib_modules"],
            "runtime_closure_complete": False,
            "browser_compatibility": "unverified; test against the selected runtime",
        }


def read_bundle(directory: str | Path) -> SourceBundle:
    root = Path(directory).absolute()
    raw = read_asset(root, "SHIMIFY-MANIFEST.json")
    manifest = json_object(raw)
    if type(manifest.get("schema_version")) is not int or manifest["schema_version"] != 1 or manifest.get("mode") != "modules":
        raise ArtifactError("Expected a Shimify schema-1 modules bundle.")
    files = verified_files(root, manifest.get("files"))
    if any(name != "run.py" and not name.startswith(("_sources/", "LICENSES/")) for name in files):
        raise ArtifactError("Bundle contains files outside the supported source/notices layout.")
    entry = manifest.get("entrypoint")
    if not isinstance(entry, str) or not entry.startswith("_sources/") or not entry.endswith(".py") or entry.count("/") != 1 or entry not in files or manifest.get("launcher") != "run.py" or "run.py" not in files:
        raise ArtifactError("Invalid bundle entrypoint or launcher.")
    sources = manifest.get("sources")
    if not isinstance(sources, list) or not sources or any(not isinstance(item, dict) for item in sources):
        raise ArtifactError("Expected source records.")
    names, outputs = set(), set()
    for item in sources:
        name, output = item.get("module"), item.get("output")
        if not isinstance(name, str) or not name or not all(part.isidentifier() for part in name.split(".")) or name in names or not isinstance(output, str) or output in outputs or output not in files:
            raise ArtifactError("Invalid or duplicate source mapping.")
        expected = {entry} if name == "__main__" else {"_sources/" + name.replace(".", "/") + suffix for suffix in [".py", "/__init__.py"]}
        if output not in expected:
            raise ArtifactError("Source mapping differs from the module layout.")
        record = file_record(output, files[output])
        if item.get("sha256") != record["sha256"] or type(item.get("size_bytes")) is not int or item["size_bytes"] != record["size_bytes"]:
            raise ArtifactError("Source hash/size differs from the file record.")
        names.add(name)
        outputs.add(output)
    if "__main__" not in names or outputs != {name for name in files if name.startswith("_sources/")}:
        raise ArtifactError("Bundle has missing or unrecorded source files.")
    stdlib = manifest.get("stdlib_modules")
    if not isinstance(stdlib, list) or any(not isinstance(name, str) or not all(part.isidentifier() for part in name.split(".")) for name in stdlib):
        raise ArtifactError("Invalid standard-library requirements.")
    # Validate attribution references before copying. Hash verification covers the
    # bytes, and required paths must also be explicitly listed in the manifest.
    distributions = manifest.get("distributions")
    if not isinstance(distributions, list):
        raise ArtifactError("Invalid distribution provenance.")
    identities = set()
    for distribution in distributions:
        if not isinstance(distribution, dict) or not isinstance(distribution.get("id"), str) or distribution["id"] in identities:
            raise ArtifactError("Invalid distribution identity.")
        identities.add(distribution["id"])
        licenses = distribution.get("license_files")
        metadata = distribution.get("metadata")
        if not isinstance(licenses, list) or not licenses or any(not isinstance(path, str) or not path.startswith("LICENSES/") or path not in files or not files[path].strip() for path in licenses):
            raise ArtifactError("Distribution license material is missing.")
        if not isinstance(metadata, str) or not metadata.startswith("LICENSES/") or metadata not in files:
            raise ArtifactError("Distribution metadata is missing.")
    if any(item.get("distribution") is not None and item["distribution"] not in identities for item in sources):
        raise ArtifactError("Source refers to missing distribution provenance.")
    files["SHIMIFY-MANIFEST.json"] = raw
    return SourceBundle(root, manifest, files)
