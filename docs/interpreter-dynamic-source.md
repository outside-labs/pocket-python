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
