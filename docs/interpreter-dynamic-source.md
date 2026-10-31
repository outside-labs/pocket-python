# Bounded dynamic source and imports

O91–O94 of #123 use the independent source compiler, verifier and owned
execution machine in classes-source/1, following the namespace/code prerequisites
of that profile. The CPython oracle remains 3.14.7. Registry grants and host
capabilities are unchanged by compilation or by a supplied builtin mapping.

## O91: compile

`compile(source, filename, mode, flags=0, dont_inherit=False, optimize=-1,
*, _feature_version=-1)` accepts positional or keyword arguments, rejects
missing, duplicate and unknown arguments, and performs owned `__index__` and
truth conversions in signature order. Integer compiler options have signed
32-bit validation. `filename` is a logical str or UTF-8 bytes value, up to 256
characters (including the valid empty filename); null characters raise
ValueError. Filesystem path adapters are outside this finite filename table.

| Argument | Adopted forms |
| --- | --- |
| source | str, UTF-8 bytes, bytearray and live contiguous memoryview; native payload subtypes retain their base values. Bytes with non-UTF-8 encoding directives are refused explicitly. |
| mode | exec statements, eval expression, single interactive statement (including compound suites and semicolon-separated simple statements). Interactive non-None expressions use owned repr and the existing output limit. |
| flags | Zero. Recognized AST, future, incomplete-input and async flags have explicit unsupported boundaries; unknown bits raise ValueError. |
| dont_inherit | Owned truth conversion. Admitted callers have no future directives to inherit. |
| optimize | -1/0 use the engine's normal level; 1 removes asserts and makes __debug__ false; 2 also removes function/class/module documents. |
| _feature_version | Signed integer accepted and ignored without AST mode, as in the pinned reference. |

Parsing, binding and compilation use the existing profile's independently
supported grammar. Unsupported AST objects, future statements, async and other
unadopted syntax cannot create executable code. Invalid syntax produces
catchable SyntaxError/IndentationError/TabError families. Their native directory
entries extend the existing O78 table; broader exception payloads remain #124.

Dynamic code retains the original logical filename, spans, source text,
constants and immutable verifier-authorized pool. The O73 finite code metadata,
nested code constants and stable cached fields apply. No CPython bytecode,
JavaScript executable, foreign-owner pool or arbitrary code constructor is
accepted. The optional verified source mode survives registry serialization;
interactive display instructions require that mode and a module body.

Compilation charges scanner, parser, binding, compiler and bytecode work to the
calling run, including failed attempts, with cancellation checks throughout.
`execution-accounting/16` reserves 256 + 128 bytes per UTF-8 source byte for
transient compiler storage. A dynamic pool retains 32 + two bytes per source
character in addition to its verified pool and constants. Reservations unwind
on every success, refusal, budget failure, cancellation and close. Existing
composed resource observations remain unchanged. Compilation is one bounded
instruction; subsequent execution can yield at ordinary instruction boundaries.

The dynamic-compile corpus and units cover portable metadata, all signatures,
UTF-8/buffers, modes, optimization, callbacks, validation/failure ordering,
independent verifier rejection, parked collection, cancellation, memory failure
and repeated failing compilation under a shared work limit. The source matrix
runs with Node/Chromium drain, stepped and parked drivers and in the installed
offline console.

