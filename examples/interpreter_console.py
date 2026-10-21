"""Write an explicit source-console allowlist and assemble the checkout engine."""

import argparse
from pathlib import Path

from pocket_python.assets import file_record, json_bytes
from pocket_python.interpreter import build_interpreter, read_console_source, read_interpreter


ROOT = Path(__file__).resolve().parents[1]
COMPUTATION = (ROOT / 'examples/shared_text_metrics/computation.py').read_text(encoding='utf-8')
SOURCE = COMPUTATION + '''
result = metrics("Hello Python 😀\\nOn this device")
print("Characters:", result[0])
print("Words:", result[1])
print("Lines:", result[2])
'''


def write_source(root, *, source=SOURCE):
    root = Path(root)
    root.mkdir(parents=True)
    files = {'app.py': source.encode('utf-8'), 'LICENSES/application.txt': (ROOT / 'LICENSE').read_bytes().replace(b'\r\n', b'\n')}
    for name, data in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    manifest = {'kind': 'pocket-python-console-source', 'schema_version': 1, 'target': 'client',
                'source': {**file_record('app.py', files['app.py']), 'role': 'client-source'},
                'notice': {**file_record('LICENSES/application.txt', files['LICENSES/application.txt']), 'role': 'notice'}}
    (root / 'CONSOLE-SOURCE.json').write_bytes(json_bytes(manifest))
    return read_console_source(root / 'CONSOLE-SOURCE.json')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source), read_interpreter(ROOT / 'runtime'), args.output)
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
