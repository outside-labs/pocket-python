"""Build a checkout console demonstrating descriptor abstract flags."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''def marked(fn):
    fn.__isabstractmethod__ = True
    return fn

class Score:
    def __init__(self, value): self.value = value
    @property
    @marked
    def field(self): return self.value

record = Score(7)
original = Score.field
print("property", original.__name__, original.__isabstractmethod__, record.field)
static = staticmethod(original.fget)
class_method = classmethod(original.fget)
print("wrappers", static.__isabstractmethod__, class_method.__isabstractmethod__)
del original.fget.__isabstractmethod__
print("live", original.__isabstractmethod__, static.__isabstractmethod__, class_method.__isabstractmethod__)

def write(obj, value): obj.value = value
write.__isabstractmethod__ = ["required"]
copy = original.setter(write)
copy.__set__(record, 9)
print("copy", original.__isabstractmethod__, copy.__isabstractmethod__, record.field)

class Truth:
    def __bool__(self):
        print("truth")
        return True
class Flag:
    @property
    def __isabstractmethod__(self):
        print("lookup")
        return Truth()
lazy = classmethod(staticmethod(property(Flag())))
def flags():
    yield copy.__isabstractmethod__
    yield lazy.__isabstractmethod__
print("ready")
for value in flags(): print("flag", value)
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/abstract-flags-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/abstract-flags-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Descriptor Flags Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
