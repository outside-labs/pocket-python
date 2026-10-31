# Property diagnostics and accessor copies

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

The O90 property portion adopts missing getter/setter/deleter diagnostics and
native accessor-copy behavior against CPython 3.14.7. The
[source matrix](../tests/fixtures/interpreter/property-diagnostics.json) contains
101 adopted cases and one retained #127 display boundary. All six Node/Chromium
drain, stepped and parked drivers pass: [606 adopted observations](measurements/2026-10-30-property-diagnostics.json)
with zero teardown failures. Refusals receive no adoption credit.

Missing accessors report the actual target type's qualified name, including
native targets and property subtypes. The diagnostic uses an assigned property
name, including `None`, or an optional lookup of the getter's `__name__`.
AttributeError from that lookup means an unnamed property. Other lookup errors
and name/qualification representation errors propagate. Advertised `__class__`
and metaclass attribute hooks do not replace the actual qualified name.

The property name is retained before obtaining the qualification, and both
values remain owned while their representation callbacks run in order. A
callback may mutate the property name, target class or type qualification;
the diagnostic keeps the captured values. String subclasses retain their
representation behavior. The same path handles implicit access, explicit
bound/unbound native calls, `getattr` defaults and source `__getattr__` fallback.
The complete rendered message is bounded by the existing text limit.

Accessor copies call the actual property subtype constructor. After it returns,
the original property's current stored name is copied whenever the result is
a property, including a plain property returned by a metaclass factory. An
unnamed original clears a constructor-supplied stored name. A factory's arbitrary
non-property result remains its result. Getter documentation and constructor
callbacks retain their ordinary order and errors.

The property diagnostic continuation declares the property, target, captured
name, qualification and rendered name as roots. Collection while parked,
cancellation, close, recursion, work, instruction and memory limits have focused
coverage. Existing property-name, descriptor, documentation and execution
regressions remain passing. Native metadata stays read-only under its existing
rules; listed serialization methods retain #126, and unadopted container
representations retain #127.

Reference: [CPython 3.14.7 property implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c).
