"""Build a checkout console demonstrating default function directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Reader:
    def read(self): return "ready"

reader = Reader()
retained = reader.read
function = vars(Reader)["read"]
initial = dir(function)
function.tag = [7]
expanded = dir(retained.__func__)
print("live", "tag" in initial, "tag" in expanded, function is retained.__func__)
function.__dict__ = {"fresh": [9]}

def names():
    yield dir(function)

current = next(names())
print("snapshots", "tag" in expanded, "tag" in current, "fresh" in current)
native = object.__dir__.__get__(function)
raw = native()
print("native", raw[0], "__code__" in raw, native.__self__ is function)
function.__dir__ = lambda: ["explicit"]
print("lookup", function.__dir__()[0], "__code__" in dir(function))
print("retained", retained(), len(function.__dict__))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/function-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/function-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Function Directory Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
