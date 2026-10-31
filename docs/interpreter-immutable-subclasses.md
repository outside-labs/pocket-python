# Immutable builtin subclass layouts

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O85 of #123 adopts `int`, `float`, `complex`, `str`, `bytes`, `tuple` and
`frozenset` subclasses. The [74-case pinned matrix](../tests/fixtures/interpreter/immutable-subclasses.json)
compares CPython 3.14.7 with Node/Chromium drain, stepped and parked execution.
The constructor signatures and value operations are those already admitted by
the numeric, sequence and value-family milestones.

| Surface | Contract |
| --- | --- |
| Construction | Inherited and explicit native `__new__` allocate the selected source subtype with an owned native payload. Source `__new__` and `__init__` use ordinary descriptor binding and callbacks. A foreign `__new__` result skips initialization. |
| State | Actual subtype, aliases, instance dictionary and inherited members remain attached to the source object. Native payloads are immutable and distinct from instance state. |
| Dispatch | Implicit operations select source overrides, reflected subtype priority, NotImplemented fallback and source hash/equality. Explicit native descriptors bypass source overrides and validate their actual receiver. |
| Value results | Native arithmetic, conversion, slicing, concatenation, repetition and set operations return the corresponding base values. Iteration retains native contents. Native integer indexing uses the integer payload even when a subtype shadows `__index__`. |
| Storage | Empty slots and dictionaries compose. Variable-size int/bytes/tuple layouts reject nonempty member/weak slots; fixed layouts permit members. Native weak-reference capacity is distinguished from exposing a weak-reference descriptor. |
| Failure | Non-subclassable native bases raise TypeError after class-body effects. Invalid native receiver/constructor arguments fail through the owned machine. Incompatible solid layouts are rejected before publication. |

Native operations reuse their existing value implementations; wrapped payloads
never add host capabilities or foreign executable values. Each payload edge adds
eight bytes to its instance record and traces the native value's full existing
allocation. Detached native methods and source callbacks retain that instance
through parked collection, cancellation and close. Ordinary source objects retain
their prior representation and all eight composed resource observations.

Broader constructors and sequence APIs remain #116; new set/bytes APIs remain
#117; new numeric methods remain #184; new string/display methods remain #127.
Mutable native payloads continue in O86, other native subclass layouts in O87,
and compatible reassignment in O88. Exception payload subclasses remain #124.

References: [pinned native allocation and layout checks](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c),
[pinned integer construction and operations](https://github.com/python/cpython/blob/v3.14.7/Objects/longobject.c),
[pinned tuple construction](https://github.com/python/cpython/blob/v3.14.7/Objects/tupleobject.c).
