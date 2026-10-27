"""Build a checkout console demonstrating identities and namespace snapshots."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Record:
    def __init__(self, title, revision):
        self.title = title
        self.revision = revision
    @property
    def __dict__(self):
        return {"title": self.title, "revision": self.revision}
    def __dir__(self):
        yield "title"
        yield "revision"

def inspect(record):
    alias = record
    before = locals()
    record.revision += 1
    names = dir(record)
    print("same", id(record) == id(alias), before["record"] is record)
    print("fields", names[0], names[1], vars(record)["revision"])
    before["alias"] = None
    print("snapshot", alias is record, "before" in before, "names" in dir())

inspect(Record("offline", 1))

class Decision:
    def __init__(self, value): self.value = value
    def __bool__(self): return self.value

class Field:
    def __init__(self, name, order): self.name = name; self.order = order
    def __lt__(self, other): return Decision(self.order < other.order)

class Fields:
    def __init__(self, entries): self.entries = entries
    def __iter__(self): return iter(self.entries)
    def __len__(self): raise TypeError("use the advisory hint")
    def __length_hint__(self): return 0

class View:
    def __dir__(self): return Fields([Field("title", 2), Field("revision", 1)])

columns = dir(View())
print("ordered", columns[0].name, columns[1].name)
snapshots = (locals() for field in columns)
first = next(snapshots)
second = next(snapshots)
snapshots.close()
print("scope", list(first) == [".0", "field"], first[".0"] is second[".0"], first["field"] is columns[0])
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/reflection-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/reflection-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Reflection Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
