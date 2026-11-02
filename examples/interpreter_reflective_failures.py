"""Keep the original target when a reflective edit is rejected."""


class Field(str):
    pass


def remember_failure(target, field):
    try:
        setattr(target, field, None)
    except AttributeError as error:
        error.add_note("The original target is available as obj.")
        error.args = ()
        return error


def make_reader(value):
    return lambda: value


def stream(reader):
    yield reader()


class Base:
    version = 1


class Record(Base):
    pass


reader = make_reader([7])
generator = stream(reader)
frame = generator.gi_frame
cell = reader.__closure__[0]
prop = property(lambda self: reader()[0])
proxy = super(Record, Record())
targets = (frame, frame.f_locals, reader.__code__, cell, prop, proxy)
field = Field("rejected")
failures = []
for target in targets:
    error = remember_failure(target, field)
    failures.append(error)
    print(type(error.obj).__name__, error.name is field, len(error.args))

cell.cell_contents = [9]
print(next(generator)[0], prop.fget(None), proxy.version)
print(failures[0].obj.f_code is stream.__code__)
