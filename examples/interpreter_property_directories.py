"""Build a checkout console demonstrating property directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''def read(self):
    """A stored reading."""
    return self.value

def write(self, value):
    self.value = value

field = property(read)
copy = field.setter(write)
class Reader:
    reading = copy

item = Reader()
item.reading = 7
names = dir(copy)
print("layout", len(names), "fget" in names, "reading" in names)
print("copies", dir(field) == names, copy.fset is write, item.reading)
copy.__name__ = [9]
copy.__doc__ = {"label": [11]}
print("metadata", dir(copy) == names, copy.__name__[0], copy.__doc__["label"][0])

def snapshots():
    yield dir(copy)
    yield object.__dir__(copy)

stream = snapshots()
print("lazy", next(stream) == names, next(stream)[0])
read.saved = copy
native = copy.__dir__
del copy
del field
del Reader
del read
print("retained", native.__self__.fget.saved is native.__self__, len(native()), native.__qualname__)
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/property-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/property-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Property Directory Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
