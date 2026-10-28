"""Build a checkout console demonstrating type hierarchy inspection."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Counted:
    count = 1

class Named:
    label = "score"

class Score(Counted, Named):
    def __init__(self, value): self.value = value
    def read(self): return self.value
    field = property(read)

record = Score(7)
hierarchy = Score.mro()
print("hierarchy", hierarchy == [Score, Counted, Named, object])
print("base", Score.__base__ is Counted, object.__base__ is None)
read = Score.field.__get__
print("owners", type.mro.__objclass__ is type, read.__objclass__ is property)
print("field", read(record), hasattr(Score.mro, "__objclass__"))
inspect = type.mro.__get__(Score)
snapshot = inspect()
snapshot.append(int)
print("snapshot", len(snapshot), len(inspect()), list(Score.__mro__) == inspect())

def make():
    class Root: saved = [9]
    class Leaf(Root): pass
    return Leaf.mro
detached = make()
print("detached", detached()[1].saved[0], detached.__name__)

def names(inspect):
    for cls in inspect(): yield cls.__name__
for name in names(Score.mro): print("class", name)
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/type-reflection-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/type-reflection-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Hierarchy Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
