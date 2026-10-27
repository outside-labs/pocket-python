# Equality, hashing and dictionary keys

The semantic oracle remains **CPython 3.14.7**. The finite
[source matrix](../tests/fixtures/interpreter/equality.json) separates equality
and its consumers (E1), hashing/dictionary keys (E2), and later refusals (E3).
Reference-only evidence does not execute the independent engine. Adoption needs
the corresponding `implemented_stages`, Node/Chromium drain/step reports,
ownership tests and offline acceptance.

## Rich comparison

Adopt `__eq__` and `__ne__` in classes-source/1 through current type/MRO lookup
and ordinary descriptor binding. Instance shadows do not replace implicit slots.
Try a strict right-hand subclass first, then the left slot, then the right slot
if it has not already been tried. An inherited slot still receives subtype
priority. A same-type NotImplemented result can produce two attempts with the
operands exchanged. A noncallable present slot fails; a missing slot or binding
AttributeError skips that attempt. Hook-body errors propagate.

Hook results remain raw values until a consuming context needs truth. The
NotImplemented singleton advances protocol fallback rather than acting as a
truthy result; Python 3.14 truth conversion raises TypeError. Its direct display
and identity are adopted. Exhausted equality/inequality fallback uses identity.
With no explicit `__ne__`, the default invokes the receiver's equality operation
and negates a supported result through owned truth conversion; NotImplemented
continues fallback. An explicit `__ne__` returning NotImplemented does not
implicitly invoke that receiver's `__eq__`.

Binary equality still calls an override when both operands are the same object.
Membership and container element comparison first accept identity, then compare
the stored element with the query and truth-test the result. Adopt bounded
recursive list/tuple equality, and dictionary equality after E2. Preserve list
length shortcuts and callback-visible element/length mutations. Primitive paths,
normal source evaluation order, chained comparison and conditional truth remain
required. The separately adopted [ordering contract](interpreter-ordering.md)
adds four ordering slots; set ordering with user keys and arbitrary reflective
hooks remain separate work.

Callable-sentinel comparison uses sentinel equality before deciding exhaustion.
Its comparison errors must not set the iterator's sticky exhaustion flag.
`next(it, default)` can consume a comparison's StopIteration at the public next
boundary, while a later call retries the callable/comparison. Membership
comparison errors propagate; ordinary advancement exhaustion ends its search.

## Hashing

Adopt positional-only `hash(value)` and type-level `__hash__` in classes-source/1.
Require an actual adopted integer/bool result, without recursive index conversion.
Normalize -1 to -2; keep signed-64-bit hook results unchanged otherwise and
reduce larger results through the adopted integer hash. Boolean warning emission
is outside this profile. Use the fixed 64-bit reference contract across Node and
Chromium; this is not native ABI support.

Numeric hashes must preserve equality between bool, arbitrary integers and
floats, including signed zero. Strings, primitive tuples and default objects need
stable hashes and equal-value invariants; their concrete implementation-dependent
hash numbers are not a cross-process or CPython-address promise. Identity hashes
belong to owned VM objects, not serialized representations or host addresses.
Hashing mutable list/dict values fails with TypeError. Tuple keys containing user
instances, slices and bound methods follow the [method hash contract](interpreter-object-hashing.md).

At class creation, an own `__eq__` without an own `__hash__` installs a None hash
slot, even when a parent supplies a hash. Inherited disabling remains effective.
An explicit hash or `object.__hash__` restores hashability. Later assignment of
`__eq__` does not implicitly rewrite an existing hash slot; deleting a hash slot
can reveal the inherited default. Type mutation and instance shadows follow
the same implicit-lookup rules as comparisons.

## Dictionary invariants and failures

Adopt bounded dictionary literals and subscription read/write/delete/membership
with user keys. Compute the query hash once per operation; compare only matching
hashes, retaining stored-key identity and insertion order on replacement. A
stored-key identity match skips equality. Distinct keys sharing a hash need
stored-key equality and owned truth conversion, including right-subtype priority.
Mixed primitive and user keys must obey the same hash/equality invariant even
when the dictionary was originally constructed by the primitive path.

