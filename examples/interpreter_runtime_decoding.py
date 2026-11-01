"""Retain a codec failure's snapshot while the source buffer is repaired."""


class RecordDecodingError(ValueError):
    def __init__(self, record):
        super().__init__("record cannot be decoded")
        self.record = record


def decode_record(record):
    try:
        return record["data"].decode("utf-8")
    except UnicodeDecodeError as failure:
        failure.add_note("check the original input bytes")
        raise RecordDecodingError(record) from failure


record = {"id": 7, "data": bytearray(b"A\xe1\x80")}
try:
    decode_record(record)
except RecordDecodingError as error:
    failure = error.__cause__
    record["data"][1] = 66
    record["data"][2] = 67
    print(error.record is record, failure.object, record["data"])
    print(failure.encoding, failure.start, failure.end, failure.reason)
    print(str(failure))
    print(failure.__notes__[0])
