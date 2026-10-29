"""Build a checkout console demonstrating numeric and singleton directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''values = (None, NotImplemented, True, 7, 2.5, 2+3j)
for value in values:
    names = dir(value)
    native = value.__dir__
    print(type(value).__name__, len(names), native.__qualname__)
    print("fresh", names is dir(value), native() == object.__dir__(value))

print("boolean", dir(True) == dir(7))
print("singletons", len(dir(None)), len(dir(NotImplemented)))
number = 10**30+7
retained = object.__dir__.__get__(number)
del number
print("retained", retained.__self__ == 10**30+7, len(retained()))
nested = (2+3j).__dir__.__dir__
print("nested", len(nested()), nested.__self__.__self__ == 2+3j)
results = (len(dir(value)) for value in values)
print("lazy", *results)
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/numeric-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/numeric-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Numeric Directory Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
