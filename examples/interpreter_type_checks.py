"""Build a checkout console demonstrating owned custom type checking."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Decision:
    def __init__(self, accepted): self.accepted = accepted
    def __bool__(self): return self.accepted

class Checker:
    def __get__(self, cls, owner):
        def matches(value): return Decision(getattr(value, "kind", None) == "note")
        return matches

class NoteType(type):
    __instancecheck__ = Checker()
    def __subclasscheck__(cls, child):
        return Decision(getattr(child, "kind", None) == "note")

class Note(metaclass=NoteType): pass

class Record:
    kind = "note"
    def values(self):
        yield 7
        yield 8

record = Record()
print("virtual", isinstance(record, ((Note,),)), issubclass(Record, Note))
print("actual", type.__instancecheck__(Note, record),
      type.__subclasscheck__(Note, Record), isinstance(Note(), Note))
stream = record.values()
print("values", next(stream), next(stream), type(record) is Record)
stream.close()
print("native", type(type.__instancecheck__).__name__,
      type(Record.__instancecheck__).__name__, type.__instancecheck__.__name__)
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/type-check-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/type-check-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Type Checking Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
