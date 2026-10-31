"""Dynamic code and selected library imports for classes-source/1, operator/1."""
namespace = {"initial": 7}
program = compile(
    "class Counter:\n"
    " __slots__=('value',)\n"
    " def __init__(self): self.value=initial\n"
    " def read(self): return self.value\n"
    "counter=Counter()\n",
    "counter.py",
    "exec",
)
exec(program, namespace)
print(eval("counter.read()+9", namespace))
module = __import__("operator")
print(module.add(namespace["counter"].read(), 9))
