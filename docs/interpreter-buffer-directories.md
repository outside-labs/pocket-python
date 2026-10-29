# Set and buffer directories

O60 continues #123, #33 and #117 with default directories for native set,
frozenset, bytes, bytearray and memoryview layouts. Pinned CPython 3.14.7 is the
semantic oracle; `buffer-directories.json` records independently authored source
cases before engine adoption.

`dir(value)` returns a fresh sorted list. `object.__dir__(value)` and native
bound `value.__dir__()` return fresh lists in native namespace merge order,
preserving each name's first occurrence. Native lookup, explicit/cross-layout
binding, caller metadata and nested callers retain exact receivers. Directory
mutation raises AttributeError; extra arguments and keywords raise TypeError.

Collection does not iterate containers, hash or compare entries, inspect bytes,
or read buffer data/metadata. Empty and populated values share native layouts;
mutable contents, iterator positions and invalidation retain their own rules.
Memoryview directories remain available after release, without restoring data
access. Mutable/readonly/strided aliases and independently retained child views
preserve storage ownership; released views drop their storage edge as before.

Charged native merging and owned sorting retain shared instruction/work and
allocation limits. Exact native receiver graphs, including set/key cycles and
buffer aliases, survive parking, collection, cancellation and idempotent close,
with zero logical teardown. Existing composed resource observations remain
unchanged.

This is classes-source/1 and bytecode 5. Listing unread serialization, buffer,
metadata or other native APIs adopts none of their operations. Core-source
admission, other default layouts, wrapper/super namespaces, dynamic source and
native async/host work retain separate contracts. No dependency, host grant,
release, publication or deployment is included.

References: pinned [set namespaces](https://github.com/python/cpython/blob/v3.14.7/Objects/setobject.c),
[bytes namespaces](https://github.com/python/cpython/blob/v3.14.7/Objects/bytesobject.c),
[bytearray namespaces](https://github.com/python/cpython/blob/v3.14.7/Objects/bytearrayobject.c),
[memoryview namespaces](https://github.com/python/cpython/blob/v3.14.7/Objects/memoryobject.c)
and [generic directory collection](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
