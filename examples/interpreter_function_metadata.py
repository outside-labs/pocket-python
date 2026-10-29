"""Build a checkout console demonstrating live function identity metadata."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''__name__ = "notes"
class Note:
    def __init__(self, text): self.text = text
    def read(self):
        "Read the current note."
        return self.text

note = Note("draft")
retained = note.read
original_module = Note.read.__module__
Note.read.__name__ = "display"
Note.read.__qualname__ = "Note.display"
Note.read.__module__ = [Note.read, original_module]
print("method", retained.__name__, retained.__qualname__, retained())
print("identity", retained.__func__ is Note.read, retained.__self__ is note)
print("module", retained.__module__[0] is Note.read, retained.__module__[1])

field = property(Note.read)
print("property", field.__name__, field.__doc__, field.__get__(note))
class Callable: pass
custom = classmethod(Callable()).__get__(None, Note)
def metadata(self, name):
    print("lookup", name)
    return ["dynamic"]
Callable.__getattribute__ = metadata
print("custom", custom.__qualname__[0])

def labels():
    yield retained.__name__
    yield retained.__module__[1]
print("ready")
for label in labels(): print("lazy", label)
del Note.read.__module__
print("deleted", retained.__module__)
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/function-metadata-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/function-metadata-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Function Metadata Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
