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

    def __int__(self):
        return self.value

    def __float__(self):
        return self.value / 2

    def __complex__(self):
        return complex(self.value, 1)

    def __abs__(self):
        return abs(self.value)

    def __round__(self, ndigits=None):
        return round(self.value, ndigits)

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

    def __iter__(self):
        return Cursor(self.__items)

    def __contains__(self, item):
        return item in self.__items

class Cursor:
    def __init__(self, items):
        self.__items = items
        self.__position = 0

    def __iter__(self):
        return self

    def __next__(self):
        if self.__position == len(self.__items):
            raise StopIteration
        item = self.__items[self.__position]
        self.__position += 1
        return item

shelf = Shelf([10, 20, 30])
index = Counter.from_start(1)
shelf[index] += 5
shelf[::2] = (7, 9)
del shelf[-1]
print("Indexed:", shelf[0], shelf[index], "Size:", len(shelf))
for item in shelf:
    print("Item:", item)
print("Contains:", 25 in shelf, 9 not in shelf)
cursor = iter(shelf)
print("Next:", next(cursor), next(cursor), next(cursor, "done"))

class Label:
    def __init__(self, name):
        self.__name = name

    def __eq__(self, other):
        if not isinstance(other, Label):
            return NotImplemented
        return self.__name == other.__name

    def __hash__(self):
        return hash(self.__name)

first = Label("alpha")
same = Label("alpha")
labels = {first: 3}
labels[same] = 7
print("Equal:", first == same, first != Label("beta"))
print("Key:", labels[same], "Count:", len(labels))
print("Original key:", next(iter(labels)) is first)

mask = (1 << 8) - 1
print("Bits:", hex(mask), mask & 7, ~7, 2**3**2)
parts = divmod(-7, 3)
print("Numbers:", parts[0], parts[1], pow(3, -1, 11), round(250, -2))
print("Real checks:", (10**400)/(10**400) == 1.0, round(2.675, 2) == 2.67)
print("Unicode:", ord(chr(128013)))
print("Conversion:", int(counter), float(counter) == 3.5, complex(counter) == 7+1j)
print("Hooks:", abs(counter), round(counter), bin(counter))
print("Constructors:", int("0x_ff", 0), float("١.٢٥") == 1.25, complex("3+4j") == 3+4j)
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/class-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/class-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE), read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Class Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
