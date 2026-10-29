"""Build a checkout console demonstrating ordinary instance directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Base:
    inherited = 7
class Note(Base):
    def __init__(self, text): self.text = text

note = Note("local")
note.saved = note
native = note.__dir__
print("instance", "text" in dir(note), "inherited" in native(), native.__self__ is note)
first = dir(note)
note.added = 9
Note.changed = 8
print("live", "added" in dir(note), "added" in first, "changed" in dir(note))
old = note.__dict__
note.__dict__ = {"replacement": 10}
print("replace", "replacement" in native(), "text" in dir(note), old["saved"] is note)
class View:
    @property
    def __dict__(self): return {"virtual": 11}
    @property
    def __class__(self): return Base
view = View()
print("virtual", "virtual" in dir(view), "inherited" in dir(view))
class Custom:
    def __dir__(self): return ("z", "a")
custom = Custom()
print("custom", *dir(custom))
print("native", "__class__" in object.__dir__(custom))
print("lazy", *("__class__" in dir(value) for value in (object(), note, custom)))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/instance-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/instance-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Instance Directory Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
