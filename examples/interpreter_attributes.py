"""Build a checkout console demonstrating owned instance attribute hooks."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class View: pass

class Record:
    def __getattribute__(self, name):
        if name == "display": return object.__getattribute__(self, "value") + 1
        return object.__getattribute__(self, name)
    def __getattr__(self, name):
        if name == "label": return "offline"
        raise AttributeError(name)
    def __setattr__(self, name, value): object.__setattr__(self, name, value)
    def __delattr__(self, name): object.__delattr__(self, name)
    @property
    def __class__(self): return View
    def values(self):
        yield self.display
        yield self.label

record = Record()
record.value = 7
stream = record.values()
print("attributes", next(stream), next(stream))
stream.close()
print("identity", type(record) is Record, isinstance(record, View),
      super(View, record).__self_class__ is View)
del record.value
print("missing", getattr(record, "value", None) is None, hasattr(record, "value"))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/attribute-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/attribute-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Attribute Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
