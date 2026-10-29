"""Build a checkout console demonstrating numeric type directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''types = (bool, int, float, complex, type(None), type(NotImplemented))
for cls in types:
    native = type.__dir__.__get__(cls)
    names = dir(cls)
    print(cls.__name__, len(names), native.__self__ is cls, "__mro__" in names)

raw = type.__dir__(bool)
print("native order", *raw[:5])
snapshot = dir(int)
snapshot[0] = "changed"
print("fresh", "changed" in dir(int))
class View:
    @property
    def __class__(self): return int
view = View()
view.saved = view
native = view.__dir__
del view
del View
print("advertised", "bit_length" in native(), native.__self__.saved is native.__self__)
call = type.__dir__.__get__(complex).__dir__
print("retained", len(call()), len(call.__self__()), call.__self__.__self__ is complex)
print("lazy", *(len(dir(cls)) for cls in types))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/numeric-type-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/numeric-type-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Numeric Type Directory Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
