# Function defaults and defining namespaces

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O72 of #123 exposes function `__defaults__`, `__kwdefaults__`, `__globals__`
and `__builtins__` in classes-source/1, including bound-method forwarding and
qualified native getsets. Positional defaults are the actual tuple, keyword
defaults the actual dictionary, and absent defaults are None. Repeated reads
preserve identity. Definition-time values, including mutable containers, retain
their original aliases. Replacement accepts tuple-or-None and dict-or-None;
deletion restores None. Surplus positional defaults apply from the right.

Calls retain positional bindings before looking up missing keyword-only
parameters. Keyword defaults use owned dictionary probes, including stored
callback-bearing keys, mutation/restart behavior and original callback errors.
Invalid positional/keyword binding fails before default-key callbacks. Missing
keyword defaults raise TypeError after the relevant probes. Normal functions,
closures, bound methods, generators and registered persistent callbacks share
this binding path. Updating defaults does not change code or traceback identity.

`__globals__` is the real defining namespace dictionary. It is shared with the
module and globals(), so mutations affect later name resolution. `__builtins__`
is the captured defining builtin mapping. An explicit globals `__builtins__`
dictionary is retained by identity; a granted source module supplies its actual
dictionary. Later replacement of that global affects newly defined functions;
existing functions keep their mapping. Invalid captured values retain their
native lookup TypeError rather than receiving an implicit fallback. Qualified
namespace fields are read-only and raise AttributeError on write or delete.

The default source builtin namespace contains the finite adopted builtin names;
its materialization does not expose host builtins or add capabilities. Internal
native operations keep their own canonical callable cache, so user namespace
mutation cannot replace the engine's own helpers. All source frames sharing the
default namespace observe its subsequent dictionary writes and deletions.
The O67 module namespace remains the actual independently initialized namespace;
exposing function metadata does not synthesize additional global entries.
Annotation evaluation and dynamic source/import APIs retain #125 and O91–O94.

`execution-accounting/9` keeps compact defaults and the default builtin namespace
lazy. Exposing defaults retains an owned tuple or dictionary instead of its
compact value edges. The builtin environment and materialized namespace are
charged through existing environment/dictionary layouts. The eight existing
composed observations are unchanged; their prior record is retained in
`accounting_8_cases`. Mutations roll back if ownership or allocation validation
fails.

The pinned CPython 3.14.7 matrix is
`tests/fixtures/interpreter/function-state.json`, registered for six execution
drivers and installed offline acceptance. Additional tests retain positional
bindings during callback mutation, collect at parked boundaries, cancel/close
mid-binding, reject foreign owners, and update registered callbacks between
activations. See the pinned [function implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/funcobject.c)
and [argument binding](https://github.com/python/cpython/blob/v3.14.7/Python/ceval.c).
