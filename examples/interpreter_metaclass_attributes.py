"""Build a checkout console demonstrating class metadata and audited mutation."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''events = []
class Registry(type):
    def __getattribute__(cls, name):
        if name == "version": return type.__getattribute__(cls, "revision")
        return super().__getattribute__(name)
    def __getattr__(cls, name):
        if name == "label": return cls.kind + "-draft"
        raise AttributeError(name)
    def __setattr__(cls, name, value):
        events.append("set:" + name)
        return type.__setattr__(cls, name, value)
    def __delattr__(cls, name):
        events.append("delete:" + name)
        return super().__delattr__(name)

class Record(metaclass=Registry):
    def __init_subclass__(cls, *, kind):
        super().__init_subclass__()
        cls.kind = kind

class Note(Record, kind="note"):
    revision = 1

Note.revision = 2
Note.temporary = [7]
del Note.temporary
print("schema", Note.__name__, Note.label, Note.version, type(Note) is Registry)
print("audit", len(events), events[0], events[-1], hasattr(Note, "temporary"))

def versions():
    yield Note.version
    yield Note.version
stream = versions()
first = next(stream)
Note.revision = 3
print("versions", first, next(stream))
stream.close()
reader = super(Registry, Note).__getattribute__
print("native", reader("revision"), reader.__self__ is Note, type(reader).__name__)
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/metaclass-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/metaclass-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Class Metadata Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
