"""Recover a native mutation failure while retaining its original operands."""


def make_cell():
    record = [7]
    return (lambda: record).__closure__[0]


cell = make_cell()


class Key(str):
    def __hash__(self):
        print("lookup", cell.cell_contents[0])
        raise ValueError("lookup failed")


key = Key("cell_contents")
try:
    setattr(cell, key, [9])
except AttributeError as error:
    error.add_note("The original record can still be recovered.")
    print(error.name is key, error.obj is cell)
    print(error.obj.cell_contents[0], error.__context__ is None)
