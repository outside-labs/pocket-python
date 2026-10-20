"""Build the shared text-metrics computation as a local compiled offline PWA.

Computation: outside-labs/shimify tests/fixtures/text_metrics at
b48ed1778270508007d75b861dc117ad4ddc4f2b; MIT notice preserved in LICENSES/.
"""

import argparse
from pathlib import Path
import tempfile

from pocket_python.assets import file_record, json_bytes
from pocket_python.compiled import build_compiled, read_client


APP = '''from JavaScript.browser import on_click
from text_metrics import metrics
async def display(text):
    print(metrics(text))
async def main():
    await on_click("run", display)
'''
COMPUTATION = 'def character_count(text):\n    return len(text)\n\n\n\nSEPARATORS = " \\t\\n\\r\\v\\f"\n\n\ndef metrics(text):\n    if not isinstance(text, str):\n        raise TypeError("text must be str")\n    characters = character_count(text)\n    words = 0\n    lines = 0\n    inside_word = False\n    if text:\n        lines = 1\n    for character in text:\n        if character == "\\n":\n            lines = lines + 1\n        if character in SEPARATORS:\n            inside_word = False\n        elif not inside_word:\n            words = words + 1\n            inside_word = True\n    return characters, words, lines\n'


def write_client(root, *, app=APP, computation=COMPUTATION):
    root = Path(root)
    root.mkdir()
    (root / "LICENSES").mkdir()
    data = {"app.py": app.encode(), "text_metrics.py": computation.encode(),
            "LICENSES/shimify.txt": (Path(__file__).resolve().parents[1] / "LICENSE").read_bytes()}
    for name, content in data.items():
        (root / name).write_bytes(content)
    records = [{**file_record(name, data[name]), "module": name.removesuffix(".py"), "is_package": False, "role": "client-source"} for name in ["app.py", "text_metrics.py"]]
    manifest = {"kind": "pocket-python-client", "schema_version": 1, "target": "client", "entrypoint": "app", "source_map": True,
                "sources": records, "notices": [{**file_record("LICENSES/shimify.txt", data["LICENSES/shimify.txt"]), "role": "notice"}], "fetch_urls": []}
    (root / "CLIENT-SOURCES.json").write_bytes(json_bytes(manifest))
    return read_client(root / "CLIENT-SOURCES.json")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--omit-source-maps", action="store_true")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as temporary:
        client = write_client(Path(temporary) / "client")
        receipt = build_compiled(client, args.output, title="Text metrics", omit_source_maps=args.omit_source_maps)
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")


if __name__ == "__main__":
    main()
