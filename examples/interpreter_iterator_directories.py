"""Build a checkout console demonstrating native iterator directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''items = [7, 9]
cursor = iter(items)
names = dir(cursor)
native = cursor.__dir__
print("list", len(names), "__setstate__" in names, native.__qualname__)
print("first", next(cursor), names == dir(cursor))
items[1] = 11
print("updated", next(cursor), next(cursor, None), len(native()))

text = iter("ab")
wide = iter(range(10**40, 10**40+2))
print("types", type(text).__name__, type(wide).__name__)
print("binding", text.__dir__.__self__ is text, wide.__dir__.__qualname__)
view = memoryview(bytearray(b"ab"))
memory = iter(view)
print("layouts", len(dir(iter({7}))), len(dir(memory)), "__length_hint__" in dir(memory))

class Indexed:
    def __getitem__(self, index):
        if index >= 2: raise IndexError
        return index+7

value = Indexed()
indexed = iter(value)
value.saved = indexed
retained = object.__dir__.__get__(indexed)
del indexed
del value
del Indexed
print("retained", len(retained()), next(retained.__self__))

values = iter((7, 9, 0))
def produce(): return next(values)
calls = iter(produce, 0)
print("callable", len(dir(calls)), next(calls), next(calls), next(calls, None))
results = (dir(item) for item in (cursor, memory, calls))
print("lazy", len(dir(results)), len(next(results)), len(next(results)), len(next(results)))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/iterator-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/iterator-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Iterator Directory Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
