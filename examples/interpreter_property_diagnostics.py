class Example:
    unreadable = property()


try:
    Example().unreadable
except AttributeError as error:
    print(str(error))


def read(instance):
    return 7


original = property(read)
original.__name__ = "value"
copied = original.setter(lambda instance, value: None)
print(copied.__name__, copied.__get__(Example(), Example))
