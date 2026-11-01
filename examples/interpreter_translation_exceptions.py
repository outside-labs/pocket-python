class RecordTranslationError(UnicodeTranslateError):
    def __init__(self, record, start, end, reason):
        super().__init__(record["text"], start, end, reason)
        self.record = record


def require_ascii(record):
    text = record["text"]
    for index in range(len(text)):
        if ord(text[index]) > 127:
            error = RecordTranslationError(record, index, index + 1, "ASCII required")
            error.add_note("check the original record")
            raise error from ValueError(record["id"])
    return text


record = {"id": 7, "text": "A雪B"}
try:
    require_ascii(record)
except RecordTranslationError as error:
    print(error.record is record, error.object is record["text"], error.start, error.end)
    print(str(error))
    print(error.__cause__.args[0], error.__notes__[0])
