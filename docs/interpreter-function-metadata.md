# Function identity metadata

O43/O44 continue the object/reflection work in #123 and #33. The executable
reference is CPython 3.14.7; the finite matrix is
`tests/fixtures/interpreter/function-metadata.json`. Reference results alone do
not establish independent execution.

| Stage | Contract |
| --- | --- |
| O43 | Python function `__name__` and `__qualname__` retain exact adopted strings; assignment accepts arbitrary bounded text, including empty text and non-identifiers, without coercion. Deletion and non-string assignment raise TypeError. Renaming does not change the other field, lexical scope, binding or code traceback names. `__module__` snapshots the defining globals' current `__name__`, or None if absent, at function creation. It accepts arbitrary owned values; deletion resets it to None. |
| O44 | Ordinary bound methods expose their callable's current name, qualification and module through owned attribute lookup. Reads preserve descriptor/read/fallback hooks and their errors on custom wrapped callables. Assignments and deletions raise AttributeError. A retained method observes later function mutations while preserving its receiver/function identity. |

Default names have stable identity on repeated reads. Mutation preserves the
assigned object's exact identity and never calls its string, truth, equality or
hash hooks. Module metadata is a definition-time snapshot, independent of later
global rebinding; it does not grant import or host authority. Metadata never
changes a function's executable identity or a persistent callback registration.

Pending bound-method reads retain the original method and callable through
descriptor binding, body execution, fallback, collection, parking, cancellation,
failure and close. Function metadata edges participate in normal arena
ownership, cycles, traversal limits and transactional resize rollback.

The explicit `execution-accounting/3` extension charges one module edge for each
ordinary bytecode-5 function with a non-None module snapshot. Name strings and
their edges are allocated lazily on first read or replacement. Bytecode-3/4 and
internal module/class entry functions keep their existing layouts. The original
eight composed observations remain recorded alongside any revised observations;
the extension changes accounting only where this new storage is required.

This slice belongs to classes-source/1 and bytecode 5. Native callable metadata,
method-wrapper metadata copying, arbitrary function dictionaries, code/frame
objects, annotations, live namespaces and builtin layouts retain their separate
contracts. Coroutine/await and browser adapters remain under #34. No dependency,
host grant, publication or deployment change is included.

Reference implementations:
[function attributes](https://github.com/python/cpython/blob/v3.14.7/Objects/funcobject.c)
and [bound method lookup](https://github.com/python/cpython/blob/v3.14.7/Objects/classobject.c).

O43 is implemented. Its 47 adopted source cases cover exact text identities,
invalid/deleted names, independent qualification, executable identity, arbitrary
module snapshots and native reflection. Focused ownership tests exercise real
allocation failure, foreign arenas, cycles and parked cancellation/close.
