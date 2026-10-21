"""Build the explicit class console from checkout-owned sources."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Counter:
    def __init__(self, start=0):
        self.__value = start

    @classmethod
    def from_start(cls, start):
        return cls(start)

    @property
    def value(self):
        return self.__value

    @value.setter
    def value(self, amount):
        self.__value = amount

    @staticmethod
    def doubled(amount):
        return amount * 2

    def add(self, amount):
        self.value += amount
        return self.value

class StepCounter(Counter):
    def twice(self, amount):
        return self.add(self.doubled(amount))

counter = StepCounter.from_start(1)
print("Count:", counter.twice(3))
print("Class:", type(counter).__name__)
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/class-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/class-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE), read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Class Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
