"""Retain a failed record and field through an application error."""


class Record:
    def __init__(self, name):
        self.name = name


def read_field(record, key):
    try:
        return getattr(record, key)
    except AttributeError as cause:
        error = ValueError("record field unavailable")
        error.add_note("check the schema")
        raise error from cause


record = Record("ready")
print(read_field(record, "name"))
key = "missing"
try:
    read_field(record, key)
except ValueError as error:
    cause = error.__cause__
    print(str(error), cause.name is key, cause.obj is record)
    print(error.__notes__[0])
