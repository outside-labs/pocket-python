# Callable metaclass factories

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O81 of #123 admits function, callable-object, wrapper and class factories in a
class statement's `metaclass` argument. Arbitrary factory results become the
statement's bound value and are passed to decorators. The body namespace remains
owned through preparation, execution, construction and any escaped aliases.

| Operation | Contract |
| --- | --- |
| Selection | An explicit non-type factory bypasses type-metaclass conflict calculation. Without an explicit metaclass, the actual type of the first resolved base supplies the candidate, including a non-type base without a replacement hook. Actual type candidates retain the normal most-derived selection rules. A factory class need not derive from `type`. |
| Preparation | Optional ordinary `__prepare__` lookup uses descriptors and custom read/fallback hooks. Lookup AttributeError selects a fresh dictionary; preparation-call exceptions propagate. Invalid results fail before body effects. |
| Invocation | Call once after body completion with the original name, resolved bases tuple, exact namespace and class keyword values. Prepared name/base argument identities survive unchanged. Forward `__orig_bases__` and required lexical cells in the namespace. |
| Results | Preserve any returned value. Actual type results validate the original class cell; arbitrary results leave its original unbound state intact. |
| Failure | Non-callable metaclasses still perform available preparation and body effects before invocation fails. Callback failures retain original frames and visible effects. |
| Direct calls | Calling a factory or metaclass directly does not run preparation or source-statement base resolution. Native `type.__new__` retains its metaclass/dictionary validation. |

The [26-case source matrix](../tests/fixtures/interpreter/metaclass-factories.json)
is pinned to CPython 3.14.7 and registered for all six Node/Chromium drivers.
Focused lifecycle tests suspend inside preparation and invocation, collect at
instruction boundaries, then finish, cancel or close with zero logical teardown
counters. Recursion, work and memory remain shared with the initiating execution.
Custom MRO remains O82; builtin storage remains O84–O88.

References: [pinned class-statement factory dispatch](https://github.com/python/cpython/blob/v3.14.7/Python/bltinmodule.c),
[pinned native type construction](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
