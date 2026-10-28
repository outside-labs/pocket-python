# Property names and native name notification

O37/O38 continue #123 and #33 with a finite CPython 3.14.7 contract.
`tests/fixtures/interpreter/property-names.json` records the executable reference.
Reference observations alone do not establish independent execution.

| Stage | Adopted behavior |
| --- | --- |
| O37 | Read, assign and delete `property.__name__`. An assigned name retains any adopted value, including None, unchanged. Without an assigned name, read the getter's `__name__` lazily through ordinary owned lookup. Missing names raise AttributeError; other callback errors propagate. Deletion restores lazy lookup and is idempotent. Accessor copies retain the assigned name independently; an unassigned copy follows its resulting getter. |
| O38 | Bound/unbound `property.__set_name__(owner, name, /)` stores the exact name, ignores the owner and returns None. Automatic class construction notifies properties in the existing namespace snapshot order before subclass initialization and decorators. Aliases notify repeatedly; inherited properties and later assignments do not receive a new notification. |

The native method joins the existing method-descriptor allowlist, including
explicit rebinding, actual property receiver validation, native names/owner
metadata, identity, equality and hashing. It accepts two positional arguments
after its receiver; keywords and invalid arity/receivers raise TypeError.
Neither the owner nor the name invokes read, truth, equality or type-check hooks.
Unboxed integer identity retains its existing refusal; numeric names preserve
their value without adopting interning.

Getter-name lookup runs only when needed, can return arbitrary adopted values,
and preserves AttributeError-only optional lookup semantics. Explicit None is
distinct from absence. Failed name mutation must preserve the previous name.
Detached methods, copied properties, cyclic names and getter closures remain
owned across instruction boundaries, collection, cancellation and idempotent
close. Name edges join the existing property allocation record and shared
resource limits; any changed composed resource observation requires an explicit
accounting explanation. No host callback or untracked side table owns a name.

Only property-name mutation is added. Function/type/native descriptor name
mutation, property documentation, abstract-method reflection, builtin subclass
layouts, live dictionaries and dynamic source admission retain their boundaries.
Missing-accessor diagnostics that would read a user getter's name or format a
non-primitive assigned name refuse before those deferred callback effects.
The operations belong to classes-source/1 and bytecode 5. Core/legacy admission
and host grants stay explicit. Native coroutine/await and host adapters remain
under #34.

Acceptance requires the pinned reference in Node/Chromium drain, instruction
boundary and parked execution; focused lifecycle/resource tests; compatibility
probes; and installed-wheel offline reload, Stop/Restart and profile updates.
No dependency, release, publication or deployment is included.

Primary reference: CPython v3.14.7's
[property implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c).

O37 is implemented. Its 31 adopted cases and four future boundaries pass Node
drain, instruction-boundary and parked execution. Dedicated tests retain cyclic
names, accessor cells and copied properties, preserve original callback frames,
and check actual allocation/work/recursion failures and mutation rollback.
O38 is implemented, including explicit native rebinding and automatic namespace
notifications. Its new name edge requires the documented
[`execution-accounting/2` revision](interpreter-memory.md): four composed cases
retain a 104-byte automatic name; all instruction counts and the other four
observations remain unchanged. Original resource measurements are retained.

The complete 68-case matrix contains 59 adopted comparisons and nine explicit
refusals. Node/Chromium drain, instruction-boundary and parked execution pass all
408 observations. Eleven representative probes extend the compatibility
inventory to 200 cases per target. The [property console](../examples/interpreter_property_names.py)
composes assigned names, copies, detached native methods and lazy generators.
All 408 source observations report zero logical ownership after teardown.
Installed-wheel offline acceptance passes 1,411 program comparisons, 88 groups
and 167 Stop/Restart cycles, including reload and a waiting core-profile update.
The [payload record](measurements/2026-10-28-property-names.json) verifies all 38
files at 678,706 bytes. The full 1,946-test Node unit suite and ten affected
Python tests pass. These are finite semantic/source/payload observations.
