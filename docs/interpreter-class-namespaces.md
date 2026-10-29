# Keyed class namespace views

O49 continues #123 and #33 against pinned CPython 3.14.7. The authored
`class-namespaces.json` matrix separates adopted keyed operations from explicit
future boundaries. Reference execution alone does not establish engine support.

A class's native `__dict__` and `vars(class)` return fresh, read-only
`mappingproxy` objects. Each view retains its class and follows subsequent
attribute addition, replacement and deletion. Lookup, membership and positional
`get(key[, default])` consult only that class's own namespace; they return stored
values without descriptor binding. Inheritance is excluded. Stored mutable
values, Python functions, properties and method wrappers preserve identity.
`__module__` and `__doc__` are namespace entries; consumed `__qualname__` and
`__classcell__` are absent. Explicit class entries named `__dict__` remain stored
entries and do not replace the class's native namespace view.

Ordinary metaclass read/fallback hooks and data descriptors keep their existing
priority. Native `type.__getattribute__` bypasses a custom read hook while still
binding metaclass data descriptors. `vars` returns arbitrary custom lookup
results unchanged. Namespace replacement/deletion raises AttributeError;
item writes/deletes raise TypeError, and view attribute writes/deletes raise
AttributeError. Retained `get` methods keep the original view alive.

Text keys use exact Unicode values without coercion or lexical mangling.
Overlong query strings simply miss. Adopted primitive non-text hashable keys
miss; unhashable primitive keys raise TypeError. Callback-bearing query keys
remain an explicit refusal. Hashing a class view raises TypeError. Class views
are truthy and have ordinary owned identity.

This finite stage excludes namespace enumeration, length, copy, mapping equality,
union, native type dictionaries and unmaterialized native layout/source metadata
entries and non-data metaclass namespace shadows (`__dict__`, `__weakref__`, `__firstlineno__`, `__static_attributes__`).
Explicitly stored entries with those names are ordinary values. These operations
must refuse rather than expose a partial enumeration. Module/class-body live
locals, builtin layouts, default directories and dynamic source admission retain
separate contracts. O49 belongs to classes-source/1 and bytecode 5.

Views own their class through the arena graph; the class owns its current values.
Allocation failure cannot mutate the class. Collection, parking, cancellation,
close and cyclic references retain no leaked logical owners. Shared work,
instruction and allocation bounds apply. Existing composed resource observations
remain unchanged. No dependency, host grant, release, publication or deployment
change is included.

References: [read-only mapping views](https://docs.python.org/3.14/library/types.html#types.MappingProxyType)
and [pinned class namespaces](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).

O49 is implemented with an owned view edge and charged exact-key probes.
The matrix includes native get metadata/binding, metaclass write hooks and
explicit native mutation errors. Earlier class-namespace refusals now use O49;
module identifiers are compared within each host's explicitly named source
module rather than equating the oracle harness namespace with the registry.

All 43 pinned source cases pass through six Node/Chromium drain, instruction
and parked drivers: 258 observations with zero logical teardown. The reports
verify 348 current runtime/driver hashes. The inventory has 310 passing probes
per target. Focused view, class/value and neighboring namespace tests pass;
the eight composed resource observations remain unchanged.

The [class namespace console](../examples/interpreter_class_namespaces.py)
composes stored descriptors, retained methods, live updates and lazy generators.
Installed-wheel offline acceptance passes 1,787 programs, 102 groups and 183
Stop/Restart cycles. The [payload record](measurements/2026-10-29-class-namespaces.json)
verifies every file and receipt member. Broader reflection remains under #123/#33
and native async/browser adapters remain under #34.
