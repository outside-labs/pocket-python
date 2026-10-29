# Ordinary container directories

O59 continues #123, #33 and #116 with default directories for the existing
native str, list, tuple and dict layouts. Pinned CPython 3.14.7 is the semantic
oracle; the independently authored `container-directories.json` matrix records
the reference before engine adoption.

`dir(value)` returns a fresh sorted list. `object.__dir__(value)` and native
bound `value.__dir__()` return fresh lists in actual native namespace merge
order, preserving the first occurrence of each type/object name. Native lookup,
explicit binding, cross-layout rebinding, caller metadata and nested callers
retain the exact receiver. Directory mutation raises AttributeError; extra
arguments and keywords raise TypeError.

Empty, populated and Unicode values share their actual native layout.
Collection does not traverse contents, read attributes on contained values,
invoke their conversion/hash/equality/order/truth/display/directory hooks, or
advance iterators. Mutations remain visible through existing aliases and
iterators. Container cycles and detached native callers retain their graphs.

Charged native merging and owned sorting preserve shared instruction/work and
allocation limits. Native callers retain receivers through parking, collection,
cancellation and idempotent close, with zero logical teardown. Existing composed
resource observations remain unchanged.

This is classes-source/1 and bytecode 5. Listed native methods and metadata retain
their separately adopted API boundaries. Core-source admission, other default
layouts, wrapper/super namespaces, dynamic source and native async/host work
retain separate contracts. No dependency, host grant, release, publication or
deployment is included.

References: pinned [text namespaces](https://github.com/python/cpython/blob/v3.14.7/Objects/unicodeobject.c),
[list namespaces](https://github.com/python/cpython/blob/v3.14.7/Objects/listobject.c),
[tuple namespaces](https://github.com/python/cpython/blob/v3.14.7/Objects/tupleobject.c),
[dictionary namespaces](https://github.com/python/cpython/blob/v3.14.7/Objects/dictobject.c)
and [generic directory collection](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).

All 79 pinned cases pass six Node/Chromium drain, instruction-boundary and parked
drivers: 474 observations with zero logical teardown. The 93 feature units cover
native receiver cycles, collection, cancellation, close and real resource limits.
The inventory passes 497 probes per target. The
[container console](../examples/interpreter_container_directories.py) composes
Unicode, mutable iterators, cyclic values and detached native callers. Offline
acceptance includes its matrix, errors/refusals, Stop/Restart and waiting
reduced-profile update. The [payload record](measurements/2026-10-29-container-directories.json)
verifies all 38 example files. These are finite semantic/source/payload observations.
