"""Build a checkout console demonstrating generator directories."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''def readings(values):
    for value in values:
        received = yield value
        if received is not None:
            yield received

stream = readings([7, 9])
names = dir(stream)
raw = stream.__dir__
print("names", len(names), "send" in names, "gi_frame" in names)
print("native", raw.__name__, raw.__qualname__, raw.__self__ is stream)
print("first", next(stream), names == dir(stream))
print("sent", stream.send(11), names == dir(stream))
readings.saved = stream
del stream
del readings
print("retained", len(raw()), next(raw.__self__))
raw.__self__.close()
print("closed", next(raw.__self__, None), len(dir(raw.__self__)))

def snapshots():
    yield dir(raw.__self__)
    yield object.__dir__(raw.__self__)

results = snapshots()
print("lazy", next(results) == names, next(results)[0])
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/generator-directories-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/generator-directories-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Generator Directory Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
