# Integer identity

O75 of #123 adopts integer identity alongside the existing arena object and
None/bool identities. `id(value, /)` in classes-source/1 returns an opaque positive
integer. Integer `is` and `is not` work in both existing source profiles; the core
profile keeps its existing builtin-name boundary.

The model canonically interns equal integer values within a session. Integer
aliases therefore preserve identity, and `a is b` agrees with `id(a)==id(b)` for
all adopted values. Distinct simultaneously live objects have distinct IDs,
including equal-valued bool/int/float objects. Hashing, numeric equality,
arbitrary-precision arithmetic and container key semantics remain unchanged.
Identity never invokes user hashing, equality, coercion or attribute hooks.

Python permits immutable values to share identity. The pinned
[CPython 3.14.7 data model](https://github.com/python/cpython/blob/v3.14.7/Doc/reference/datamodel.rst#objects-values-and-types)
defines that latitude; exact integer interning choices and numeric addresses are
not reference comparisons. The 24 source cases compare aliases, distinct values
and `is`/`id` agreement, without requiring separately constructed equal integers
to have either shared or separate identities.

Integer payloads retain the independent unboxed arithmetic representation.
An arena-local registry lazily allocates a bounded identity record on `id`.
Every reachable integer edge marks its corresponding record, whether retained
by a source constant, container, cell, default, frame, closure, paused activation,
root lease or persistent callback. The registry is not itself a root. Collection
reclaims records after their scalar values become unreachable. A subsequently
constructed equal value may receive a fresh ID; retained aliases never do.
IDs share the arena's monotonic object-identity counter and cannot collide with
live object or singleton IDs. Failed allocation leaves registry/counter state
unchanged; cancellation, close and repeated teardown release all owners.

[Execution accounting revision 12](execution-contract.md#integer-identity-accounting-revision-12)
charges each internal identity record and bounded traversal/comparison work.
Ordinary numbers without identity inspection keep their prior storage costs;
the eight composed observations are unchanged. There are no address or
cross-session guarantees. New builtin subclass storage remains O84–O88.

The `integer-identity.json` corpus runs through Node and Chromium drain, stepped
and parked drivers and installed offline flows. Units add record reclamation,
allocation rollback, shared runtime ownership, per-instruction collection,
callback cancellation/budgets, closed-arena rejection and zero logical teardown.
