"""Build a checkout console demonstrating construction, super and metaclasses."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class ModelType(type):
    def __new__(meta, name, bases, namespace):
        namespace["category"] = "offline"
        return super().__new__(meta, name, bases, namespace)

class Base(metaclass=ModelType):
    def __new__(cls, value):
        instance = super().__new__(cls)
        instance.original = value
        return instance
    def __init__(self, value): self.value = value

class Note(Base):
    def __init__(self, value): super().__init__(value + 1)
    def values(self):
        yield self.original
        yield self.value
        yield __class__.__name__

note = Note(4)
print("construction", type(note) is Note, isinstance(Note, ModelType), Note.category)
stream = note.values()
print("values", next(stream), next(stream), next(stream))
stream.close()
Temporary = type("Temporary", (Base,), {})
print("dynamic", type(Temporary) is ModelType, Temporary.category)
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/construction-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/construction-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Construction Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
