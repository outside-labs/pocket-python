"""Keep failed callable/view mutations available for a later cleanup pass."""

class FieldName(str):
    pass


failures = []


def remember(receiver, name):
    try:
        setattr(receiver, name, 7)
    except AttributeError as error:
        error.add_note("receiver retained for cleanup")
        error.args = ()
        failures.append(error)


record = {"field": []}
view = record.values()
name = FieldName("missing")
remember(view, name)
remember([7].append, name)
record["next"] = []
print(failures[0].name is name, failures[0].obj is view, len(view))
print(failures[1].name is name, failures[1].obj.__self__[0])
print(failures[0].__notes__[0], len(failures[1].args))
