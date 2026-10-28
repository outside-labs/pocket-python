"""Build a checkout console demonstrating bound field hooks and validation."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''events = []
class NameBinder:
    def __get__(self, field, owner):
        def notify(cls, name):
            field.name = name
            events.append("name:" + name)
        return notify

class Field:
    __set_name__ = NameBinder()
    def __get__(self, obj, owner):
        if obj is None: return self
        return getattr(obj, "_" + self.name, 0)
    @property
    def __set__(self):
        key = "_" + self.name
        def store(obj, value):
            if value < 0: raise ValueError("negative field")
            setattr(obj, key, value)
            events.append("set:" + self.name)
            return 99
        return store
    @property
    def __delete__(self):
        key = "_" + self.name
        def remove(obj):
            delattr(obj, key)
            events.append("delete:" + self.name)
            return 99
        return remove

class Record:
    score = Field()

record = Record()
record.score = 7
print("field", Record.score.name, record.score, events[0])
try: record.score = -1
except ValueError: print("preserved", record.score)

def scores():
    yield record.score
    yield record.score
stream = scores()
first = next(stream)
print("native", object.__setattr__(record, "score", 9), first, next(stream))
stream.close()
del record.score
print("removed", record.score, len(events), events[-1])
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/nested-descriptor-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/nested-descriptor-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Field Hooks Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
