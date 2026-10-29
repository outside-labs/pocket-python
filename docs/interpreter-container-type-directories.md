# Sequence, container and buffer type directories

O64 continues #123 and #33 over O63's numeric type directory contract. Pinned
CPython 3.14.7 is the semantic oracle. `container-type-directories.json` records
independently authored source/reference cases before engine adoption.

`dir(cls)` for str/list/tuple/dict/range/slice/set/frozenset/bytes/bytearray/memoryview
returns fresh sorted native namespace keys. Native `type.__dir__(cls)` and explicit
bound/rebound forms return fresh lists in pinned own/base merge order, retaining
the first position of duplicate keys. These directories use the canonical types
and exclude metaclass names. Ordinary instances may advertise these type
namespaces after their optional own dictionary snapshot; arbitrary own keys retain
their first identities and the adopted owned collision callbacks.

Existing type directory descriptor binding, receiver validation, read-only native
metadata, ignored owners and detached/nested caller ownership remain unchanged.
Enumeration reads no container contents, hash entries, iterator positions, storage
or view state and invokes no contained callbacks. Released views retain their
directory and type identity while their data access remains invalid. Mutating a
returned list cannot change another directory result or its immutable native type.

Listing a key adopts no additional native entry reads/APIs, generic aliases,
mapping enumeration, builtin subclass layouts or native buffers. `object.__dir__`
on type objects, custom metaclass namespaces, further builtin type families,
module/wrapper/super directories, live mappings and dynamic source retain their
separate contracts. Source admission remains explicitly classes-source/1.

Pinned source comparisons run in Node/Chromium using drain, instruction-boundary
and parked drivers. Shared instruction/work/allocation limits, collection,
cancellation, idempotent close, source frames and zero logical teardown retain the
existing owned execution rules. Composed resource observations remain unchanged.
No dependency, host grant, release, publication or deployment is included.

Reference: pinned [native type directories and recursive namespace merging](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).

The 105-case matrix contains 99 adopted comparisons and six explicit refusals.
All six Node/Chromium drain, instruction-boundary and parked drivers pass, as do
the repeated O63 matrices against the extended engine. The 123 feature units
include a parked native-key collision callback with a retained cyclic instance
graph. The 530 adjacent directory/rebinding/resource units and 23 affected Python
checks pass; the eight composed resource observations remain unchanged.

Compatibility probes and installed offline acceptance cover native errors,
immutable type namespaces, retained caller Stop/Restart and core-profile updates.
The [container type example](../examples/interpreter_container_type_directories.py)
composes iterator position, callback isolation, mutable view aliases and released
views with native type directories. Its
[payload record](measurements/2026-10-29-container-type-directories.json) verifies
all 38 files at 744,178 bytes and an identical fresh rebuild. These are finite
semantic/source/payload observations.
