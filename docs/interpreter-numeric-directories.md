# Numeric and singleton directories

O57 continues #123 and #33 with finite default directories for `None`,
`NotImplemented`, booleans, integers, floats and complex values. Pinned CPython
3.14.7 is the semantic oracle; the independently authored
`numeric-directories.json` matrix records reference behavior before adoption.

`dir(value)` returns a fresh sorted list. `object.__dir__(value)` and the native
bound `value.__dir__()` return fresh lists in native namespace merge order:
actual type, inherited types, then object, keeping the first occurrence of each
name. Boolean directories merge bool before int. Values, signs, integer size,
NaNs and infinities do not change the layout. Collection reads no listed
attributes, performs no numeric conversion and never truth-tests a singleton.

Native callers retain receivers and report actual native qualifications.
Explicit native lookup, descriptor binding, cross-layout rebinding and nested
callers preserve their existing rules, including the None receiver sentinel in
`object.__dir__.__get__`. Directory mutation raises AttributeError; extra
arguments and keywords raise TypeError.

Collection uses charged native dictionary merge and owned sorting, preserving
shared instruction/work/allocation limits and receiver lifetimes across parking,
collection, cancellation and idempotent close. Existing composed resource
observations remain unchanged.

This is classes-source/1 and bytecode 5. Listing numeric methods, native metadata
or serialization names adopts none of their unread APIs. Core-source admission,
unboxed integer identity, other default layouts, wrapper namespaces, dynamic source and native async/host
work retain their separate contracts. No dependency, host grant, release,
publication or deployment is included.

The reference uses the pinned [generic directory collection](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c)
and the installed CPython 3.14.7 native numeric/singleton namespaces.
