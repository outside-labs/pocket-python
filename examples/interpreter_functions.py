"""Build a checkout console demonstrating defaults, lexical state and forwarding."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
CORE_SOURCE = '''creations = 0

def make_counter(start=0):
    global creations
    creations += 1
    value = start

    def advance(*steps, scale=1, history=[]):
        nonlocal value
        for step in steps:
            value += step * scale
        history.append(value)
        return value, history

    return advance

advance = make_counter(1)
first = advance(*range(1, 4), **{"scale": 3})
second = advance(2)
print(first[0], second[0], first[1] is second[1], len(second[1]), creations)

def forward(fn, *args, **kwargs):
    return fn(*args, **kwargs)

third = forward(advance, *[1], **{"scale": 2})
print(third[0], len(third[1]))
'''
SOURCE = CORE_SOURCE.replace('advance = make_counter(1)', '''class Options:
    def keys(self):
        return ["scale"]

    def __getitem__(self, key):
        return 3

advance = make_counter(1)''').replace('**{"scale": 3}', '**Options()')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/functions-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/functions-console'))
    parser.add_argument('--core', action='store_true', help='Use primitive dictionary forwarding in the core profile.')
    args = parser.parse_args()
    profile = 'core-source/1' if args.core else 'classes-source/1'
    receipt = build_interpreter(write_source(args.source, source=CORE_SOURCE if args.core else SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output, language_profile=profile,
                                title='Python Function Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
