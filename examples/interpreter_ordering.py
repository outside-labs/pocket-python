"""Build a checkout console demonstrating owned ordering and slice comparison."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Decision:
    def __init__(self, accepted): self.accepted = accepted
    def __bool__(self): return self.accepted

class Note:
    def __init__(self, priority, title):
        self.priority = priority
        self.title = title
    def __eq__(self, other): return self.priority == other.priority
    def __lt__(self, other): return self.priority < other.priority
    def __le__(self, other): return Decision(self.priority <= other.priority)
    def __gt__(self, other): return self.priority > other.priority
    def __ge__(self, other): return self.priority >= other.priority

def insert(notes, note):
    position = 0
    while position < len(notes) and notes[position] <= note:
        position += 1
    notes[position:position] = [note]

notes = [Note(3, "save")]
insert(notes, Note(1, "offline"))
insert(notes, Note(2, "review"))

def titles(notes):
    for note in notes: yield note.title

stream = titles(notes)
print("queue", next(stream), next(stream), next(stream))
stream.close()
print("prefix", [notes[0]] < notes, tuple(notes) > (notes[0],))
print("slice", slice(notes[0], 3) < slice(notes[1], 3),
      slice(notes[0]) == slice(Note(1, "same priority")))
decision = notes[0] <= notes[1]
print("decision", type(decision) is Decision, bool(decision))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/ordering-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/ordering-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Ordering Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
