"""Build a checkout console demonstrating explicit native descriptor operations."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Score:
    def __init__(self, value): self.value = value
    def read(self): return self.value
    def write(self, value):
        if value < 0: raise ValueError("negative score")
        self.value = value
        return 99
    def remove(self):
        self.value = 0
        return 99
    field = property(read, write, remove)

record = Score(7)
field = Score.field
read = field.__get__
write = field.__set__
print("field", read(record), write(record, 9), record.field)
try: write(record, -1)
except ValueError: print("preserved", read(record))
print("class", property.__get__(field, None, Score) is field)
print("removed", field.__delete__(record), record.field)

factory = classmethod(lambda cls, value: cls(value))
create = factory.__get__(record)
copy = create(11)
display = staticmethod(lambda value: "score:" + str(value))
format_score = staticmethod.__get__(display, None, Score)
print("factory", create.__self__ is Score, format_score(copy.field))
owner = [13]
bound = classmethod(lambda data: data).__get__(None, owner)
print("owner", bound() is owner, bound()[0])
print("method", type(read).__name__, read.__self__ is field, read.__qualname__)
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/native-descriptor-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/native-descriptor-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Descriptor Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
