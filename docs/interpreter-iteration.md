# Iteration and containment

The semantic oracle is **CPython 3.14.7**. The independent source matrix in
[iteration.json](../tests/fixtures/interpreter/iteration.json) separates iteration
(T1), containment (T2), and explicit later boundaries (T3). Reference-only results
record expected behavior; `implemented_stages` and source-mode reports establish
runtime adoption.

## Signatures and dispatch

Adopt positional-only `iter(value)`, `iter(callable, sentinel)`, `next(iterator)`
and `next(iterator, default)` in classes-source/1, together with ordinary `for`,
`for/else`, `in` and `not in`. Core-source/1 retains its existing primitive paths
and signatures. No async iteration, generator syntax or general iterable RHS
slice assignment follows from this contract.

Implicit hooks use current type/MRO lookup and ordinary descriptor binding;
instance shadows do not replace slots. An explicit hook call keeps ordinary
attribute lookup and its raw result. `iter(value)` calls `__iter__`, validating
that its result has a next slot without invoking/binding that slot. Absent
`__iter__` falls back to an owned integer-index iterator when `__getitem__` is
present. An explicit `__iter__ = None` blocks fallback. `next` requires a next
slot, without first calling `iter`. Slot mutations apply on the next operation.
Iterator construction does not call `__len__` or a length hint.

An indexed iterator starts at integer zero and increments only after a successful
read. IndexError or StopIteration ends it permanently; another exception leaves
the index available for retry. A callable iterator validates callability without
binding a descriptor, invokes without arguments on each advance, and compares
the result with the sentinel using identity followed by adopted equality.
Sentinel match or StopIteration permanently exhausts that internal iterator.
User iterators keep their own exhaustion state; the VM must not add a sticky flag
to a user instance. Primitive sequence/dictionary iterators keep existing bounds
and mutation rules.

## Exhaustion and containment boundaries

`next(it, default)` consumes StopIteration only from advancement (including next
descriptor binding). Loop exhaustion consumes StopIteration from advancement,
then runs `else`; an exception from iterable acquisition or the loop body
propagates. `break` skips `else`, `continue` advances normally, and return/raise
unwind enclosing finally blocks. Indexed fallback also consumes IndexError from
its own item operation. Unrelated callback errors retain their source frames.

Membership first invokes `__contains__`, passing the original key, then converts
its result through owned Python truth testing. It does not require an actual
boolean. A present noncallable/None slot fails instead of falling back. With no
contains slot, acquire an iterator and search until identity/adopted equality
matches or advancement exhausts. Stop immediately on a match. Acquisition,
contains binding/body and truth-conversion errors propagate, including
StopIteration. Rich custom comparisons follow the separately adopted
[equality contract](interpreter-equality.md).
Optional `__iter__`/`__contains__` lookup treats a binding AttributeError as a
missing hook and takes its fallback. An AttributeError from the hook body still
propagates. Next-slot lookup does not suppress binding AttributeError.

## Ownership and acceptance

Hooks enter ordinary VM frames on the common operation machine. Pending records
own receiver, key, iterator, callable/sentinel, default, intermediate result and
outer completion until transfer. Exhaustion recovery belongs to the closed
advancement continuation, not a blanket catch around evaluation. Every new
record has an exhaustive root visitor; internal iterator layouts retain their
source objects and sentinel. Mutation/collection must preserve those edges.

Require matching drain/instruction-step results in Node and Chromium, forced
collection while callbacks are paused, break/continue/return/finally, recursive
binding and callbacks, work/instruction/output limits, actual callback OOM,
cancellation and idempotent close with zero logical teardown. Retain existing
composed resource observations. Offline acceptance covers newly entered source,
callback errors, pending-hook Stop/Restart and waiting reduced-profile updates.

## Delivery

