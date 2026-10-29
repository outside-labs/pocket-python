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

All 99 pinned cases pass six Node/Chromium drain, instruction-boundary and parked
drivers: 594 observations with zero logical teardown. The 116 feature units cover
native receiver cycles, mutable/readonly/strided aliases, released views,
collection/cancellation/close, real limits and explicit core-profile refusals.
The inventory passes 522 probes per target. The
[set/buffer console](../examples/interpreter_buffer_directories.py) composes these
layouts with native binding and lazy generators. Offline acceptance covers both
directory batches, errors/refusals, Stop/Restart and a waiting reduced-profile
update. The [payload record](measurements/2026-10-29-buffer-directories.json)
verifies all 38 example files. These are finite semantic/source/payload observations.
