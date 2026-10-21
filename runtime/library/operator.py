"""Small operator profile implemented through the independent language core."""


def add(a, b):
    return a + b


def sub(a, b):
    return a - b


def mul(a, b):
    return a * b


def floordiv(a, b):
    return a // b


def mod(a, b):
    return a % b


def eq(a, b):
    return a == b


def lt(a, b):
    return a < b


def neg(a):
    return -a


def not_(a):
    return not a


def truth(a):
    return not not a


def getitem(a, b):
    return a[b]
