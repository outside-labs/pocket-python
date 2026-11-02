"""Retain rejected update targets for a useful cleanup report."""


def update(record):
    try:
        setattr(record["target"], record["field"], record["value"])
    except AttributeError as error:
        error.add_note("check the target before retrying")
        raise error from ValueError(record["id"])


for target in [1.25, [7], memoryview(bytearray(b"abc"))]:
    record = {"id": 7, "target": target, "field": "missing", "value": []}
    try:
        update(record)
    except AttributeError as error:
        error.args = ()
        print(error.name, error.obj is target, error.__cause__.args[0])
        print(error.__notes__[0])
