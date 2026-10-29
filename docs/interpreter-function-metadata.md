# Function identity metadata

O43/O44 continue the object/reflection work in #123 and #33. The executable
reference is CPython 3.14.7; the finite matrix is
`tests/fixtures/interpreter/function-metadata.json`. Reference results alone do
not establish independent execution.

| Stage | Contract |
| --- | --- |
| O43 | Python function `__name__` and `__qualname__` retain exact adopted strings; assignment accepts arbitrary bounded text, including empty text and non-identifiers, without coercion. Deletion and non-string assignment raise TypeError. Renaming does not change the other field, lexical scope, binding or code traceback names. `__module__` snapshots the defining globals' current `__name__`, or None if absent, at function creation. It accepts arbitrary owned values; deletion resets it to None. |
| O44 | Ordinary bound methods expose their callable's current name, qualification and module through owned attribute lookup. Reads preserve descriptor/read/fallback hooks and their errors on custom wrapped callables. Assignments and deletions raise AttributeError. A retained method observes later function mutations while preserving its receiver/function identity. |

The method's ordinary attribute fallback supplies these three fields. Direct
`object.__getattribute__` reads bypass that fallback and raise AttributeError;
direct native writes/deletions also raise AttributeError.

Default names have stable identity on repeated reads. Mutation preserves the
assigned object's exact identity and never calls its string, truth, equality or
hash hooks. Module metadata is a definition-time snapshot, independent of later
global rebinding; it does not grant import or host authority. Metadata never
changes a function's executable identity or a persistent callback registration.
Default names do not promise CPython string interning across distinct fields,
functions or source literals.

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

O44 is implemented with owned callable lookup and relay destinations. Its
adopted cases include original errors/source frames, AttributeError fallback,
descriptors, nested bound methods and native bypass behavior. Detached closures
and the original method remain alive across parked collection; callback tests
exercise cancellation, close, recursion and real instruction/work/arena limits.

The [metadata console](../examples/interpreter_function_metadata.py) composes
retained methods, renamed property getters, module snapshots and lazy labels.
The 86-case source matrix passes six Node/Chromium driver combinations: 516
observations with zero logical teardown. Fourteen representative probes extend
the inventory to 242 observations per target. Installed-wheel offline acceptance
passes 1,636 program comparisons and 95 acceptance groups, including 176
Stop/Restart cycles. The
[payload record](measurements/2026-10-28-function-metadata.json) verifies 38 files
and 693,839 bytes, with an identical rebuild. These are finite semantic/source/
payload observations. Broader reflection and async work remain under #123/#34.
