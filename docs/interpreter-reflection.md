# Identity and finite namespace reflection

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

The O15–O17 slices under #123 use CPython 3.14.7 as their executable
reference. `tests/fixtures/interpreter/reflection.json` records adopted and
future cases before implementation. Reference-only results do not establish
independent execution. These APIs belong to classes-source/1 and bytecode 5;
core-source/1 admission and bytecode 4 remain unchanged.

The implemented [O18–O20 contract](interpreter-directory-scopes.md) extends this
profile with generator-expression namespaces, custom directory length hints and
owned ordering of arbitrary adopted directory entries. Its acceptance record
supersedes the earlier finite boundaries below for those three forms.
The [O21/O22 contract](interpreter-comprehension-reflection.md) further adopts
inlined list/dict/set comprehension reflection and enclosing optimized scopes;
the earlier comprehension refusals below describe the preceding checkpoint.

| Stage | Adopted contract |
| --- | --- |
| O15 | `id(value, /)` returns an integer identifying an adopted arena object or the None/True/False singletons. Simultaneously live distinct objects have distinct identities; aliases retain identity through mutation, collection, parked execution and callbacks. Identity agrees with the existing `is` operation and never invokes hashing, equality or attribute hooks. IDs are session-local opaque integers, without an address or cross-session guarantee. O75 extends identity to integers through the [owned integer contract](interpreter-integer-identity.md). |
| O16 | In ordinary optimized function, lambda and generator frames containing no list/dict/set comprehensions, `locals()` and zero-argument `vars()` return a fresh shallow dictionary on each call. Include bound parameters, ordinary local cells and captured free cells; omit unbound/deleted names, explicit globals and compiler storage. Preserve parameter/local/cell/free-variable order, including assignment-expression and definition-time operand order. Snapshot mutation cannot rebind a Python cell, while referenced mutable values keep their identity. Zero-argument `dir()` returns a fresh list of the same currently bound names, sorted by Unicode code point. Aliasing the builtin still inspects its immediate calling Python frame. Lexical `__class__` cells are visible when captured. |
| O17 | `vars(object, /)` reads `__dict__` through ordinary owned attribute lookup, including custom descriptors, `__getattribute__` and `__getattr__`. Return the result unchanged, even if it is not a dictionary. Convert only terminal AttributeError to TypeError. `dir(object, /)` selects a custom `__dir__` on the actual type/metaclass, bypasses instance shadows and read hooks, binds its descriptor and invokes it with no arguments. Copy its iterable result, then sort bounded string entries by Unicode code point, retaining duplicates and leaving the returned iterable unchanged. Binding, iteration and method-body errors propagate. |
| Future | Live globals/module/class namespaces, ordinary instance dictionaries, class mapping proxies, function/module dictionaries, default object/type/builtin directories, inlined comprehension namespace reflection and integer identity require separate contracts. Dynamic exec/eval/compile/import, builtin instance layouts and additional metaclass protocols remain open. |

Module and class `locals()` have a live mapping contract; an optimized snapshot
must not stand in for them. Inlined comprehensions retain a separate namespace
contract and refuse at invocation. O18 adopts generator-expression snapshots,
including the implicit iterator under `.0`. `globals()` remains an explicit refusal. Custom
directory iterables use the adopted owned iteration protocol. O19 adds length
and length-hint callbacks after acquiring the iterator; other consumers retain
their own hint boundaries. Builtin iterables and ordinary generators retain
their existing finite behavior.

Ordinary instance `__dict__` storage/replacement is now adopted by the
[O47/O48 contract](interpreter-instance-dictionaries.md); class mapping proxies
remain unimplemented. Defining a custom instance `__dict__` descriptor is distinct from
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

## Accepted evidence

O15–O17 are implemented within the finite boundaries above. The current matrix
contains 98 cases: 82 adopted comparisons and sixteen explicit refusals. Node and
Chromium each pass draining and instruction-boundary execution, totaling 392
observations and 392 measured zero logical teardown records. Retained reports
verify all 58 source/driver hashes and the corpus hash. The earlier attribute
corpus also adopts its custom directory case.

All 876 Node tests pass, including the eight unchanged composed resource
observations. Dedicated tests cover persistent callback identity, generator
snapshots, Unicode and operand/control-flow namespace order, partial iterable
copies, descriptor and method source frames, every-instruction collection,
cancellation/close and real recursion/work/instruction/allocation failures.
The 60-test Python suite passes with one optional runtime skip; wheel/source
allowlists and four isolated default/compiled installations pass. The
compatibility inventory has 125 finite probes and retains explicit live and
comprehension namespace refusals.

Installed-wheel offline console acceptance passes 795 program comparisons and
57 groups, including all current reflection cases after reload. Its 122
Stop/Restart cycles cover snapshot growth, custom dictionary/directory bodies,
directory descriptor binding and suspended directory generators. A waiting
class-to-core update removes the reflection builtin names.

The [reflection console](../examples/interpreter_reflection.py) combines mutable
records, IDs, snapshots and custom dictionary/directory hooks. Its
[payload and evidence record](measurements/2026-10-27-reflection.json) verifies
all 38 files and receipt members at 638,936 bytes; a fresh assembly is identical.
This is a finite payload observation, without a performance or package claim.

The [O49 keyed class namespace contract](interpreter-class-namespaces.md)
supersedes earlier blanket class-mapping refusals. Enumeration and native
layout/source metadata entries retain explicit boundaries.

The [O50 function directory contract](interpreter-function-directories.md)
adopts native function/object directory names combined with the live function
dictionary. Other default directory layouts and unread metadata remain separate.

The [O51 method directory contract](interpreter-method-directories.md) adopts
native method/object names with owned wrapped-callable dictionary lookup.
The [O52 namespace view directory contract](interpreter-namespace-view-directories.md)
adopts mappingproxy/object names independently of class mapping enumeration.
Both preserve native directory binding and retained receivers; unread native
metadata and other default layouts retain separate contracts.

[O53 property directories](interpreter-property-directories.md) collect pinned
native names independently of lazy names, documents, abstract flags and accessor
callbacks. Other default layouts and native metadata retain their own contracts.

[O54 native callable directories](interpreter-native-callable-directories.md)
distinguish adopted method/wrapper descriptors and their bound native layouts.
Receiver chains retain exact properties, live views and functions without
consulting their dictionaries or hooks.

[O55 generator directories](interpreter-generator-directories.md) add fresh sorted and raw native lists without starting, resuming or closing the generator. Detached callers retain the suspended frame and values; unread frame/code metadata and other layouts retain separate contracts.

[O56 native iterator directories](interpreter-iterator-directories.md) collect actual native layout names without advancing sources, comparing sentinels or validating mutated containers. Readable metadata and further native methods remain separately adopted; user-defined iterator instances retain their ordinary directory boundary.

[O65 callable type directories](interpreter-callable-type-directories.md) and
[O66 generator/iterator type directories](interpreter-iterator-type-directories.md)
add their canonical native type namespaces independently of instance keys and
stored values. Native type binding, ordinary advertised namespaces, raw order
and sorted fresh results retain owned callbacks and shared budgets. Listed
metadata and methods retain their separate read/API contracts.
