# Owned code objects and closure cells

O73 of #123 exposes `function.__code__` and `function.__closure__` in
classes-source/1. Code identity is stable per verified pool/function index,
including functions created repeatedly by one definition. Closure tuples retain
the actual cells in free-variable order, preserve identity, and are read-only.
Cells expose writable/deletable `cell_contents`. Empty reads raise ValueError;
deleting an empty cell is harmless. Writes reach existing closures, methods and
nonlocal bindings. The reflected native cell type accepts zero or one positional
value and rejects keywords and surplus arguments.

Only the independent verifier can authorize executable code. Code values retain
an immutable verified pool, its constants and source diagnostics. Assigning
`__code__` accepts an owned verified function code value with the same free-cell
count; cells are matched by position, with names taken from the replacement.
Invalid types/deletion raise TypeError; closure mismatch raises ValueError.
Assignment preserves defining globals/builtins, defaults, function names,
documentation and existing bound-method identities. Existing activations and
created/suspended generators keep their original executable pool, index and
closure mapping. Ownership/allocation failures roll back publication.

## Finite source metadata

| Fields | Contract |
| --- | --- |
| `co_name`, `co_qualname`, `co_filename`, `co_firstlineno` | Original verified definition/source metadata, including the first decorator line. |
| `co_argcount`, `co_posonlyargcount`, `co_kwonlyargcount` | Declared positional and keyword-only signature counts. |
| `co_varnames`, `co_nlocals` | Optimized source parameters and ordinary local names; nonparameter cell names and internal compiler storage are excluded. Module/class code has no optimized locals. |
| `co_freevars`, `co_cellvars` | Ordered lexical free/cell names, including captured parameters and lexical class cells. |
| `co_names` | Distinct source global/namespace and attribute names in verified instruction traversal order. |
| `co_consts` | Immutable source constant interface: document or None first, then distinct referenced immutable values and nested code values in verified traversal order. |
| `co_flags` | Adopted source flags: optimized/new-locals, variadic positional/keyword, nested-function and generator bits. |

Tuple/string fields retain their stored identities on repeated reads. The
constant and flag tables describe this independent compiler; CPython optimizer
choices and bytecode-dependent constant placement are not an interchange
format. Tests compare portable signature/source/cell behavior against pinned
CPython 3.14.7 and verify the independent constant interface directly.

Raw `co_code`, exception/line byte tables, stack/C-layout fields, arbitrary code
constructors and backend-specific `code.replace` signatures remain explicit
boundaries. Independently compiled admitted source creates code values here;
bounded dynamic compilation is O91. Directory completion is O78; remaining
native protocols/APIs retain O90 and their existing library owners. Annotation
and type-parameter evaluation remains #125.

`execution-accounting/10` records verified source definition lines, optional
code caches (eight bytes plus eight per entry), code records (56 bytes plus 24
per cached metadata field), optional closure-tuple edges and retained executable
snapshots. Generator records add 24 bytes for their executable pool/index and
closure snapshot. Existing composed instruction/work observations are unchanged;
source metadata changes their verified pool storage. Prior observations remain
in `accounting_9_cases`.

The 24-case `tests/fixtures/interpreter/code-cells.json` matrix runs on all six
Node/Chromium drivers and the installed offline console. Units additionally
cover verifier rejection, foreign owners, allocation failure, optimized-source
constants, collection during replacement, and cancellation/close while an old
activation remains live. Pinned references:
[functions](https://github.com/python/cpython/blob/v3.14.7/Objects/funcobject.c),
[cells](https://github.com/python/cpython/blob/v3.14.7/Objects/cellobject.c),
[code metadata](https://github.com/python/cpython/blob/v3.14.7/Objects/codeobject.c).
