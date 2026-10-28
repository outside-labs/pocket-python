# Nested descriptor hooks

O27/O28 refine the remaining descriptor binding work under #123 and #33.
The pinned CPython 3.14.7 matrix is
`tests/fixtures/interpreter/nested-descriptors.json`. Reference-only validation
does not establish execution by the independent engine. O27 mutation binding,
O28 name-notification binding and finite offline acceptance are implemented.

The subsequent [native descriptor contract](interpreter-native-descriptors.md)
specifies explicit property and static/class method wrapper operations separately
from these implicit custom hooks.

| Stage | Contract |
| --- | --- |
| O27 | Select `__set__` and `__delete__` on the descriptor's actual type. Bind a property or custom descriptor with the descriptor instance and its actual type, including inherited hooks. Call the resulting value with the target instance/class and, for assignment, the original value. Ignore its return. Attribute syntax, attribute builtins and native object/type mutation helpers share this behavior. |
| O28 | Select and bind `__set_name__` on each namespace entry's actual type. Call the bound result with the newly created class and original attribute name. Preserve definition-order snapshots, class-cell setup, subclass notification and decorator ordering. Ignore its return. Inherited attributes and late assignment receive no automatic notification. |

Instance attributes do not replace implicitly selected hooks. Inherited binding
supplies the actual derived descriptor type. Binding happens once per operation;
changes made during binding affect the next operation or namespace entry.
Functions and static/class method wrappers retain their existing binding paths.
A bound callback, callable instance or class returned by binding uses ordinary
call dispatch and its ordinary argument validation.

Binding and callback failures propagate their original exception and Python
source frames. AttributeError during name-hook binding propagates as well; it
does not mean that the hook is absent. A property without a getter raises
AttributeError. A noncallable bound result raises TypeError. Failed class
construction retains the old class binding.

The raw type-level `__get__` hook keeps its existing direct call convention.
Nested binding for getter hooks is not implied. Live namespace dictionaries,
mapping proxies, default directories, builtin layouts, custom namespace
preparation and dynamic source admission retain their separate contracts.
Native coroutine/await, awaited host adapters and durable view/save acceptance
remain open under #34.

Both binding and invocation use ordinary owned execution frames. Pending
descriptor, target, value, returned callable, original name and notification
snapshot values must survive collection and parked instruction boundaries.
Cancellation, callback errors and idempotent close release all owners. Existing
instruction/work/recursion/arena limits remain shared; unchanged programs retain
the eight composed resource observations.

Acceptance requires Node and Chromium source comparisons with draining,
instruction-boundary and parked drivers, targeted lifecycle/resource tests and
installed offline newly entered source with Stop/Restart during binding and
invocation. The explicit classes-source/1 and bytecode-5 boundary remains;
core-source/1 admission is unchanged. No dependency, host grant, publication or
deployment is included.

Semantic anchors: the Python 3.14 [descriptor protocol](https://docs.python.org/3.14/reference/datamodel.html#implementing-descriptors)
and pinned [type implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
The pinned executable resolves behavior that differs in later documentation.

## Accepted evidence

The 42-case matrix contains 40 adopted comparisons and two explicit future
refusals. Node and Chromium each pass draining, instruction-boundary and parked
execution: 252 observations and 246 measured zero logical teardown records.
Every report verifies its 58 source/driver hashes and current corpus digest.
All 150 compatibility probes pass on each target, including six new positive
observations. These counts do not measure a percentage of Python coverage.

All 1,504 Node tests pass. Lifecycle tests collect at every instruction and
cancel/close during binding and invocation, preserving temporary operands,
callback closures, original names and removed notification entries. Original
source frames, ignored constructor/generator results and real recursion,
instruction, work and allocation failures are covered. All eight composed
resource observations remain unchanged. The 60-test Python suite passes with
its localhost HTTP test rechecked with socket access; the supplied pinned WASM
fixture also runs. Archive allowlists and four isolated default/compiled installs
pass.

An isolated installation of the built wheel passes offline acceptance with
1,170 program comparisons, 72 acceptance groups and 152 Stop/Restart cycles.
Newly entered field-hook source runs after offline reload. Setter, deleter and
name-notification binding/invocation each stop and restart. A waiting update to
core-source refuses the example before source effects.

The [field-hook console](../examples/interpreter_nested_descriptors.py) and its
[source/payload record](measurements/2026-10-28-nested-descriptors.json) verify all
38 files and 37 receipt members at 661,205 bytes, including an identical fresh
rebuild. This is finite semantic/source/payload evidence. Broader object and
namespace work under #123/#33 and native async/host adapters under #34 remain open.
