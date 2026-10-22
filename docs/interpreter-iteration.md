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
StopIteration. Rich custom comparisons remain separately gated by INT-EQ-01;
iteration does not authorize an approximate custom equality implementation.
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
The parent class milestone remains open for equality/hash and later protocols.
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
