"""Build a checkout console demonstrating ordinary class directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Base:
    inherited = 7
class Note(Base):
    marker = 8
    def __dir__(self): return ("z", "a")

note = Note()
note.only_instance = 9
first = dir(Note)
native = type.__dir__.__get__(Note)
print("class", "marker" in first, "inherited" in first, "only_instance" in first)
print("native", native.__self__ is Note, native.__name__, native.__qualname__)
print("instance", *dir(note))
print("bypass", "only_instance" in object.__dir__(note))
Note.later = 10
del Note.marker
print("live", "marker" in first, "marker" in native(), "later" in native())
Note.saved = Note
del Note
del note
print("retained", native.__self__.saved is native.__self__, "inherited" in native())
print("lazy", *("__class__" in dir(cls) for cls in (object, Base, native.__self__)))
class Meta(type):
    def __dir__(cls): return ("custom",)
class Custom(metaclass=Meta): pass
print("metaclass", *dir(Custom))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/class-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/class-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Class Directory Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
