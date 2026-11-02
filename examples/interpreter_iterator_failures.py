"""Keep rejected iterator targets available for recovery."""


def retain_failure(target):
    try:
        target.missing = 7
    except AttributeError as error:
        error.args = ()
        error.add_note("the original iterator is still available")
        return error


def records(value):
    yield value


for target in [records([7]), iter([[8]]), iter({"record": [9]}.values())]:
    error = retain_failure(target)
    print(error.name, error.obj is target, next(error.obj)[0])
    print(error.__notes__[0])

error = retain_failure(iter(memoryview(bytearray(b"abc"))))
print(error.name, next(error.obj))
