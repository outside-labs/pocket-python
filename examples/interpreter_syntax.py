"""Build a checkout console demonstrating ordinary source expressions and targets."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
CORE_SOURCE = '''def adjustment(scale=2):
    return lambda value: value * scale

def summarize(rows, transform=lambda value: value):
    result = []
    for label, *values in rows:
        assert values, "each row needs a value"
        total = 0
        for value in values:
            total += transform(value)
        result.append((label, total))
    return result

rows = [("alpha", 1, 2), ("beta", 3)]
scores = summarize(rows, adjustment())
combined = {**{"alpha": 0}, **{scores[0][0]: scores[0][1]}, scores[1][0]: scores[1][1]}
assert (count := len(scores)) == 2, "two rows expected"
for name, total in scores:
    print(name, total)
values = (*combined, "done")
first, *middle, last = values
print(count, first, len(middle), last)
'''
SOURCE = CORE_SOURCE.replace('rows = [("alpha", 1, 2), ("beta", 3)]', '''class Rows:
    def __iter__(self):
        return iter([("alpha", 1, 2), ("beta", 3)])

rows = Rows()''')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/syntax-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/syntax-console'))
    parser.add_argument('--core', action='store_true', help='Use ordinary row values in the core selection.')
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=CORE_SOURCE if args.core else SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='core-source/1' if args.core else 'classes-source/1',
                                title='Python Syntax Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
