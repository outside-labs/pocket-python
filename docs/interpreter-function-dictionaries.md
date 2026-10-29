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