- [Contract #147](https://github.com/outside-labs/pocket-python/issues/147).
- [Owned iteration #148](https://github.com/outside-labs/pocket-python/issues/148).
- [Containment #149](https://github.com/outside-labs/pocket-python/issues/149).
- [Offline acceptance #150](https://github.com/outside-labs/pocket-python/issues/150).

These refine [INT-ITER-01/#113](https://github.com/outside-labs/pocket-python/issues/113).
The parent class milestone remains open for later object protocols and async.
The [builtin signatures](https://docs.python.org/3.14/library/functions.html#iter)
and [data model](https://docs.python.org/3.14/reference/datamodel.html#object.__iter__)
are documentation references; the executable oracle remains pinned independently
of the live documentation maintenance version.

## Owned iteration adoption

T1 is implemented: 60 pinned comparisons and three T3 refusals pass in Node and
Chromium with both drain and instruction-boundary drivers. Eleven focused units
cover layouts/roots, original error frames, enclosing exception/finally control,
recursive native/Python bindings, budgets, cancellation, callback OOM and paused
collection/close. All 218 Node tests pass, including the eight unchanged composed
resource baselines. T2 containment remains the next delivery slice. Earlier
iteration refusal probes now record their implemented behavior.

## Containment adoption

T2 is implemented. The expanded 96-case matrix has 93 adopted comparisons and
three explicit future refusals, including direct/raw contains results, primitive
and callable iterators, indexed search, early exit and exact binding/body/truth
exception boundaries. Search transfers roots to the next pending owner instead
of retaining prior values. A native string-iterator search also passes under a
32,000-byte logical arena limit. Seventeen focused units and all 224 Node tests
pass; prior composed resource observations remain unchanged. Custom equality,
generators and broader iterable RHS slice assignment remain deferred.

## Offline acceptance and payload

The class console has 62 source comparisons, 18 acceptance groups and 25
Stop/Restart cycles. Fresh source entered after offline reload exercises custom
next binding, next/default, callable sentinels, contains truth and indexed search.
Binding/body/result errors preserve source diagnostics; pending acquisition,
advancement, contains and result-truth callbacks can be stopped and restarted.
Waiting class-to-core updates remove the extra signatures. Requests remain local
static GETs, and the default core profile retains primitive traversal.

The complete [payload record](measurements/2026-10-22-iteration.json) verifies
the previous revision's input/source hashes and records both unchanged-source
and expanded-example applications. With the old source, complete bytes grow from
372,607 to 384,338 (+11,731), including 11,717 engine bytes. The expanded example
adds 658 source bytes, totaling 384,996 bytes across 37 files. Every file, hash,
notice and per-file gzip size is recorded. These are payload observations, with
no startup, speed, device-inference or package-support claim.

## Reentrant exhaustion correction

When a callable recursively advances and exhausts its own sentinel iterator,
discard its outer result as well. Indexed iteration keeps its distinct rule:
an already successful outer item read is returned even if a nested read exhausts
the iterator. Two authored reference regressions distinguish these paths.
The current matrix has 98 cases: 95 comparisons and three future refusals.
All 225 Node tests pass, including forced collection/cancel/close during a
reentrant closure callback. The console now has 63 comparisons and 18 groups,
with the same 25 Stop/Restart cycles. The separate
[correction payload](measurements/2026-10-22-iteration-reentry.json) records
385,018 bytes, a 22-byte increase with the same example source. Earlier counts
and the original payload remain evidence for the preceding checkpoint.

## Deferred iterable consumers

List `+=` retains its admitted list, tuple, dictionary and string RHS forms.
Other iterator and custom iterable forms remain deferred to INT-SEQ-01. A custom
`__iter__` or indexed fallback, and internal callable/indexed iterators, now
produce an explicit UnsupportedOperationError before binding or consuming their
hooks. A missing iterable protocol or `__iter__ = None` keeps ordinary TypeError;
the disabled slot prevents indexed fallback. Neither path mutates the list.

Six source regressions bring the matrix to 104 cases: 98 comparisons and six
explicit refusals, passing in Node and Chromium through drain/stepped execution.
All 245 Node tests pass, including unchanged resource baselines and refusal
before inherited descriptor effects. The separate
[boundary payload](measurements/2026-10-22-iterable-boundary.json) verifies the
preceding equality/hash checkpoint and records 414,161 bytes across 37 files,
an increase of 552 bytes with the same example source.
