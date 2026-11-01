# Native directory closure

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O78 closes the finite directory matrix for the actual layouts exposed after O77.
The [machine-readable layout audit](interpreter-directory-layouts.json) accounts
for all 85 pinned native types, source class/instance layouts, seven native
callable/descriptor layouts and internal records that cannot escape as source
values. Every native row links executable type and instance cases, or an exact
constructor boundary with its owner. The oracle remains CPython 3.14.7.

Default/raw directories now cover modules, cells, code objects, frames and frame
local proxies, adopted exception representations, general builtin functions,
primitive native methods, mapping views and their forward/reverse iterators,
getset/member/class-method descriptors and their detached native callers. Actual
native namespaces supply keys and inheritance order through the same inventory
used by materialized type dictionaries. Listings do not invoke descriptors,
resume generators, copy frame locals, inspect cell contents, evaluate annotations
or call native library APIs. `dir` returns fresh sorted results; raw calls preserve
merge order and exact key objects. Retained/closed frames, empty cells and released
buffer iterators retain their directory behavior.

Module `__dir__` uses the actual live dictionary and its optional custom hook.
Explicit native bound/unbound calls retain that hook; `object.__dir__` performs
generic dictionary/type merging. Custom results remain raw until the builtin's
ordinary iterable-copy/sort phases. Dictionary callbacks, receiver/signature
errors and source diagnostics use the existing execution machine.

Native namespace key identities survive directory calls before and after full
dictionary materialization. A lazy key table owns canonical string keys without
loading native descriptor documentation. The full dictionary reuses those keys
and replaces the temporary key table. [Accounting revision 13](execution-contract.md#native-namespace-key-accounting-revision-13)
charges every table edge and verifies allocation/publication rollback. The eight
existing composed observations remain unchanged. Representative compatibility
probes use the source matrices' explicit 50,000-instruction/20,000,000-work limits;
the runtime's default limits remain unchanged.

The audit includes UnicodeEncodeError/UnicodeDecodeError produced by admitted
codecs. LA-29 replaces the former UnicodeTranslateError construction refusal
with positive native instance-directory evidence. Its four-argument constructor,
five independent fields and subclasses, followed by LA-30 native rendering and
LA-31 composed acceptance, are documented in the
[exception contract](interpreter-exceptions.md). Remaining exception families
retain #124. Listing methods never adopts reduction,
serialization, display, annotation or other separately owned APIs.

Node/Chromium drain, instruction-boundary and parked matrices, lifecycle/shared
limit checks and installed offline console acceptance cover these layouts. The
offline module flow uses the already granted operator registry and exercises
native/default/custom directories plus Stop/Restart inside its hook. O84–O88
extend this same audit when they add layouts. #123 remains open through O96;
release and deployment are separate.

References: pinned [native namespaces and directory traversal](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c),
[module directories](https://github.com/python/cpython/blob/v3.14.7/Objects/moduleobject.c),
[exceptions](https://github.com/python/cpython/blob/v3.14.7/Objects/exceptions.c) and
[native descriptors](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c).
