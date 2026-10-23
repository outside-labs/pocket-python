# Sequence construction and traversal

This finite slice of INT-SEQ-01 uses CPython 3.14.7 as its semantic oracle.
The synthetic `sequences.json` corpus separates reference observations from
independent source execution. A reference-only report earns no engine support.
Both core-source/1 and classes-source/1 retain bytecode versions 4 and 5.

## Adopted slices

| Stage | API and boundary |
| --- | --- |
| Q1 | `range(stop)`, `range(start, stop[, step])`, positional-only integer/index arguments; start/stop/step attributes, truth, signed-64-bit len, integer indexing, slicing, equality and iteration. Construction and slicing retain integer parameters rather than materializing elements. Class index callbacks use the owned machine. |
| Q2 | `list()` / `tuple()` and one positional adopted primitive iterable: str, list, tuple, dict keys, range or its primitive iterator. Lists are fresh shallow containers; tuple(existing_tuple) preserves identity. Unicode iteration uses code points. |
| Q3 | List/tuple construction from adopted class iterables/indexed fallback without user length hints; `all(iterable, /)` / `any(iterable, /)` over adopted iterables, with short-circuit truth callbacks. Argument, iterator acquisition, next and truth errors retain distinct boundaries. |
| Hints | User `__len__` / `__length_hint__` during list/tuple construction remains a separate, reference-only adoption. Refuse this source family before binding/consuming callbacks; do not silently ignore observable hooks. |

The machine-readable corpus records which stages are implemented. At contract
adoption none is implemented. Source reports select only delivered stages;
reference reports validate the complete corpus. Both Node and Chromium must
execute delivered source independently, including instruction-boundary stepping.

## Values and resource rules

Range arithmetic uses arbitrary integers within the existing digit budget.
Huge logical ranges do not allocate their elements. `len` raises OverflowError
above the adopted signed-64-bit maximum while truth, indexing and bounded slices
can still succeed. Range methods, hashing, repr and broader reflection remain
explicitly outside this slice. Non-integral membership uses the existing owned
iteration/equality path when required, rather than rounding a Python value.

Constructed lists/tuples keep the existing 1024-item limit and retain every
partial result while callbacks are paused. Range/consumer work polls cancellation
and charges logical work; these quotas do not measure host RSS. Failed allocation,
callback errors, early exit and repeated close must release all logical owners.
Existing composed execution resource observations remain unchanged.

## Continuing INT-SEQ-01 work

Dictionary construction; enumerate/zip/reversed; sum/min/max/sorted/map/filter;
broader string/list/tuple/dict methods; user length hints; general iterable list
extension and slice assignment; structural dictionary mutation during equality;
and tuple hashes containing user instances retain separate implementation gates.
Neither this finite batch nor availability of a builtin closes #116.

References: [range and sequence types](https://docs.python.org/3.14/builtins/stdtypes.html#ranges),
[all/any signatures](https://docs.python.org/3.14/builtins/functions.html#all),
and [length hints](https://docs.python.org/3.14/reference/datamodel.html#object.__length_hint__).

Run reference validation with:

```sh
python runtime/check_classes.py --reference-only --corpus tests/fixtures/interpreter/sequences.json
```
