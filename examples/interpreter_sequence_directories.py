"""Build a checkout console demonstrating range and slice directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''value = range(7, 15, 2)
cursor = iter(value)
print("first", next(cursor))
native = value.__dir__
print("range", len(dir(value)), len(native()), native.__qualname__)
print("position", next(cursor), value.start, value.stop, value.step)
large = range(10**40)
print("large", len(dir(large)), large.stop == 10**40)

class Field:
    def __index__(self): raise RuntimeError("index")
    def __hash__(self): raise RuntimeError("hash")
    def __bool__(self): raise RuntimeError("truth")

field = Field()
cut = slice(field, field, field)
field.saved = cut
retained = object.__dir__.__get__(cut)
del cut
del field
del Field
print("slice", len(dir(retained.__self__)), len(retained()), retained.__qualname__)
print("cycle", retained.__self__.start.saved is retained.__self__)
raw = retained()
raw[0] = "changed"
print("fresh", "changed" in retained())
nested = retained.__dir__
print("nested", len(nested()), nested.__self__ is retained)
print("lazy", *(len(dir(item)) for item in (value, large, retained.__self__)))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/sequence-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/sequence-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Range and Slice Directory Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
