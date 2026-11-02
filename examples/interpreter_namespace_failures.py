"""Retain a class and its failed field name while reporting cleanup errors."""

class FieldName(str):
    pass


class Record:
    active = ["pending"]


def discard(owner, name):
    try:
        delattr(owner, name)
    except AttributeError as cause:
        error = LookupError("field already removed")
        error.owner = owner
        error.add_note("cleanup can be retried")
        raise error from cause


discard(Record, "active")
try:
    discard(Record, FieldName("active"))
except LookupError as error:
    cause = error.__cause__
    print(str(error), cause.name)
    print(cause.obj is Record, error.owner is Record)
    print(type(cause.name) is str, error.__notes__[0])
