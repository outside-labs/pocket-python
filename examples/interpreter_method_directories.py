"""Build a checkout console demonstrating bound Python method directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Reader:
    def read(self): return "ready"

method = Reader().read
function = method.__func__
initial = dir(method)
function.tag = [7]
expanded = dir(method)
print("live", "tag" in initial, "tag" in expanded, "__func__" in expanded)
function.__dict__ = {"fresh": [9]}

def names():
    yield dir(method)

current = next(names())
print("snapshots", "tag" in expanded, "tag" in current, "fresh" in current)
native = method.__dir__
del method
del Reader
raw = native()
print("native", raw[0], native.__qualname__, native.__self__.__func__ is function)
function.__dir__ = lambda: ["explicit"]
print("lookup", function.__dir__()[0], "__func__" in native())
print("retained", native.__self__(), len(function.__dict__))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/method-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/method-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Method Directory Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
