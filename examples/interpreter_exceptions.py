"""Select reusable errors and attach notes while preserving original causes."""


class RecordError(ValueError):
    def __init__(self, key, reason):
        super().__init__(reason)
        self.key = key


def load(records, key):
    try:
        return records[key]
    except KeyError as cause:
        error = RecordError(key, "record missing")
        error.add_note("check the record key")
        raise error from cause


def failure_types():
    return (RecordError,)


records = {"ready": [7, 8]}
print(len(load(records, "ready")))
key = "absent"
try:
    load(records, key)
except failure_types() as error:
    print(str(error))
    print(error.key is key, error.__cause__.args[0] is key)
    print(error.__suppress_context__, error.__context__ is error.__cause__)
    print(error.__notes__[0])
finally:
    print("finished")


class FieldError(AttributeError):
    def __init__(self, record, key):
        super().__init__("field missing", name=key, obj=record)


def read_field(record, key):
    try:
        return record[key]
    except KeyError as cause:
        error = FieldError(record, key)
        error.add_note("check the record schema")
        raise error from cause


record = {"value": [7, 8]}
print(read_field(record, "value")[0])
key = "missing"
try:
    read_field(record, key)
except FieldError as error:
    print(error.name is key, error.obj is record)
    print(error.__cause__.args[0] is key, error.__notes__[0])
