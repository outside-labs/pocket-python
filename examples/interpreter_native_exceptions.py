"""Load named record sources and retain native import/exhaustion details."""


class SourceError(ImportError):
    def __init__(self, key):
        super().__init__("source unavailable", name=key, path="local", name_from="records")


class EndOfRecords(StopIteration):
    pass


class Records:
    def __init__(self, rows):
        self.rows = rows
        self.index = 0

    def __iter__(self):
        return self

    def __next__(self):
        if self.index == len(self.rows):
            raise EndOfRecords(self.index)
        row = self.rows[self.index]
        self.index += 1
        return row


def open_source(registry, key):
    try:
        return Records(registry[key])
    except KeyError as cause:
        error = SourceError(key)
        error.add_note("check the record registry")
        raise error from cause


registry = {"ready": [7, 8]}
cursor = open_source(registry, "ready")
print(next(cursor), next(cursor))
try:
    next(cursor)
except EndOfRecords as error:
    print(error.value, error.args[0])

key = "missing"
try:
    open_source(registry, key)
except SourceError as error:
    print(str(error), error.name is key, error.path, error.name_from)
    print(error.__cause__.args[0] is key, error.__notes__[0])
