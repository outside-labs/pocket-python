"""Trusted test-only module assets; no filesystem discovery or runtime fallback."""

import ast
import hashlib
import json

from function_fixtures import compile_fixture


def build_registry(modules, entry="app"):
    assets, records = {}, []
    def asset(path, data):
        assets[path] = list(data)
        return {"path": path, "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    for name, details in modules.items():
        notice_data = details.get("notice", "Synthetic test fixture license\n").encode("utf-8")
        notice = asset("LICENSES/" + hashlib.sha256(notice_data).hexdigest() + ".txt", notice_data)
        source = details["source"]
        package = details.get("package", False)
        filename = "sources/" + name.replace(".", "/") + ("/__init__.py" if package else ".py")
        source_asset = asset(filename, source.encode("utf-8"))
        code = compile_fixture(source, filename, module_profile=True)
        imports = set()
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Import):
                imports.update(alias.name for alias in node.names if alias.name in modules)
            elif isinstance(node, ast.ImportFrom):
                base = node.module or ""
                if node.level:
                    parent = name.split(".") if package else name.split(".")[:-1]
                    base = ".".join(parent[:len(parent)-node.level+1] + ([base] if base else []))
                if base in modules:
                    imports.add(base)
                imports.update(base + "." + alias.name for alias in node.names if base + "." + alias.name in modules)
        records.append({"name": name, "package": package, "source": source_asset,
                        "bytecode": asset("code/" + name.replace(".", "/") + ".pbc.json", json.dumps(code, ensure_ascii=True).encode("utf-8")),
                        "imports": details.get("imports", sorted(imports)), "licenses": [notice]})
    return {"manifest": {"kind": "pocket-python-module-registry", "schema_version": 1, "entry": entry,
                         "roots": ["sources", "code"], "modules": records}, "assets": assets}
