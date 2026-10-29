# Generator and native iterator type directories

O66 continues #123 and #33 with finite native type namespaces. Pinned
CPython 3.14.7 is the semantic oracle. `iterator-type-directories.json` records
independently authored source/reference cases before engine adoption.

The adopted canonical types are generator, list_iterator, tuple_iterator,
str_ascii_iterator, str_iterator, dict_keyiterator, range_iterator,
longrange_iterator, set_iterator, bytes_iterator, bytearray_iterator,
memory_iterator, iterator and callable_iterator. Other native types retain their
existing explicit contracts.

`dir(cls)` returns a fresh sorted list of the adopted native layout names.
`type.__dir__(cls)` and its bound/rebound forms return fresh lists in pinned
own/base merge order, preserving the first position of duplicate keys. Metaclass
names and per-instance/function dictionary keys do not enter type directories.
Ordinary instances may advertise these exact native types after the optional
own-dictionary snapshot; first key identities and owned collision callbacks remain.

Native type directory descriptor identity, receiver validation, ignored owners,
read-only metadata and detached/nested caller ownership retain the O62 contract.
Namespace collection reads no contained values, descriptors, callable metadata,
accessor flags, generator bodies, iterator positions or buffer data. It preserves
the authority of existing storage aliases and released views.

Listing names adopts no additional native entry reads/APIs, mapping enumeration,
builtin subclasses or native buffers. Custom metaclass namespaces, object.__dir__
on type objects, module/wrapper/super directories, live module/class-body mappings
and dynamic source retain separate contracts. Core source admission stays explicit.

Node/Chromium drain, instruction-boundary and parked drivers compare source with
the pinned oracle. Real shared instruction/work/allocation budgets, source frames,
collection, cancellation, idempotent close, zero logical teardown and unchanged
composed resource observations remain required. No dependency, host grant,
release, publication or deployment is included.

Reference: pinned [native type directory and recursive namespace merging](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).

The 121-case matrix and compatibility probes qualify the finite O66 contract.
The [example](../examples/interpreter_iterator_type_directories.py) composes native binding,
independent namespaces and lazy execution. Installed offline acceptance includes
native errors, retained caller Stop/Restart and class-to-core profile updates.
The [payload record](measurements/2026-10-29-iterator-type-directories.json)
verifies the complete example asset closure. These are finite semantic/source/payload
observations.
