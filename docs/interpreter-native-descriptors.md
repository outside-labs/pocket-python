# Explicit native descriptor operations

O29/O30 continue #123 and #33 with a finite CPython 3.14.7 contract.
`tests/fixtures/interpreter/native-descriptors.json` is the pinned executable
matrix. Reference-only evidence does not establish independent execution.

| Stage | Contract |
| --- | --- |
| O29 | Bound and unbound `property.__get__`, `property.__set__` and `property.__delete__` validate their native receiver and positional arguments. Getting with a non-None target calls the stored getter with that exact target; the optional owner is ignored. A None target with a non-None owner returns the same property without invoking its getter. Both target and owner None raise TypeError. Set/delete invoke the stored accessor with the original target/value and return None, ignoring its result. Missing accessors raise AttributeError. |
| O30 | Bound and unbound `staticmethod.__get__` return the exact wrapped value. `classmethod.__get__` creates a method retaining the wrapped value and the explicit non-None owner, or the target's actual type when owner is omitted/None. An explicit owner may be any adopted value. Both target and owner None raise TypeError. Binding never invokes the wrapped value's descriptor or advertised-class hooks. |

The native methods accept no keyword arguments. `__get__` takes one target and
an optional owner after its descriptor receiver; set/delete take two/one
arguments after their receiver. Wrong native receivers raise TypeError before
accessor effects. Targets need not be instances of the class storing a property.
None is a valid mutation target and is passed unchanged to the accessor.
Returned generators remain lazy; mutation discards them without iteration.

Native operations have canonical unbound identities of type wrapper_descriptor
and fresh bound values of type method-wrapper. Both expose `__name__`,
`__qualname__` and `__class__`; bound values expose their original `__self__`
and have no `__func__`. Properties and static/class method wrappers expose
their actual `__class__`. Further documentation/name/dictionary reflection,
native method rebinding APIs and builtin subclass layouts retain separate
contracts. Existing property accessor-copy APIs and ordinary implicit binding
retain their behavior.

Property callbacks use ordinary owned execution frames, return destinations and
shared budgets. Native method values retain their descriptor receiver and its
accessors/wrapped value through collection and parked instruction boundaries.
Cancellation, close, callback failure and recursion/instruction/work/allocation
limits must release all logical owners. Existing programs retain the eight
composed resource observations.

Acceptance includes pinned Node/Chromium source comparisons with draining,
instruction-boundary and parked execution, lifecycle tests, retained reports
and installed-wheel offline source with Stop/Restart in accessor callbacks.
These operations belong to classes-source/1 and bytecode 5. Core admission,
host grants, dependencies, releases and deployment are unchanged.
Live namespaces, default directories, broader descriptors and builtin layouts
remain under #123/#33; native async/await and host adapters remain under #34.

Primary references are the Python 3.14
[descriptor protocol](https://docs.python.org/3.14/howto/descriptor.html)
and the pinned CPython implementations of
[property](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c)
and [method wrappers](https://github.com/python/cpython/blob/v3.14.7/Objects/funcobject.c).
The executable reference resolves patch-level differences.

O29/O30 are implemented. The matrix has 38 property cases, 46 static/class
method cases and two explicit future refusals. Dedicated lifecycle tests retain
detached native methods, accessor closures and arbitrary class-method owners
through collection, parked execution, cancellation and idempotent close.
Resource tests cover accessor recursion and real instruction, work and allocation
failures.

Class-method binding creates an ordinary Python method even when its wrapped
value is a native callable. Its `__func__`, type and callable metadata retain
that distinction from native method-wrapper values. Equal Python methods still
share hashes; a Python method and native method-wrapper with the same callable
and receiver remain distinct dictionary keys. Native subclass-notification
defaults retain their existing builtin method identities.

## Accepted evidence

All 86 pinned cases pass Node and Chromium draining, instruction-boundary and
parked execution: 516 observations and 516 measured zero logical teardown
records. Each source report verifies 58 runtime/driver hashes and the corpus
digest. All 160 compatibility probes pass on each target; these finite
observations do not measure a percentage of Python coverage.

All 1,598 Node tests and the 60-test Python suite pass, with one explicit optional
runtime fixture skip locally. The eight composed resource observations remain
unchanged. Archive allowlists and four isolated default/compiled wheel/source
installations pass.

An isolated built-wheel installation passes offline acceptance with 1,221 program
comparisons, 75 acceptance groups and 155 Stop/Restart cycles. Fresh descriptor
source executes after offline reload; native getter/setter/deleter callbacks
stop and restart. A waiting update to core-source refuses the composed example
before its class effects.

The [descriptor console](../examples/interpreter_native_descriptors.py) and its
[source/payload record](measurements/2026-10-28-native-descriptors.json) verify all
38 files and 37 receipt members at 665,505 bytes, including an identical rebuild.
The record checks all eight source/compatibility reports against 464 current
input hashes and the offline script/engine identities. This is finite semantic
and payload evidence. Broader object/namespace work and native async/host
adapters remain open under #123/#33 and #34.
