"""Build a checkout console demonstrating iterator type directories directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''def generate():
    print("body")
    yield 7
    yield 9
generator = generate()
print("created", len(dir(type(generator))))
print("first", next(generator))
print("suspended", len(type.__dir__(type(generator))))
generator.close()
print("closed", len(dir(type(generator))))
items = [7, 9]
iterator = iter(items)
native = type.__dir__.__get__(type(iterator))
print("position", next(iterator), len(native()))
items.append(11)
print("mutation", next(iterator), next(iterator))
storage = bytearray(b"abc")
view = memoryview(storage)
iterator = iter(view)
cls = type(iterator)
view.release()
print("released", len(dir(cls)), dir(cls) == dir(iterator))
try: next(iterator)
except ValueError: print("data unavailable")
def forbidden(): raise RuntimeError("call")
iterator = iter(forbidden, 7)
native = type.__dir__.__get__(type(iterator))
del iterator
print("detached", len(native()), native.__qualname__)
values = (iter([]), iter(()), iter("abc"), iter("😀"), iter({}), iter(range(3)), iter(range(10**40,10**40+3)), iter(set()), iter(b"a"), iter(bytearray(b"a")))
print("lazy", *(len(dir(type(item))) for item in values))
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/iterator-type-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/iterator-type-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Iterator Type Directories Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
