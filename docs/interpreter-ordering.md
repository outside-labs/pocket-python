# Rich ordering and slice comparisons

The oracle is **CPython 3.14.7**. The finite
[source matrix](../tests/fixtures/interpreter/ordering.json) records primitive
regressions (Base), user ordering slots (O12), list/tuple ordering (O13), slice
comparisons (O14), and explicit future boundaries. Reference-only results do
not adopt a stage; adoption requires independently compiled source in Node and
Chromium, with draining and instruction-boundary drivers and zero logical
teardown.

## O12: Ordering methods

In classes-source/1, adopt `__lt__`, `__le__`, `__gt__` and `__ge__` through
actual type/MRO lookup and ordinary descriptor binding. Instance shadows and
instance attribute hooks do not replace implicit slots. Reflected operations
exchange `<` with `>` and `<=` with `>=`. A strict right-hand subtype gets the
first attempt, including an inherited method; otherwise try left then right.
Same-type operands can try both corresponding methods. Identity does not skip
an ordering callback.

Missing slots and descriptor-binding AttributeError skip an attempt. A present
noncallable fails with TypeError; other binding errors and all body errors
propagate. NotImplemented advances to the next attempt. Exhausted ordering
raises TypeError, including same-object comparisons: equality supplies no
default ordering and `<=` is not synthesized from `__lt__` and `__eq__`.

Return a callback's raw result. Truth conversion belongs to its consumer,
including conditionals, chained comparisons and container equality scans.
Preserve ordinary evaluation order, one evaluation of each chain operand,
type-slot mutation between attempts, active exceptions and original frames.
Metaclass ordering remains refused before class-body effects; it is not
adopted by ordinary instance slot support.

## O13: List and tuple ordering

For matching list/list or tuple/tuple operands, scan bounded elements in order.
Accept element identity, otherwise perform equality and owned truth conversion.
If a common prefix is equal, compare current lengths using the requested
operator. Ordering does not use equality's unequal-length shortcut.

At the first unequal position, invoke the requested ordering operation on the
current element pair and return its raw result. In particular, do not combine
less-than with a second whole-container equality pass for `<=` or `>=`.
List equality/truth callbacks can replace, delete or append elements. Recheck
current lengths after the scan and reload the unequal elements after callbacks;
do not compare a stale saved pair. Tuple operands remain immutable but their
referents can execute callbacks. Nested comparisons share recursion and
activation budgets. Distinct NaNs, shared NaNs and incomparable primitive
elements retain the primitive behavior recorded by Base.

## O14: Slice comparisons

Adopt `==`, `!=`, `<`, `<=`, `>` and `>=` for the three raw `start`, `stop` and
`step` fields. They compare as a three-element tuple, without index conversion,
normalization or slice application. Field identity skips equality, and equality
scans truth-test their results. Inequality uses the tuple's equality scan rather
than field `__ne__`. The requested ordering on the first unequal field returns
its raw result. Shared None fields can therefore form an equal prefix; ordering
different None/integer fields can raise TypeError.

Same-slice identity supplies the tuple-style result. Cross-type equality falls
back to ordinary reflected equality/identity; cross-type ordering can try an
ordinary instance's reflected method and otherwise raises TypeError. Adopt
nested slices and slices used in container equality, membership and sentinel
comparison. Slice hashing, `indices`, display and broader descriptors remain
separate stages. The constructor remains exclusive to classes-source/1.

## Ownership and delivery

Use the common owned comparison machine and unwinder. Pending scans retain both
containers, equality results and outer destinations; pending ordering retains
the selected current elements even if callbacks remove them from their original
containers. Every new completion field needs exhaustive root enumeration. Do
not use host recursion, nested evaluation or implicit callbacks.

Verify callback binding/body/truth errors, source frames, active exception and
finally behavior, real recursion/instruction/work/allocation limits, forced
collection at paused boundaries, cancellation, idempotent close and zero logical
teardown. The eight existing composed resource observations must remain
unchanged. Primitive core-source/1 behavior, bytecode 4/5 and output-only host
grants retain their current contracts. Sorting/min/max, user-key set ordering,
namespace/identity reflection and async remain separate work.

- [Contract #279](https://github.com/outside-labs/pocket-python/issues/279).
- [Ordering methods #280](https://github.com/outside-labs/pocket-python/issues/280).
- [List/tuple ordering #281](https://github.com/outside-labs/pocket-python/issues/281).
- [Slice comparisons #282](https://github.com/outside-labs/pocket-python/issues/282).
- [Offline acceptance #283](https://github.com/outside-labs/pocket-python/issues/283).

These refine [#123](https://github.com/outside-labs/pocket-python/issues/123).
See the [rich comparison data model](https://docs.python.org/3.14/reference/datamodel.html#object.__lt__)
and [sequence comparison rules](https://docs.python.org/3.14/library/stdtypes.html#comparisons).
Live documentation revisions do not change the pinned oracle.

## Ordering method adoption

O12 is implemented. The 55 method cases and five Base/Future observations pass
in Node and Chromium with draining and instruction-boundary drivers. Raw values,
all four reflected method pairs, inherited subtype priority, descriptor failures,
same-type fallback, type mutation and original error frames match the oracle.
Focused lifecycle checks collect during binding, method bodies and consuming
truth, and verify cancellation, close, recursion and real budget/OOM failures.
The complete Node suite passes with the existing composed resource baselines.

## Sequence ordering adoption

O13 is implemented. The 29 list/tuple cases join the existing stages for 89
observations per Node/Chromium driver combination. Equality and truth callbacks
may replace, shrink or grow lists before the current unequal pair is selected.
The selected pair, raw ordering result and outer expression survive collection
and cancellation, including callbacks that remove both operands from their
lists. Recursive element equality shares the comparison depth limit.

## Slice comparison adoption

O14 is implemented. The complete 112-case matrix has 109 adopted comparisons
and three explicit future refusals per Node/Chromium driver combination. It
covers raw fields, identity prefixes, nested slices, reflected peers, equality
truth, dictionary values, membership and callable sentinels. The five former
slice-comparison refusals in the indexing matrix are adopted. Slice hashing now
follows the [owned hash contract](interpreter-object-hashing.md); indices, display
and broader iterable slice assignment remain refused.

All 693 Node tests pass, including paused slice equality binding/truth and
ordering binding, cancellation/close, recursive slice comparison and real
ordering-budget/OOM failures. The shared primitive cases also pass through the
core source profile. Existing composed resource observations are unchanged.

## Offline acceptance and payload

The [ordered-note console](../examples/interpreter_ordering.py) combines raw
ordering results and truth conversion, stable insertion using slice mutation,
list/tuple prefix ordering, slice equality/ordering and suspended generators.
The installed-wheel console suite passes 696 program comparisons and 53
acceptance groups with 117 Stop/Restart cycles. Fresh source after offline reload
exercises ordering, mutation and slices; errors preserve binding/body/truth
frames. A waiting class-to-core update retains primitive ordering while refusing
class syntax before effects. All requests remain local static GETs.

The [payload record](measurements/2026-10-27-ordering.json) verifies the corpus,
all eight class/core Node/Chromium drain/step reports and their source hashes:
456 observations and 456 measured zero logical teardown records. It verifies
all 38 example files, receipt hashes and an identical fresh rebuild, totaling
612,319 bytes. This is a payload observation, not a performance comparison.
All 693 Node tests and 60 Python tests pass locally (one optional runtime skip);
isolated wheel/source-distribution allowlist and assembly checks pass. No
dependency, host authority, publication or deployment change is included.
