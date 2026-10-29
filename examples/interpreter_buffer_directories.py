"""Build a checkout console demonstrating set and buffer directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Key:
    def __hash__(self): return 7
    def __eq__(self, other): raise RuntimeError("equal")
    def __dir__(self): raise RuntimeError("directory")

key = Key()
group = {key}
frozen = frozenset((key,))
key.saved = group
def forbidden(self): raise RuntimeError("hash")
Key.__hash__ = forbidden
native = group.__dir__
print("sets", len(dir(group)), len(frozen.__dir__()), native.__qualname__)
print("cycle", next(iter(group)).saved is native.__self__)

data = b"abc"
caller = data.__dir__
del data
print("bytes", len(caller()), caller.__self__[1])
storage = bytearray(b"abcd")
parent = memoryview(storage)
child = parent[::-2]
retained = child.__dir__
readonly = child.toreadonly()
parent.release()
del parent
del child
del storage
print("view", len(dir(retained.__self__)), retained.__qualname__)
retained.__self__[0] = 90
print("aliases", readonly[0], retained.__self__.obj[3], retained.__self__.tobytes() == b"Zb")
retained.__self__.release()
print("released", len(retained()), len(dir(retained.__self__)), readonly[0])
try: retained.__self__[0]
except ValueError: print("no data access")
print("lazy", *(len(dir(value)) for value in (group, frozen, caller.__self__, bytearray(), retained.__self__)))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/buffer-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/buffer-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Set and Buffer Directory Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
