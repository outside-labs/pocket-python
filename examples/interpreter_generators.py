"""Build a checkout console demonstrating generators and object protocols."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
CORE_SOURCE = '''def squares(limit):
    try:
        for number in range(limit):
            yield number * number
    finally:
        print("finished")

odd = [number for number in squares(5) if number % 2]
print("odd squares", len(odd), odd[0], odd[1])
stream = (number + 10 for number in range(3))
print("stream", next(stream), stream.send(None))
stream.close()

def child():
    value = yield 2
    return value + 3

def parent():
    result = yield from child()
    yield result

stream = parent()
print("delegation", next(stream), stream.send(4))
stream.close()
'''
SOURCE = CORE_SOURCE + '''
class Counter:
    def __init__(self, value): self.value = value
    def __add__(self, other): return Counter(self.value + other)
    def __radd__(self, other): return self + other
    def __iadd__(self, other):
        self.value += other
        return self
    @property
    def label(self): return str(self.value)

counter = Counter(4)
alias = counter
counter += 3
print("counter", counter is alias, getattr(counter, "label"), (2 + counter).value)
print("attributes", hasattr(counter, "missing"), getattr(counter, "missing", 9))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/generators-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/generators-console'))
    parser.add_argument('--core', action='store_true', help='Use generators without class protocols.')
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=CORE_SOURCE if args.core else SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='core-source/1' if args.core else 'classes-source/1',
                                title='Python Generators Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
