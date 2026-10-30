# Actual-metaclass special protocols

O83 of #123 applies the already adopted object protocols to class objects through
their actual metaclass. `METACLASS_PROTOCOLS` is the frozen 72-name inventory in
`runtime/class-policy.mjs`; attribute hooks, checking hooks and directories retain
their earlier contracts. Ordinary source instances and class objects share the
same owned binding, callback, result-validation and fallback paths.

| Family | Slots |
| --- | --- |
| Calls and scalar protocols | `__call__`, `__len__`, `__bool__`, `__repr__`, `__str__`, `__index__`, `__bytes__` |
| Items and traversal | `__getitem__`, `__setitem__`, `__delitem__`, `__iter__`, `__next__`, `__contains__` |
| Comparison and hashing | `__eq__`, `__ne__`, `__hash__`, `__lt__`, `__le__`, `__gt__`, `__ge__` |
| Numeric conversion and unary | `__int__`, `__float__`, `__complex__`, `__abs__`, `__round__`, `__neg__`, `__pos__`, `__invert__` |
| Binary/reflected/in-place | Stems `add`, `sub`, `mul`, `truediv`, `floordiv`, `mod`, `pow`, `and`, `or`, `xor`, `lshift`, `rshift` with ordinary, `r` and `i` forms; `divmod` with ordinary and `r` forms. |
| Descriptor composition | `__get__`, `__set__`, `__delete__`, `__set_name__`; metaclass `__class__` get/set/delete descriptors preserve advertised identity while `type()` and implicit lookup use the actual metaclass. |
| Existing directory hints | `__length_hint__` participates in the adopted custom-directory and MRO-iterator contracts. General constructor length hints remain #116. |

Implicit lookup bypasses class namespace shadows and metaclass read hooks.
Functions, static/class methods, properties and custom descriptors bind to the
class receiver and actual metaclass owner. Class objects can themselves serve as
descriptors through their metaclass hooks. Returned operands remain owned through
subsequent validation, truth/index conversion and collection callbacks.

Reflected priority compares actual operand types, including metaclass subtyping;
same-type reflected arithmetic remains suppressed. NotImplemented and in-place
fallback retain instance semantics. Rich comparisons may return arbitrary values;
container comparison/membership performs owned truth conversion when required.
Class keys use their metaclass equality and hash slots, including automatic
unhashability after definition-time equality overrides. Native identity hashing
is available through `object.__hash__` on class receivers.

Subsequent metaclass slot writes/deletes affect the next operation without stale
slot caches. A callback already selected before mutation retains its captured
binding. `__class__` descriptors never replace actual layout identity. Compatible
class/base assignment remains O88.

The [102-case matrix](../tests/fixtures/interpreter/metaclass-protocols.json) is
pinned to CPython 3.14.7 and runs through all six Node/Chromium source drivers.
Focused tests cover descriptor and body suspension, class operands in arithmetic,
comparison, hashing and iteration, selected-binding mutation, recursion/work/arena
limits and completion/cancellation/close with zero logical teardown. Existing
instance protocol regression and installed offline console programs provide
composed acceptance. No new storage representation or accounting revision is
required; the shared continuation records already trace class values.

`__class_getitem__`/GenericAlias/type parameters remain #125; matrix multiplication
and user-valued ternary power remain O89; explicit native entry-point/diagnostic
completion remains O90; context, general formatting, buffer and async protocols
retain #121, #127, #117 and #34. Constructor APIs and length hints remain #116.
These boundaries also apply to ordinary instances.

References: [pinned type slot dispatch](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c),
[pinned abstract protocol dispatch](https://github.com/python/cpython/blob/v3.14.7/Objects/abstract.c).
