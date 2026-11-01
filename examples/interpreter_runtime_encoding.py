"""Retain a failed record and the codec's original input and location."""


class RecordEncodingError(ValueError):
    def __init__(self, record):
        super().__init__("record cannot be encoded")
        self.record = record


def encode_record(record):
    try:
        return record["text"].encode("ascii")
    except UnicodeEncodeError as failure:
        failure.add_note("check the original record")
        raise RecordEncodingError(record) from failure


record = {"id": 7, "text": "A雪éB"}
try:
    encode_record(record)
except RecordEncodingError as error:
    failure = error.__cause__
    print(error.record is record, failure.object is record["text"])
    print(failure.encoding, failure.start, failure.end, failure.reason)
    print(str(failure))
    print(failure.__notes__[0])
