"""Build a checkout console demonstrating function and property documentation."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''def labelled(fn):
    print("document", fn.__doc__)
    return fn

class Note:
    "An ordinary note."
    def __init__(self, value): self.value = value
    @property
    @labelled
    def text(self):
        "The current text."
        return self.value

note = Note("draft")
original = Note.text
original.__doc__ = ["manual"]
def write(obj, value): obj.value = value
copy = original.setter(write)
copy.__set__(note, "revised")
print("refresh", original.__doc__[0], copy.__doc__, note.text)

manual = ["explicit"]
explicit = property(original.fget, doc=manual)
def replacement(obj):
    "A replacement getter."
    return obj.value
copied = property.getter.__get__(explicit)(replacement)
print("explicit", copied.__doc__ is manual, copied.__get__(note))

ready = False
class Getter:
    @property
    def __doc__(self):
        print("lookup")
        if ready: dynamic.__name__ = "updated"
        return ["dynamic"]
dynamic = property(Getter())
dynamic.__name__ = "initial"
ready = True
copy = dynamic.setter(None)
print("name", copy.__name__, dynamic.__name__)
def documents():
    yield copied.__doc__[0]
    yield copy.__doc__[0]
print("ready")
for text in documents(): print("lazy", text)
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/documentation-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/documentation-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Documentation Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
