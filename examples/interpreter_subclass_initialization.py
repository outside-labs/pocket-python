"""Build a checkout console demonstrating inherited class registration."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''registered = []
class Field:
    def __set_name__(self, owner, name): owner.field_name = name

class Record:
    def __init_subclass__(cls, *, kind, **kwargs):
        super().__init_subclass__(**kwargs)
        cls.kind = kind
        registered.append(cls)

class Revision:
    def __init_subclass__(cls, *, revision):
        super().__init_subclass__()
        cls.revision = revision

class Note(Record, Revision, kind="note", revision=2):
    title = Field()
    def identity(self): return __class__

print("registered", len(registered), registered[0] is Note)
print("schema", Note.kind, Note.revision, Note.field_name, Note().identity() is Note)

class Meta(type):
    def __new__(meta, name, bases, namespace, **kwargs):
        cls = type.__new__(meta, name, bases, namespace, **kwargs)
        cls.source = "dynamic"
        return cls

Draft = Meta("Draft", (Record,), {}, kind="draft")
print("dynamic", len(registered), registered[1] is Draft, Draft.kind, Draft.source)
def names():
    for cls in registered: yield cls.__name__
stream = names()
print("names", next(stream), next(stream))
stream.close()
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/subclass-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/subclass-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Class Registration Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
