"""Retain structured record diagnostics, causes and notes."""


class RecordSyntaxError(SyntaxError):
    pass


def load_record(token, line):
    if token == "ready":
        return 7
    cause = ValueError("expected ready")
    details = ("records.py", line, 1, token, line, len(token) + 1, {"token": token})
    error = RecordSyntaxError("invalid record", details)
    error.add_note("use ready")
    raise error from cause


print(load_record("ready", 1))
token = "missing"
try:
    load_record(token, 3)
except SyntaxError as error:
    print(str(error))
    print(error.filename, error.lineno, error.offset)
    print(error.args[1][3] is token, error._metadata["token"] is token)
    print(str(error.__cause__), error.__notes__[0])
