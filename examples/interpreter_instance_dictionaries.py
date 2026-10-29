"""Build a checkout console demonstrating live instance state dictionaries."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Note:
    def __init__(self, title):
        self.title = title
        self.edits = 0
    @property
    def label(self): return self.title + ":" + str(self.edits)
    def rename(self, title):
        self.title = title
        self.edits += 1
        return self.label
    def labels(self):
        yield self.label
        yield self.title

note = Note("draft")
retained = note.rename
saved = vars(note)
saved["title"] = "review"
print("live", note.label, saved is note.__dict__)
note.__dict__ = {"title": "replaced", "edits": 10}
print("retained", retained("published"), saved["title"], saved["edits"])
old = note.__dict__
del note.__dict__
print("detached", old["title"], len(vars(note)))
note.__dict__ = {"title": "fresh", "edits": 0}
for label in note.labels(): print("lazy", label)

class Reading: pass
reading = Reading()
class Key:
    def __hash__(self): return hash("tag")
    def __eq__(self, other):
        reading.__dict__ = {"fresh": 11}
        print("collision", other)
        return True
key = Key()
original = {key: [7]}
reading.__dict__ = original
print("snapshot", reading.tag[0], reading.fresh, original[key][0])
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/instance-dictionaries-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/instance-dictionaries-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Instance Dictionary Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
