# Range and slice directories

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O58 continues #123, #33 and #116 with default directories for the existing native
range and raw slice layouts. Pinned CPython 3.14.7 is the semantic oracle; the
independently authored `sequence-directories.json` matrix records the reference
before engine adoption.

`dir(value)` returns a fresh sorted list. `object.__dir__(value)` and native bound
`value.__dir__()` return fresh lists in actual native namespace merge order,
keeping the first occurrence of each native type/object name. Native lookup,
explicit descriptor binding, cross-layout rebinding, caller metadata and nested
callers retain the exact receiver. Mutation raises AttributeError; extra arguments
and keywords raise TypeError.

Empty, descending, short and arbitrarily large adopted ranges share their native
layout. Collection neither iterates a range nor computes its Python length.
Existing iterators keep their position. Raw slice fields retain arbitrary adopted
values and aliases; collection neither reads their dictionaries/attributes nor
converts, hashes, compares, formats or truth-tests them. Cyclic field graphs and
mutated field containers remain introspectable without new callbacks.

Charged native merging and owned sorting preserve shared instruction/work and
allocation limits. Retained native callers own the complete range/slice graph
through parking, collection, cancellation and idempotent close, with zero logical
teardown. The existing composed resource observations remain unchanged.

This is classes-source/1 and bytecode 5. Listed native metadata, serialization and
other methods retain their separately adopted API boundaries. Core-source
admission, other directory layouts, wrapper/super namespaces, dynamic source and
native async/host work retain their separate contracts. No dependency, host grant,
release, publication or deployment is included.

References: pinned [range namespaces](https://github.com/python/cpython/blob/v3.14.7/Objects/rangeobject.c),
[slice namespaces](https://github.com/python/cpython/blob/v3.14.7/Objects/sliceobject.c)
and [generic directory collection](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).

All 44 pinned cases pass six Node/Chromium drain, instruction-boundary and parked
drivers: 264 observations with zero logical teardown. The 52 feature units cover
cyclic container/instance/function fields, detached native chains, cancellation,
collection and real limits. The eight composed resource observations remain
unchanged. Together O57/O58 provide 846 passing source observations and 846 zero
logical teardowns; the final inventory passes 475 probes per target.

The [range/slice console](../examples/interpreter_sequence_directories.py) composes
large ranges, retained cyclic fields, native binding and lazy generators. Offline
acceptance covers both matrices, error/refusal boundaries, Stop/Restart and a
waiting reduced-profile update. The [payload record](measurements/2026-10-29-sequence-directories.json)
verifies all 38 example files. These are finite semantic/source/payload observations.
