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

O29 property operations are implemented. The 37 property comparisons and two
future refusals pass parked Node execution; 128 focused descriptor/lifecycle
tests pass, including all eight unchanged composed resource observations.
O30 remains a reference-only stage until its dependent implementation.
