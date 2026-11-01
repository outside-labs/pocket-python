class RecordDecodingError(UnicodeDecodeError):
    def __init__(self, record, start, end):
        super().__init__("ascii", record["data"], start, end, "ASCII required")
        self.record = record


def decode_record(record):
    data = record["data"]
    for index in range(len(data)):
        if data[index] > 127:
            error = RecordDecodingError(record, index, index + 1)
            error.add_note("check the original record")
            raise error from ValueError(record["id"])
    return data.decode("ascii")


record = {"id": 7, "data": b"A\xffB"}
try:
    decode_record(record)
except RecordDecodingError as error:
    print(error.record is record, error.object is record["data"], error.encoding)
    print(str(error))
    print(error.__cause__.args[0], error.__notes__[0])
