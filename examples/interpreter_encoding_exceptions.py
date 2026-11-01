class RecordEncodingError(UnicodeEncodeError):
    def __init__(self, record, start, end):
        super().__init__("ascii", record["text"], start, end, "ASCII required")
        self.record = record


def encode_record(record):
    text = record["text"]
    for index in range(len(text)):
        if ord(text[index]) > 127:
            error = RecordEncodingError(record, index, index + 1)
            error.add_note("check the original record")
            raise error from ValueError(record["id"])
    return text.encode("ascii")


record = {"id": 7, "text": "A雪B"}
try:
    encode_record(record)
except RecordEncodingError as error:
    print(error.record is record, error.object is record["text"], error.encoding)
    print(str(error))
    print(error.__cause__.args[0], error.__notes__[0])
