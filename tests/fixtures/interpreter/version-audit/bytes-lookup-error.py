class BrokenBytes:
    @property
    def __bytes__(self):
        raise ZeroDivisionError("audit-bytes-lookup")
    def __buffer__(self, flags):
        return memoryview(b"ok")
print(b"%b" % BrokenBytes())
