"""Build a checkout console demonstrating callable type directories directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''def f(): return 7
f.custom = 9
class A:
    def method(self): return 11
method = A().method
values = (f, method, object.__dir__, property.__get__, type.mro.__get__(int), property(f).__get__, property(f), A.__dict__)
for item in values:
    cls = type(item)
    native = type.__dir__.__get__(cls)
    print(cls.__name__, len(dir(cls)), native.__self__ is cls)
print("custom", "custom" in dir(f), "custom" in dir(type(f)))
class Advertised:
    @property
    def __class__(self): return type(f)
obj = Advertised()
obj.saved = obj
native = obj.__dir__
del obj
print("retained", "__code__" in native(), native.__self__.saved is native.__self__)
snapshot = type.__dir__(type(method))
snapshot[0] = "changed"
print("fresh", "changed" in type.__dir__(type(method)), method())
print("lazy", *(len(dir(type(item))) for item in values))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/callable-type-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/callable-type-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Callable Type Directories Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
