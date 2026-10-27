# Integer conversion and indexed objects

The semantic oracle is **CPython 3.14.7**. The executable contract is
[94 independent source cases](../tests/fixtures/interpreter/indexing.json):
47 read/conversion cases (I1), 40 mutation/comparison cases (I2), one adopted
iteration case and six future boundaries (I3). Reference-only success records Python behavior; it does not prove engine
support. `implemented_stages` and exact source-mode reports determine adoption.
The separately adopted [ordering contract](interpreter-ordering.md) promotes
the five slice equality/ordering/membership cases to I2.

## Dispatch and results

Implicit __index__, __getitem__, __setitem__ and __delitem__ use current type/MRO
lookup and ordinary descriptor binding. Instance shadows do not replace implicit
slots. Class mutation is observed on the next operation. Missing slots and
noncallable slots produce TypeError; binding and callback exceptions propagate
with their Python source frames and the original caller. An explicit method call
keeps normal attribute lookup and its raw return value.

For adopted built-in string/list/tuple indexing, an integer/bool key is direct;
a user key invokes __index__ once and requires an actual adopted integer/bool.
A returned object is not recursively converted. Boolean results normalize to an
integer; warning emission is outside this profile. Negative and arbitrarily large
integers retain Python index behavior without conversion through lossy Number.
Ordinary __len__ results also use this owned index conversion before the existing
nonnegative/signed-64-bit check. Existing optional truth-binding recovery retains
its separately pinned contract.

Custom item hooks receive the **original** scalar, tuple or slice key. They do not
implicitly invoke key.__index__, normalize negative indices or reject a zero
slice step. Getters return any adopted value; setter/deleter results are ignored
by syntax, while explicit calls still return them. Scalar list deletion is
adopted with alias preservation. Dictionary keys retain their existing primitive
hash/equality boundary; indexing is not an identity-hash adoption.

## Slices and order

classes-source/1 supplies slice(stop), slice(start, stop), and
slice(start, stop, step), positional only. Construction stores the three original
values without conversion; start/stop/step are read-only. Source slicing builds
the same owned value for a custom hook. Mixed tuple/slice keys are covered in I2.
Core-source/1 retains its primitive slice-reading grammar and does not gain the
slice constructor or user-class syntax.

Source expressions evaluate left to right before dispatch. Assignment evaluates
the RHS before the target; augmented assignment evaluates the owner and key once,
reads, evaluates the RHS, computes the adopted in-place operation, then writes.
A slice's start/stop/step expressions evaluate in source order; a built-in
sequence subsequently converts **step, start, stop**, failing immediately on an
invalid/zero step. Length normalization follows the callbacks, so mutations made
by __index__ are visible. Slice bounds clamp; scalar out-of-range indices fail.

Bounded list slice assignment accepts existing list/tuple RHS values, snapshotting
before mutation to preserve aliases and self-assignment. Step-one assignment can
change length within the existing 1,024-item limit. Extended assignment requires
an exact shape; shape/type/zero-step errors leave the destination unchanged,
apart from explicit effects already performed by callbacks. Deletion supports
ordinary, extended and negative slices. String/dict/iterator RHS forms are
explicit future refusals until their iterable-consumption contract lands.

## Ownership and verification

Read, conversion and mutation use the owned operation machine and ordinary Python
frames. Each pending operation retains its receiver, key, RHS, slice components,
converted bounds and outer completion before releasing the previous owner.
Closed completion records have exhaustive root visitors. New immutable slice
values have an allocation layout containing all three child edges. There is no
nested evaluator or host callback shortcut for Python hooks.

Draining and instruction stepping must agree in Node and Chromium. Focused units
also force collection while paused, close/cancel pending bindings/bodies, exhaust
work/instruction/output quotas, trigger actual callback OOM and check zero logical
teardown. Primitive paths and the eight existing composed resource baselines
remain required. The offline console must accept new source after reload, preserve
errors and handle Stop/Restart while a hook is pending.

I3 keeps broader slice RHS forms, slice.indices, slice repr and hashing deferred.
General reflection, native ABI support, packages,
async scheduling and release/deployment are separate milestones.

## Ordered delivery

- [Contract #135](https://github.com/outside-labs/pocket-python/issues/135).
- [Owned conversion/read #136](https://github.com/outside-labs/pocket-python/issues/136).
- [Mutation/slice #137](https://github.com/outside-labs/pocket-python/issues/137).
- [Offline acceptance #138](https://github.com/outside-labs/pocket-python/issues/138).

These refine [INT-INDEX-01/#112](https://github.com/outside-labs/pocket-python/issues/112).
The parent class milestone stays open for iteration, comparison/hashing and later
protocols. See the [data model](https://docs.python.org/3.14/reference/datamodel.html#object.__index__),
[subscription rules](https://docs.python.org/3.14/reference/expressions.html#subscriptions),
[slice constructor](https://docs.python.org/3.14/library/functions.html#slice), and
[pinned slice implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/sliceobject.c).
The live documentation version is separate from the pinned executable oracle.

## Read/conversion adoption

I1 is implemented: 46 reference comparisons and eight I3 refusals pass as source
in Node and Chromium through both drain and instruction-boundary drivers. I2 is
omitted from these reports until the separate mutation step. Nine focused units
cover roots/layout, original frames, active exceptions, recursion, budget/output
limits, actual callback OOM, paused collection, cancellation and close. The full
Node suite has 200 passing tests; all eight existing resource baselines are
unchanged. Index-result and raw-slice continuations use the shared machine.


## Mutation adoption

I2 adds current type slots for setters/deleters, ignored syntax results, scalar
list deletion and bounded list/tuple slice replacement. Five further reference
cases pin immutable-target scalar conversion, repeated index conversion during
augmented slicing, RHS snapshots after conversion callbacks, mixed slice keys
and static/class method binding. The complete matrix now has 81 comparisons and
eight future refusals. A class-only build-slice opcode constructs first-class
keys for mutation and mixed subscripts; legacy bytecode versions 1–4 reject it.
Existing single-slice read bytecode and core admission remain unchanged.


## Offline acceptance and payload

The console has 54 source comparisons and 15 acceptance groups, with 15
Stop/Restart cycles. New source after offline reload exercises index conversion,
property-bound reads, setters/deleters and slice mutation. Failures cover strict
results, binding/body frames, shape errors and explicit future refusals. A waiting
class-to-core update removes class and library authority plus the slice constructor.
All requests remain local static GETs; the default core profile stays available.

The complete [payload record](measurements/2026-10-22-indexing.json) retains every
file/hash/notice and an unchanged previous source: 354,868 to 371,597 bytes
(+16,729), including engine growth of 16,670 bytes. The expanded example adds 560
source bytes, totaling 372,157 bytes across 37 files. These are uncompressed
complete applications, with per-file gzip sums recorded separately. Earlier
formatting/consolidation measurements retain their original fixtures and scope.
No startup, speed, device-inference or package-support claim follows from size.


## Slice comparison boundary

Five additional I3 comparisons pin equality, inequality, ordering, nested
sequence equality and containment involving distinct slices. These forms now
refuse with UNSUPPORTED before producing a misleading scalar. Ordinary identity,
truth and existing container alias fast paths remain available; general slice
comparison is still deferred. The current matrix has 94 cases: 81 comparisons and
13 explicit future refusals. Node has 207 tests; the eight drain/step matrices
cover 1,868 executions across Node and Chromium. The earlier 89-case and payload
records above describe the preceding checkpoint; the separate
[boundary payload record](measurements/2026-10-22-slice-refusals.json) records this
small follow-up against that unchanged console source.
