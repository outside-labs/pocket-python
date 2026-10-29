"""Build a checkout console demonstrating live keyed class namespaces."""

import argparse
from pathlib import Path

from examples.interpreter_console import write_source
from pocket_python.interpreter import build_interpreter, read_interpreter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''class Base:
    inherited = 7

class Record(Base):
    status = "draft"
    @classmethod
    def rename(cls, value): cls.status = value
    @property
    def label(self): return self.status
    def labels(self):
        yield self.label
        yield self.status

record = Record()
retained = record.rename
namespace = vars(Record)
get = namespace.get
print("own", "inherited" in namespace, "status" in namespace)
print("stored", namespace["label"].fget(record), namespace["rename"].__func__ is retained.__func__)
retained("review")
print("live", get("status"), record.label)
Record.extra = [9]
print("identity", namespace["extra"] is Record.extra)
del Record.extra
print("deleted", get("extra", "missing"))
for label in record.labels(): print("lazy", label)
try: namespace["status"] = "blocked"
except TypeError: print("readonly", Record.status)
Record.saved = namespace
del Record
print("retained", get("saved") is namespace, namespace["status"])
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('build/class-namespaces-console-source'))
    parser.add_argument('--output', type=Path, default=Path('build/class-namespaces-console'))
    args = parser.parse_args()
    receipt = build_interpreter(write_source(args.source, source=SOURCE),
                                read_interpreter(ROOT / 'runtime'), args.output,
                                language_profile='classes-source/1', title='Python Class Namespace Console')
    print(f"Created {args.output.resolve()} ({receipt['size']['artifact_bytes']} bytes)")
