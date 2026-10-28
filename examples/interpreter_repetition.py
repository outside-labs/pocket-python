"""Build a checkout console demonstrating owned sequence repetition."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Count:
    def __init__(self, value): self.value = value
    def __index__(self): return self.value

shared = [[]] * Count(3)
shared[0].append("saved")
copies = [item[:] for item in shared]
copies[0].append("local")
print("copies", shared[0] is shared[2], len(shared[1]), len(copies[0]), len(copies[1]))

schedule = ("run", "save") * Count(2)
def events():
    for label in schedule: yield label
stream = events()
print("events", next(stream), next(stream), next(stream), next(stream))
stream.close()
banner = "😀-" * Count(3)
print("banner", len(banner), banner[4] == "😀")

notes = ["start"]
class GrowingCount:
    def __index__(self):
        notes.append("finish")
        return 2
repeated = notes * GrowingCount()
print("mutation", len(notes), len(repeated), repeated[1], repeated[3])
alias = shared
shared *= Count(2)
print("inplace", shared is alias, len(alias), alias[0] is alias[3])
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/repetition-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/repetition-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Repetition Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
