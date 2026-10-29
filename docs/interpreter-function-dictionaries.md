# Live function dictionaries

O45/O46 continue #123 and #33. CPython 3.14.7 is the executable reference;
`tests/fixtures/interpreter/function-dictionaries.json` records the finite
contract. Reference execution alone does not establish independent execution.

| Stage | Contract |
| --- | --- |
| O45 | Ordinary Python functions expose a lazy, live dictionary through `__dict__` and `vars`. Custom attribute reads, writes and deletions share that exact dictionary. Replacement accepts an adopted dictionary, preserves its identity and detaches old aliases; deletion and non-dictionary replacement raise TypeError. Abstract-method markers use ordinary dictionary entries. |
| O46 | Ordinary bound methods forward missing attributes to the current wrapped callable through owned attribute lookup. This includes custom attributes and `__dict__`/`vars`, descriptor/read/fallback hooks and collision callbacks. Method attributes remain read-only; the returned dictionary remains mutable. |

Names use the existing bounded attribute-name contract, including empty strings
and non-identifiers. Custom values retain exact identity and are returned without
descriptor binding. Arbitrary adopted dictionary keys retain normal hash/equality
behavior. Collisions execute through the ordinary owned machine, with original
callback errors, source frames, budgets and dictionary mutation checks. Missing
entries become AttributeError; a callback's KeyError remains a KeyError.

Function data descriptors (`__dict__`, `__class__`, identity metadata and
`__doc__`) precede dictionary entries. Custom `__get__` and `__call__` entries
shadow explicit reads while implicit binding/calling retains the actual type's
protocol. Other native function metadata and default directories retain explicit
refusals. Bound methods' `__self__`, `__func__`, `__class__` and documentation
keep their existing priority. Direct `object.__getattribute__` on a method
bypasses wrapped-callable fallback; ordinary get/getattr/hasattr uses it.

An operation snapshots the function's dictionary before entering a collision
callback. Replacing `__dict__` inside that callback affects subsequent operations;
the pending operation finishes against its original dictionary. The function,
dictionary, keys, values, original method and callable remain owned through
collection, parking, cancellation, failure and close. Replacement validates the
new arena edge transactionally.

The `execution-accounting/4` extension adds one function edge and normal dictionary
storage only when a function dictionary is first read, written or replaced.
Abstract-method markers now incur that dictionary storage. Untouched functions
retain their existing layout. Earlier composed observations stay recorded;
resource changes must be attributable to newly required storage/work.

This belongs to classes-source/1 and bytecode 5. Function code/default/annotation/
closure objects, native function attributes, static/class method wrapper
dictionaries, instance/module/class live mappings and default directories remain
separate work. Native coroutine/await and host adapters remain under #34. No
dependency, host grant, release, publication or deployment change is included.

Reference implementations:
[function attributes](https://github.com/python/cpython/blob/v3.14.7/Objects/funcobject.c)
and [method lookup](https://github.com/python/cpython/blob/v3.14.7/Objects/classobject.c).

O45 is implemented with lazy arena-owned dictionaries and collision probes on the
shared machine. Pinned source cases cover replacement, aliases, marker storage,
native access and exact callback errors. Focused ownership checks cover foreign
arena transfers, actual allocation failure, cycles, parked collection,
cancellation, close and shared recursion/work/instruction limits.

O46 is implemented with owned wrapped-callable lookup, preserving native bypass
and method data-field priority. The 78-case matrix includes callback dictionary
replacement during reads/writes/deletions, nested methods, live markers and
explicit structural-collision/native-wrapper refusals. Native method `__get__`
and `__call__` reflection retain separate contracts. Focused lifecycle tests
retain detached callables and results through descriptor callbacks and parking.

Explicit `setattr` and native object attribute operations preserve a supplied
name string when inserting a new custom key; replacing an equal key retains the
first stored key. Supplied lookup names also survive dictionary collision and
ordinary method-fallback callbacks. This does not promise CPython interning
between source literals or implicit attribute names. Five identity regressions
extend the matrix to 83 cases.

The final 83-case matrix has 72 adopted comparisons and eleven explicit refusals.
All six Node/Chromium drivers pass: 498 observations with 498 zero logical
teardown records. Twenty-three representative probes extend the inventory to
265 observations per target. The unequal-collision case checks results without
fixing CPython's seed-dependent repeated-probe count.

The [decorator console](../examples/interpreter_function_dictionaries.py)
composes mutable function state, replacement aliases, retained methods and lazy
generators. Installed-wheel offline acceptance passes 1,699 program comparisons,
98 groups and 178 Stop/Restart cycles. Six supplemental checks after an offline
reload verify the final unequal-collision fixture and explicit name identities.
The [payload record](measurements/2026-10-28-function-dictionaries.json) verifies
38 files and 699,099 bytes, with an identical rebuild. All 611 adjacent unit
checks and 18 affected Python checks pass; the eight composed execution
observations remain unchanged. These are finite semantic/source/payload
observations. Broader reflection and async remain under #123/#34.
