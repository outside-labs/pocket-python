"""Build a checkout console demonstrating live decorator dictionaries."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''def tracked(function):
    def wrapped(self, amount):
        wrapped.calls += 1
        return function(self, amount)
    wrapped.calls = 0
    wrapped.label = ["tracked"]
    setattr(wrapped, "__wrapped__", function)
    return wrapped

class Counter:
    def __init__(self): self.value = 0
    @tracked
    def add(self, amount):
        self.value += amount
        return self.value

counter = Counter()
retained = counter.add
saved = vars(Counter.add)
print("count", retained(3), retained(4), retained.calls, retained.label[0])
print("shared", retained.__dict__ is saved, retained.__wrapped__(counter, 2))
Counter.add.__dict__ = {"calls": 20, "label": ["replaced"]}
print("replacement", retained(1), retained.calls, retained.label[0], saved["calls"])
retained.__dict__["note"] = ["live"]
print("alias", Counter.add.note is retained.note)

class Key:
    def __hash__(self): return hash("tag")
    def __eq__(self, other):
        print("collision", other)
        return other == "tag"
def read(): pass
read.__dict__ = {Key(): [7]}
print("lookup", read.tag[0])

def labels():
    yield retained.label[0]
    yield retained.note[0]
for label in labels(): print("lazy", label)
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/function-dictionaries-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/function-dictionaries-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Function Dictionary Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
