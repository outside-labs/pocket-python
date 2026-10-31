# Native attribute protocol closure

This O90 portion completes explicit native attribute calls over adopted primitive,
method, module and super layouts. The [CPython 3.14.7 source matrix](../tests/fixtures/interpreter/native-attributes.json)
contains 150 adopted cases, covering ordinary bound, unbound, explicitly rebound
and `object.__getattribute__` calls. All six Node/Chromium drain, stepped and parked
drivers pass: [900 observations](measurements/2026-10-30-native-attributes.json),
with zero teardown failures.

Attribute-name arguments use the native-string form already admitted by the
implicit attribute API; this stage does not expand that API's name-argument types.
Primitive attribute calls use their existing native type/field descriptors and
report absent attributes or read-only storage with Python errors. Native method
attribute lookup retains its function fallback; explicit object lookup bypasses
that fallback. Module native lookup preserves namespace shadows and module-level
`__getattr__`, while object lookup bypasses the module hook. Calls on module
subtypes bypass an overridden `__getattribute__` and still bind data descriptors
and preserve module namespace behavior.

Super's own native attribute operation forwards through the proxy's selected
MRO, then reads the proxy's actual own layout. Object lookup reads the proxy's
own layout directly. A normal `super().__getattribute__` lookup still selects the
forwarded base operation. Native `super.__get__` keeps a bound proxy unchanged
and constructs the actual proxy subtype when binding an unbound proxy; subtype
constructors and descriptor callbacks use ordinary owned frames.

Native type initialization preserves its internal direct-slot path even when a
custom MRO hides `type`. Explicit public wrappers still validate the actual
receiver through the public MRO. Missing-property diagnostic continuations retain
optional descriptor-binding recovery, including truth fallback, without
suppressing errors from a method body.

Focused lifetime checks collect while a forwarded property getter is parked,
then finish, cancel or close. Recursion, instruction, work and memory limits
retain the same execution owner. All eight existing composed resource
observations remain unchanged. Unadopted display and library APIs retain the
owners listed in [the native protocol contract](interpreter-native-protocols.md).
No dependency, host grant or accounting revision changes are required.

References: [pinned super and type implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c),
[pinned method attribute lookup](https://github.com/python/cpython/blob/v3.14.7/Objects/classobject.c),
[pinned module attribute lookup](https://github.com/python/cpython/blob/v3.14.7/Objects/moduleobject.c).
