# Accessor copies and explicit function binding

O31/O32 continue #123 and #33 with a finite CPython 3.14.7 contract.
`tests/fixtures/interpreter/descriptor-binding.json` is the executable reference
matrix. A reference-only result does not establish independent execution.

| Stage | Contract |
| --- | --- |
| O31 | Bound and unbound `property.getter`, `property.setter` and `property.deleter` create fresh properties, retaining the original accessor identities except for the selected non-None replacement. Passing None retains the selected original accessor. Replacements can be arbitrary adopted values; copying never invokes or validates their callability. Native receiver and positional argument validation precede copying. |
| O32 | Bound `function.__get__(target, owner=None, /)` and its unbound form on `type(function)` return the original function for a None target and non-None owner. A non-None target creates a fresh Python method retaining that exact target and function; owner is ignored. Both target and owner None raise TypeError. Binding bypasses target/owner attribute, descriptor, equality and advertised-class hooks and never invokes the function. |

The native copy methods accept exactly one positional replacement after their
property receiver. They have canonical unbound method_descriptor identities and
fresh bound builtin_function_or_method values. Function binding has a canonical
unbound wrapper_descriptor and fresh bound method-wrapper values. Both expose
`__class__`, `__name__` and `__qualname__`; bound native values expose `__self__`
and have no `__func__`. Resulting Python methods expose their original `__self__`
and `__func__`, match ordinary implicit binding, and preserve the existing method
equality/hash contract. A wrong native receiver raises TypeError.

Accessor copies are shallow and independent of later calls. Wrapped closures,
defaults, mutable receivers and accessor values remain owned through detached
native handles, collection and parked instruction boundaries. Invocation uses
ordinary frames, argument binding, source errors and shared budgets. Generator
functions remain lazy. Cancellation, close and real resource failures must
release all logical owners. Preserve the eight composed resource observations.

These operations belong to classes-source/1 and bytecode 5. Core-source/1,
legacy bytecode admission and host grants retain their existing boundaries.
Property documentation/names, live dictionaries, native descriptor rebinding,
builtin layouts and broader descriptor reflection remain separate follow-ups.
Native coroutine/await and host adapters remain under #34.

Acceptance requires pinned Node/Chromium source comparisons with drain,
instruction-boundary and parked drivers, lifecycle tests, and installed-wheel
offline source with Stop/Restart. No dependency, release, publication or
deployment is included.

Primary references are the pinned implementations of
[property copies](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c)
and [function descriptors](https://github.com/python/cpython/blob/v3.14.7/Objects/funcobject.c).
The executable reference resolves patch-level differences.
