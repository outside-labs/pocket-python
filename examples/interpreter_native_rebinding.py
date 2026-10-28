"""Build a checkout console demonstrating explicit native descriptor rebinding."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Meta(type):
    def __instancecheck__(cls, obj): return False

class Score(metaclass=Meta):
    def __init__(self, value): self.value = value
    def read(self): return self.value
    def write(self, value): self.value = value
    field = property(read, write)

record = Score(7)
get_class = type.__getattribute__.__get__(Score, False)
field = get_class("field")
copy = type(property.getter).__get__.__get__(property.getter)(field)
field = copy(None)
read = property.__get__.__get__(field)
write = property.__set__.__get__(field)
print("field", read(record), field is Score.field, field.fget is Score.read)
write(record, 11)
print("updated", read(record))
check = type.__instancecheck__.__get__(Score)
print("native check", check(record), isinstance(record, Score))
print("handles", type(copy).__name__, type(read).__name__, read.__self__ is field)

def factory():
    captured = [9]
    def read(obj, extra=[3]): return obj[0] + captured[0] + extra[0]
    return type(read).__get__.__get__(read)
bind = factory()
read = bind([5], False)
del bind
print("closure", read())

def entries(obj):
    print("entered")
    yield obj[0]
bind = type(entries).__get__.__get__(entries)
items = bind([13])()
del bind
print("ready")
print("item", next(items))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/native-rebinding-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/native-rebinding-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Descriptor Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
