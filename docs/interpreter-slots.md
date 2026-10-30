# Slots and native storage descriptors

O84 of #123 adopts `__slots__` on source and dynamic classes. The
[53-case matrix](../tests/fixtures/interpreter/slots.json) uses CPython 3.14.7
as its oracle and runs on Node and Chromium through drain, stepped and parked
drivers. Slot declarations use the existing owned iterator machine; iteration
errors preserve effects and prevent publication of the new class.

| Form | Behavior |
| --- | --- |
| Declaration | One string or an iterable of strings, including mappings and generators. Names must be Python identifiers. Private names use the declaring class's mangling. Declaration values retain their original identity; later mutation does not change storage. |
| Members | Sorted native `member_descriptor` entries, stable in the class namespace. Each retains its declaring owner and storage index. Inherited and shadowed slots have independent storage. Empty members raise AttributeError; get/set/delete validate receiver and signature. |
| Dictionary | Explicit `__dict__` permits ordinary instance state; a subclass without a declaration gains a dictionary when absent. Member descriptors precede dictionary shadows. Dictionary replacement/deletion retains earlier semantics. |
| Weak storage | Explicit `__weakref__` adds the native read-only layout descriptor; inherited/default storage is preserved. It returns None until a future weakref library owns actual references. No finalizer scheduling is introduced. |
| Inheritance | Empty mixins and a shared solid ancestor compose; unrelated solid storage layouts conflict. The solid base supplies `__base__` independently of base order. Duplicate or inherited dictionary/weak slots are rejected. |
| Construction | Conflicting class variables and invalid names/types fail before descriptor notifications and subclass initialization. Custom MROs must preserve compatible storage. Nonempty slots on type-derived layouts retain the pinned native TypeError. |
| Mutation | Changing or removing a class member changes lookup while detached descriptors still access their original storage. Changing `__slots__` after construction does not alter layout. |

All operations share instruction/work/arena limits, cancellation and teardown.
Member values are traced separately from instance dictionaries. A failed member
write/delete restores the old edge; failed type creation publishes no class
binding. The focused lifecycle tests collect while slot iteration is parked and
while detached descriptors retain their instances, then test completion,
cancellation and close.

The [accounting revision](execution-contract.md#slot-storage-accounting-revision-14)
charges the new layout and member edges explicitly. Builtin payload subclasses
remain O85–O87; compatible class/base reassignment remains O88.

References: [pinned type and slot construction](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c),
[pinned member descriptor operations](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c).
