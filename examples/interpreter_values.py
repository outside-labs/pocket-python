"""Build a checkout console demonstrating sets, binary sequences and buffer views."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
CORE_SOURCE = '''items = [1, 2, 2]
records = set(items)
print("sets", len(records), 2 in records, frozenset(records) == {1, 2})

storage = bytearray("café", "utf-8")
view = memoryview(storage)
view[0] = ord(b"C")
tail = view[1:]
view.release()
print("text", storage.decode(), tail.tobytes().decode(), tail.readonly)

reverse = memoryview(b"ABC")[::-1]
print("view", reverse.tobytes().decode(), reverse.shape[0], reverse.strides[0])
'''
SOURCE = CORE_SOURCE.replace('items = [1, 2, 2]', '''class Key:
    def __init__(self, number): self.number = number
    def __hash__(self): return self.number
    def __eq__(self, other):
        if isinstance(other, Key): return self.number == other.number
        return self.number == other

items = [Key(1), Key(2), Key(2)]''')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/values-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/values-console'))
    parser.add_argument('--core', action='store_true', help='Use primitive keys in the core profile.')
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=CORE_SOURCE if args.core else SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='core-source/1' if args.core else 'classes-source/1',
                                title='Python Values Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
