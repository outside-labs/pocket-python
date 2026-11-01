"""Load records with reusable errors that preserve their original causes."""


class RecordError(ValueError):
    def __init__(self, key, reason):
        super().__init__(reason)
        self.key = key


def load(records, key):
    try:
        return records[key]
    except KeyError as cause:
        raise RecordError(key, "record missing") from cause


records = {"ready": [7, 8]}
print(len(load(records, "ready")))
key = "absent"
try:
    load(records, key)
except RecordError as error:
    print(str(error))
    print(error.key is key, error.__cause__.args[0] is key)
    print(error.__suppress_context__, error.__context__ is error.__cause__)
finally:
    print("finished")