Pinned references: [builtin implementation](https://github.com/python/cpython/blob/v3.14.7/Python/bltinmodule.c),
[builtin signatures](https://github.com/python/cpython/blob/v3.14.7/Doc/library/functions.rst),
[namespace rules](https://peps.python.org/pep-0667/). AST/future/annotation semantics
remain #125; ambient loaders and broader import APIs remain #126/#128.

## O92: eval

`eval(source, /, globals=None, locals=None)` accepts keyword namespace arguments.
Locals are validated before globals, globals must be an actual dict (including
its adopted subtypes), and locals may use an adopted mapping/subscript protocol.
Source strings and buffers strip initial spaces/tabs; independently verified
code values preserve their original filenames and spans. Statement and single
code values return their normal result; function code uses ordinary empty-call
argument validation, and generator code creates an owned generator. Code with
free cells raises TypeError before execution; source expressions see only
lexically captured caller cells in the default locals snapshot.

At module/class scope the default locals mapping is live. Optimized function
locals use the existing PEP 667 snapshot, so assignment expressions cannot
modify the caller's fast locals or add persistent extras. Explicit mappings
retain exact identity. Name lookup uses locals, globals and captured builtins
in order, with owned mapping callbacks and KeyError fallback. Dict subtype
locals and slow global/builtin reads preserve their overridden lookup;
namespace insertion bypasses overridden dictionary mutation. New lambdas retain
the actual defining globals and builtin mapping, independent of supplied locals.

A missing `__builtins__` key is inserted before source validation/compilation,
using the calling frame's captured adopted builtin namespace. Existing supplied
builtin dicts, modules and mappings participate in owned lookups, including
callback failures and mutation. Omitting a host capability from the granted
registry or source builtin catalog cannot be reversed by a supplied mapping.

Evaluation enters the current owned machine. Instructions, work, memory,
recursion, output and cancellation limits are shared with its caller. Dynamic
frames and mappings remain rooted while stepped or parked and unwind on
exceptions, cancellation and close. `execution-accounting/17` adds an optional
eight-byte identity edge only when a namespace's dict subtype differs from its
native payload; ordinary environments and composed observations are unchanged.

## O93: exec

`exec(source, /, globals=None, locals=None, *, closure=None)` shares eval's
namespace preparation and validation order. Strings and adopted buffers compile
in exec mode without trimming initial indentation. Verified expression,
statement, single, function, generator and class-body code values retain their
source diagnostics. Exec always returns None; generator code is constructed
without resuming its body. Function code has the normal empty-call binding
requirements. Executing class-body code initializes its actual namespace and
class-cell/static-attribute entries without publishing a new type.

With one dictionary, normal reads/writes/deletes use that namespace; distinct
globals/locals preserve class-like name resolution and defining-global behavior.
Explicit global declarations write/delete the true globals dict. Locals mapping
and dict subtype callbacks observe writes/deletes and exceptions in source order.
New functions/classes retain their defining globals and captured builtin
mapping. Optimized default locals are fresh PEP 667 snapshots; supplying a
retained snapshot keeps its changes, and supplying an adopted frame-locals proxy
writes through the frame/cells. Partial effects and finally suites survive an
exception in the normal owned unwinder.

Closure-bearing code requires an exact native tuple with the exact number of
owned cells, matched to co_freevars order. Cell aliases, empty cells, nonlocal
writes and later mutations are preserved. Missing, list/subtype, wrong-length
or non-cell tuples raise TypeError. A non-None closure is invalid for source
strings or code with no free cells. Namespace preparation/builtin insertion
precedes these checks, matching the pinned reference.

The adopted builtin namespace includes its literal `__name__ = 'builtins'` for
class construction in explicit globals without a module name. It adds no
capability. Nested exec uses the same machine, arena and total limits as eval;
there is no separate evaluator or fresh budget. Existing frame/cell/environment
accounting applies. The source corpus covers statements, code modes, distinct
namespaces, snapshots/proxies, callbacks, documents/optimization, retained
classes/functions, closure validation and failure effects across all six source
drivers and the installed offline console.

## O94: imports within registry grants

`__import__(name, globals=None, locals=None, fromlist=(), level=0)` accepts its
five positional/keyword arguments, rejecting duplicates, unknown keywords and
surplus/missing arguments. Name accepts str and its admitted native payload
subtypes. Level uses owned __index__ with signed 32-bit validation, rejects
negative values, and retains the registry's maximum relative depth of 32.
Absolute imports ignore globals/locals. Relative imports read the supplied dict
through owned key probes: __package__, __spec__.parent, or __name__/__path__
fallbacks. None uses an empty namespace, with the pinned missing-name error;
other non-dicts raise TypeError. Locals is passed through and ignored by the
native importer. ImportWarning emission belongs to the unadopted warnings API
under #126; specification parent lookups still execute their owned callbacks.

Names resolve only through the calling executable pool's original module grant.
Changing globals, borrowing another module dictionary or passing a captured
builtin cannot widen that grant, even if the target is already cached. Names
retain the registry's bounded ASCII/dotted format and exact module edges.
Package parents initialize in order, cache aliases retain identity, initialized
parents can participate in child initialization, and failed initializations can
retry. The existing direct initialization-cycle refusal remains explicit.
Ambient filesystem, network, sys.path searches and importlib hooks are absent.

A false fromlist returns the correct absolute root or relative prefix; a true
fromlist returns the requested module. Owned __path__ lookup determines whether
to process a package fromlist, including module __getattr__ effects. Package
namespaces include a logical __path__ list; its strings never authorize a loader.
Fromlists are consumed lazily, preserving iteration/mutation, callback errors,
child-load order, optional missing children and bounded __all__ expansion for
'*'. Supplied children require their exact caller grant. At most 1,024 fromlist
items are visited. Nonpackage fromlists retain their native validation timing.

Source import statements resolve the captured builtin __import__ callable and
pass the actual name, globals, locals, fromlist and level. Global shadowing does
not replace that captured callable. Module/class/dynamic locals retain exact
identity; optimized function imports pass None, as in the pinned reference.
Plain imports pass a None fromlist and from-imports pass their exact name tuple.
Callbacks, arbitrary callback results, missing/noncallable entries and errors
use the ordinary machine. Version-5 source import records carry a verifier-checked
fromlist; legacy records without this operand retain their previous native
interface, as do the frozen version-3/4 bytecode contracts.

`execution-accounting/18` records source import operands, owned namespace
preparation and rooted module-load continuations. All eight composed instruction
counts remain unchanged. Four import observations add 4,403 / 62,514 / 11,254 /
6,375 work units and 677 / 803 / 515 / 330 retained bytes respectively; the other
four observations are unchanged. Revision 17 remains in accounting_17_cases.
Cancellation checks target an observable entered-module state rather than a
fixed number of earlier preparation polls. No teardown runs Python callbacks.

The dynamic-imports corpus runs through all six source drivers. Units separately
verify grant denial, borrowed-global/cache isolation, the direct-cycle boundary,
parked child initialization, cancellation/close and shared instruction/work
limits. Installed offline acceptance composes dynamic compile/eval/exec with the
already selected operator/1 registry; it adds no library grant. Stop/Restart and
profile reduction retain the existing application contract. The example
[interpreter_dynamic_source.py](../examples/interpreter_dynamic_source.py) uses
classes-source/1 with operator/1.
