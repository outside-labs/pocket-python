# Ordinary instance directories

O61 continues #123 and #33 with default directories for root objects and ordinary
instances. Pinned CPython 3.14.7 is the semantic oracle. The independently authored
`instance-directories.json` records reference observations before adoption.

`dir(value)` returns a fresh sorted list. Native `object.__dir__(value)` and its
bound/rebound forms return fresh lists in dictionary/class merge order, preserving
first key identities. Ordinary explicit attribute lookup still permits instance
shadowing; implicit directory selection uses the actual type's slot. An explicit
native call bypasses custom `__dir__`, while its dictionary/class reads retain
ordinary descriptors, read hooks and AttributeError-only fallback.

Native collection first optionally reads `__dict__`, copies real dictionaries
without rehashing and ignores missing/non-dictionary results. It then optionally
reads `__class__`. Ordinary source/dynamic class namespaces merge depth first
through base order, including repeated diamond ancestors. Names include the
pinned native layout entries; listing them does not adopt their reads. Stored
values and descriptors are not invoked merely to enumerate class keys. The own
dictionary snapshot precedes class-read effects; each class namespace is observed
when reached. Native merging preserves arbitrary key identities and owned
collision/equality/truth callbacks. Sorting retains the adopted ordering contract.

This finite slice supports ordinary classes and object as advertised classes.
Custom metaclass namespace reflection and non-class advertised namespaces remain
explicit refusals. Class/module directories, class mapping enumeration/native
entry reads, live module/class-body namespaces, wrappers/super and dynamic source
retain separate contracts. Core-source admission remains explicit.

Owned receivers, dictionary copies, pending class graphs and native caller chains
survive instruction-boundary parking and collection. Cancellation, idempotent
close, original error frames and shared instruction/work/allocation limits retain
zero logical teardown. Existing composed resource observations remain unchanged.
No dependency, host grant, release, publication or deployment is included.

Reference: pinned [generic directory and recursive class merging](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
