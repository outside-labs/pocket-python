"""Build a checkout console demonstrating property name inspection."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Score:
    def __init__(self, value): self.value = value
    def read(self): return self.value
    field = property(read)

record = Score(7)
original = Score.field
copy = original.getter(None)
copy.__set_name__(Score, "snapshot")
print("names", original.__name__, copy.__name__, copy.__get__(record))
label = ["score", 9]
copy.__name__ = label
print("identity", copy.__name__ is label)
del copy.__name__
print("fallback", copy.__name__)
notify = property.__set_name__.__get__(copy)
print("native", type(notify).__name__, notify.__self__ is copy)
notify(None, "detached")
print("independent", original.__name__, copy.__name__)

class Getter:
    @property
    def __name__(self):
        print("lookup")
        return "lazy"
lazy = property(Getter())
def names():
    yield original.__name__
    yield copy.__name__
    yield lazy.__name__
for name in names(): print("field", name)
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/property-names-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/property-names-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Property Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
