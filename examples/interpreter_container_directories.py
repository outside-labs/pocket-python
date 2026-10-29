"""Build a checkout console demonstrating ordinary container directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''text = "a😀中"
cursor = iter(text)
print("text", next(cursor), len(dir(text)), next(cursor))
items = [7, 9]
cursor = iter(items)
print("list", next(cursor), len(items.__dir__()))
items.append(11)
print("position", next(cursor), next(cursor))

shared = []
pair = (shared,)
shared.append(pair)
retained = pair.__dir__
del pair
del shared
print("tuple", len(retained()), retained.__self__[0][0] is retained.__self__)

class Key:
    def __hash__(self): return 7
    def __eq__(self, other): raise RuntimeError("equal")
    def __dir__(self): raise RuntimeError("directory")

key = Key()
mapping = {key: items}
key.saved = mapping
native = object.__dir__.__get__(mapping)
del mapping
del key
del Key
print("dict", len(dir(native.__self__)), len(native()), native.__qualname__)
print("cycle", next(iter(native.__self__)).saved is native.__self__)
raw = native()
raw[0] = "changed"
print("fresh", "changed" in native())
print("lazy", *(len(dir(value)) for value in (text, items, retained.__self__, native.__self__)))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/container-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/container-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Container Directory Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
