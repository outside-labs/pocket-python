"""Build a checkout console demonstrating class namespace view directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Reader:
    def read(self): return "ready"

view = Reader.__dict__
method = Reader().read
native = view.__dir__
initial = dir(view)
Reader.tag = [7]
method.__func__.custom = [9]
print("names", initial == dir(view), "tag" in dir(view), "custom" in dir(method))
print("stored", view["read"] is method.__func__, view["tag"][0])

def names():
    yield dir(view)
    yield dir(method)

stream = names()
print("lazy", "copy" in next(stream), "__func__" in next(stream))
Reader.saved = view
del Reader
del view
raw = native()
print("native", raw[0], native.__qualname__, len(raw))
print("retained", native.__self__["saved"] is native.__self__, method())
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/namespace-view-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/namespace-view-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Namespace View Directory Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
