"""Build a checkout console demonstrating native callable directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Ledger:
    tag = [7]
    @property
    def reading(self): return self.tag[0]

field = Ledger.reading
native = field.getter
wrapper = field.__get__
view = Ledger.__dict__
find = view.get
print("layouts", type(property.getter).__name__, type(native).__name__, type(wrapper).__name__)
print("names", "__get__" in dir(property.getter), "__self__" in dir(native), "__objclass__" in dir(wrapper))
original = dir(native)
field.__name__ = [9]
field.__doc__ = {"label": [11]}
print("metadata", dir(native) == original, len(dir(field)))

def snapshots():
    yield dir(native)
    yield object.__dir__(wrapper)

stream = snapshots()
print("lazy", next(stream) == original, next(stream)[0])
field.fget.saved = native
Ledger.saved = find
Ledger.tag = [13]
call = native.__dir__
lookup = find.__dir__
del native
del wrapper
del field
del view
del find
del Ledger
print("retained", len(call()), call.__self__.__self__.fget.saved is call.__self__)
print("view", lookup.__self__("tag")[0], lookup.__self__("saved") is lookup.__self__, len(lookup()))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/native-callable-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/native-callable-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Native Callable Directory Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
