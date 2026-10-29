"""Build a checkout console demonstrating container type directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''types = (str, list, tuple, dict, range, slice, set, frozenset, bytes, bytearray, memoryview)
for cls in types:
    native = type.__dir__.__get__(cls)
    print(cls.__name__, len(dir(cls)), native.__self__ is cls)

items = [7, 9]
iterator = iter(items)
print("position", next(iterator), len(dir(type(items))), next(iterator))
storage = bytearray(b"abcd")
view = memoryview(storage)[::-2]
print("alias", len(dir(type(view))))
view[0] = 90
print("data", storage[3], view.tobytes() == b"Zb")
cls = type(view)
view.release()
print("released", dir(cls) == dir(view), len(type.__dir__(cls)))

class Key:
    def __hash__(self): return 7
key = Key()
mapping = {key: 9}
key.saved = mapping
def forbidden(self): raise RuntimeError("hash")
Key.__hash__ = forbidden
print("keys", len(dir(type(mapping))), next(iter(mapping)).saved is mapping)
native = type.__dir__.__get__(dict)
snapshot = native()
snapshot[0] = "changed"
print("fresh", "changed" in native(), native.__qualname__)
print("lazy", *(len(dir(cls)) for cls in (range, slice, memoryview)))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/container-type-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/container-type-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Container Type Directory Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
