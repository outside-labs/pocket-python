# Identity and finite namespace reflection

The O15–O17 slices under #123 use CPython 3.14.7 as their executable
reference. `tests/fixtures/interpreter/reflection.json` records adopted and
future cases before implementation. Reference-only results do not establish
independent execution. These APIs belong to classes-source/1 and bytecode 5;
core-source/1 admission and bytecode 4 remain unchanged.

| Stage | Adopted contract |
| --- | --- |
| O15 | `id(value, /)` returns an integer identifying an adopted arena object or the None/True/False singletons. Simultaneously live distinct objects have distinct identities; aliases retain identity through mutation, collection, parked execution and callbacks. Identity agrees with the existing `is` operation and never invokes hashing, equality or attribute hooks. IDs are session-local opaque integers, without an address or cross-session guarantee. Unboxed integer identity remains an explicit refusal, matching the existing `is` boundary. |
| O16 | In ordinary optimized function, lambda and generator frames containing no list/dict/set comprehensions, `locals()` and zero-argument `vars()` return a fresh shallow dictionary on each call. Include bound parameters, ordinary local cells and captured free cells; omit unbound/deleted names, explicit globals and compiler storage. Preserve parameter/local/cell/free-variable order, including assignment-expression and definition-time operand order. Snapshot mutation cannot rebind a Python cell, while referenced mutable values keep their identity. Zero-argument `dir()` returns a fresh list of the same currently bound names, sorted by Unicode code point. Aliasing the builtin still inspects its immediate calling Python frame. Lexical `__class__` cells are visible when captured. |
| O17 | `vars(object, /)` reads `__dict__` through ordinary owned attribute lookup, including custom descriptors, `__getattribute__` and `__getattr__`. Return the result unchanged, even if it is not a dictionary. Convert only terminal AttributeError to TypeError. `dir(object, /)` selects a custom `__dir__` on the actual type/metaclass, bypasses instance shadows and read hooks, binds its descriptor and invokes it with no arguments. Copy its iterable result, then sort bounded string entries by Unicode code point, retaining duplicates and leaving the returned iterable unchanged. Binding, iteration and method-body errors propagate. |
| Future | Live globals/module/class namespaces, ordinary instance dictionaries, class mapping proxies, function/module dictionaries, default object/type/builtin directories, comprehension namespace reflection, integer identity, custom directory entries other than strings, and custom directory iterables with length hints require separate contracts. Dynamic exec/eval/compile/import, builtin instance layouts and additional metaclass protocols remain open. |

Module and class `locals()` have a live mapping contract; an optimized snapshot
must not stand in for them. Inlined comprehensions and generator-expression
implicit parameters also need their own namespace rules. These forms refuse
explicitly at invocation. `globals()` remains an explicit refusal. Custom
directory iterables without length hooks use the adopted owned iteration
protocol; a custom iterable with `__len__` refuses before iteration. Builtin
iterables and ordinary generators retain their existing finite behavior.

Ordinary instance `__dict__` storage/replacement and class mapping proxies remain
unimplemented. Defining a custom instance `__dict__` descriptor is distinct from
adopting that storage model. Class namespace reflection must not return an
instance descriptor as the class's own dictionary.

Snapshot dictionaries and directory copies use existing bounded value owners,
with charged traversal, allocation and sorting. Temporary keys and values,
descriptor receivers, iterables, partial copies and outer destinations remain
rooted during callbacks and collection. IDs reuse the arena's weak identity
registry and do not retain otherwise unreachable objects. No host object,
Python frame object or private compiler name is exported.

Python callbacks enter the common execution machine. Cancellation, close,
recursion/work/instruction limits and real allocation failure release all logical
owners without executing new finalizers. Existing eight composed resource
observations retain their costs; reflection has separate charged observations.
Acceptance runs the source matrix in Node and Chromium, draining and stepping,
with lifecycle tests and installed offline console Stop/Restart coverage.

The reference anchors are the Python 3.14
[builtin functions](https://docs.python.org/3.14/library/functions.html),
[custom directory hook](https://docs.python.org/3.14/reference/datamodel.html#object.__dir__)
and [namespace semantics](https://peps.python.org/pep-0667/). The pinned executable
reference resolves patch-level documentation differences. No dependency, host
capability, release, package publication or deployment is part of this slice.

Reflection of enclosing functions containing list/dict/set comprehensions remains
deferred with the comprehension namespace contract. Their inlined binding order
and cell rules must be adopted together. Enclosing generator-expression functions
retain ordinary optimized namespace rules. The compiler charges its bounded
control-block traversal when recording local operand order.
