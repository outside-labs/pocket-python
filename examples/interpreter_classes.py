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

    def __call__(self, amount):
        return self.add(amount)

    def __len__(self):
        return self.value

    def __bool__(self):
        return self.value > 0

    def __index__(self):
        return self.value

    def __repr__(self):
        return type(self).__name__ + "(" + str(self.value) + ")"

    def __str__(self):
        return "Count " + str(self.value)

class StepCounter(Counter):
    def twice(self, amount):
        return self(self.doubled(amount))

counter = StepCounter.from_start(1)
print("Count:", counter.twice(3))
print("Class:", type(counter).__name__)
print("Callable:", callable(counter))
print("Length:", len(counter), "Active:", bool(counter))
print("Display:", counter)
print("Representation:", repr(counter))
empty = StepCounter.from_start(0)
print("Empty:", "yes" if not empty else "no")

class Shelf:
    def __init__(self, items):
        self.__items = items

    def __getitem__(self, key):
        return self.__items[key]

    def __setitem__(self, key, value):
        self.__items[key] = value

    def __delitem__(self, key):
        del self.__items[key]

    def __len__(self):
        return len(self.__items)

shelf = Shelf([10, 20, 30])
index = Counter.from_start(1)
shelf[index] += 5
shelf[::2] = (7, 9)
del shelf[-1]
print("Indexed:", shelf[0], shelf[index], "Size:", len(shelf))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/class-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/class-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE), read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Class Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
