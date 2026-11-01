"""Report a rejected record update with its original field and receiver."""


class Record:
    __slots__ = ("title",)

    def __init__(self, title):
        self.title = title


class RecordUpdateError(ValueError):
    def __init__(self, record):
        super().__init__("record update rejected")
        self.record = record


def update(record, field, value):
    try:
        setattr(record, field, value)
    except AttributeError as failure:
        failure.add_note("check the record schema")
        raise RecordUpdateError(record) from failure


record = Record("draft")
update(record, "title", "ready")
print(record.title)
field = "unknown"
try:
    update(record, field, "ignored")
except RecordUpdateError as error:
    failure = error.__cause__
    print(failure.name is field, failure.obj is record, error.record is record)
    print(failure.__notes__[0])

try:
    delattr(record, field)
except AttributeError as failure:
    print(failure.name is field, failure.obj is record)