Hash, equality and truth callbacks may raise or fail resource limits. Do not
commit the requested mutation until lookup succeeds; explicit callback effects
remain observable. Replacing an existing value during comparison is adopted,
and a subsequent read sees it. Structural key mutation during a pending key
comparison is an explicit UNSUPPORTED boundary after those callback effects,
before a success/missing result is delivered. Broader structural reentry needs
its own table-version/restart contract. Dictionary methods/constructors and
general tuple-with-instance hashing remain separate sequence/value API work.

## Ownership and delivery

Every pending comparison/hash/key operation must retain operands, candidate
keys, intermediate result, dictionary, original item/default and outer
destination through descriptor binding, Python frames, truth testing and
collection. New closed records need exhaustive root visitors. No nested
evaluator, implicit host callback, lossy number conversion or unowned identity
table may substitute for the common machine and arena.

Require matching Node/Chromium drain/step source reports, native and Python
recursion bounds, original error frames, active-exception/finally preservation,
paused collection, callback OOM, work/instruction/output budgets, cancellation,
idempotent close and zero logical teardown. Keep source admission, bytecode
4/5, core defaults and host grants explicit. Existing composed-resource changes
need exact explanation and evidence rather than silently replacing baselines.

- [Contract #157](https://github.com/outside-labs/pocket-python/issues/157).
- [Owned equality #158](https://github.com/outside-labs/pocket-python/issues/158).
- [Hashing/dictionaries #159](https://github.com/outside-labs/pocket-python/issues/159).
- [Offline acceptance #160](https://github.com/outside-labs/pocket-python/issues/160).

These refine [INT-EQ-01/#114](https://github.com/outside-labs/pocket-python/issues/114).
See the [data model](https://docs.python.org/3.14/reference/datamodel.html#object.__eq__)
and [NotImplemented rules](https://docs.python.org/3.14/library/constants.html#NotImplemented).
Live documentation maintenance releases do not change the pinned oracle.

## Equality adoption

E1 is implemented: 42 comparisons and four explicit later boundaries pass as
independently compiled source in Node and Chromium through drain and
instruction-step execution. The matrix now has 89 total cases; E2 hashing remains
the next slice. Nine focused units cover closed roots/layouts, original callback
frames, active exception/finally state, Python/native recursion, instruction/work
limits, actual OOM/output failure, paused collection/cancel/close, and deep/cyclic
protocol discovery without host recursion. All 234 Node tests pass, including
the eight unchanged composed resource baselines. Earlier equality refusal probes
now record their adopted behavior.

## Hashing and dictionary adoption

E2 is implemented. The expanded 103-case source matrix has 97 comparisons and
six explicit refusals. It covers numeric widths/subnormals, signed zero and
infinity, definition-time hash disabling, inherited/explicit restoration, stable
default descriptor identity, cross-module identity, stored hashes, collisions,
mixed primitive/default/user keys and observable callback failures/mutation.
Functions, classes, modules and other admitted default identity objects use the
same owned key path; user and finite native bound-method hashing follows the [method hash contract](interpreter-object-hashing.md).

Identity labels belong to the arena and are cleared on close. Dictionary queries
hash once, preserve stored-key identity and insertion order, and retain original
items/candidate keys through binding, comparison and truth. Native default-key
construction transfers operands between insertions; a 100-key source literal
passes within a 262,144-byte logical arena. Ten focused hashing units and all
244 Node tests pass, including atomic resize failure, paused collection/cancel/
close, callback OOM and the unchanged eight composed resource baselines.

## Offline acceptance and payload

The console has 76 source comparisons, 21 acceptance groups and 35 Stop/Restart
cycles. Fresh input after offline reload exercises property-bound equality,
NotImplemented/default inequality, collision lookup, replacement/deletion and
original key identity. Source diagnostics cover binding/body errors, invalid hash
results and disabled hashes. Pending comparison, hash and key-truth operations
stop/restart cleanly. A waiting class-to-core update removes the added builtin
authority; all requests remain local static GETs.

The complete [payload record](measurements/2026-10-22-equality.json) verifies the
preceding revision's input/source hashes and records every current file, hash,
notice and per-file gzip size. With the same source, complete bytes grow from
385,018 to 413,091 (+28,073), including 28,056 engine bytes. The expanded example
adds 518 source bytes, totaling 413,609 bytes across 37 files. These observations
do not establish startup, speed, device inference or package compatibility.
