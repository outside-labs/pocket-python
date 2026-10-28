"""Build a checkout console demonstrating accessor copies and explicit function binding."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Score:
    def __init__(self, value): self.value = value
    def read(self): return self.value
    def write(self, value): self.value = value
    field = property.setter(property(read), write)

record = Score(7)
field = property.getter(Score.field, None)
print("copy", field is Score.field, field.fget is Score.read, field.__get__(record))
field.__set__(record, 11)
print("updated", record.field)

bind = Score.read.__get__
method = bind(record, False)
print("bound", method.__self__ is record, method.__func__ is Score.read, method == record.read, method())

def factory():
    captured = [9]
    def read(obj, extra=[3]): return obj[0] + captured[0] + extra[0]
    return read.__get__
bind = factory()
read = bind([5])
del bind
print("closure", read())

def entries(obj):
    print("entered")
    yield obj[0]
iterate = entries.__get__([13])
items = iterate()
del iterate
print("ready")
print("item", next(items))
print("native", field.getter.__qualname__, type(Score.read.__get__).__name__)
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/descriptor-binding-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/descriptor-binding-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Binding Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
