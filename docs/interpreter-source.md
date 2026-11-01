# Independent source front end

INT-08 provides `pocket-python-source/1`, the `core-source/1` profile. The same
JavaScript tokenizer, parser, binding/compiler passes and VM execute newly
supplied Python in Node and browser module workers. They do not call CPython's
parser, a server, another interpreter, our application compiler or `eval`.
CPython is a test oracle only. This engine remains a repository prototype;
PyPI pocket-python 0.2.0 contains the assemblers, excluding `runtime/`.
The development [offline source console](interpreter-console.md) now supplies
INT-WEB-01's editor, application assembly and browser/offline acceptance.

## Compile and run

From a checkout, use the JavaScript modules directly:

```javascript
import {compileSource} from './runtime/source-compiler.mjs';
import {compileSourceModules} from './runtime/source-modules.mjs';
import {ModuleSession} from './runtime/module-session.mjs';

// Compiles and verifies our bytecode; never executes the application.
const code = compileSource('def size(text):\n    return len(text)\n', {
  filename: 'logic.py'
});

const {registry, compilations} = await compileSourceModules([{
  name: 'app', package: false, imports: [],
  source: 'print(len("A😀"))\n',
  notice: 'Provenance notice for this supplied source'
}], {entry: 'app'});
const session = new ModuleSession(registry);
try {
  session.run({}, text => console.log(text)); // "2\n"
} finally {
  session.close();
  registry.close();
}
```

`tokenize` returns a frozen token snapshot. `parseSource` returns our frozen
syntax tree. `compileSource` resolves lexical scopes, lowers into version 4
bytecode, runs the structural/value verifier and returns a frozen program,
static import descriptions, logical source identity and compilation statistics.
It emits no JavaScript. The program is executed through a verified module
registry, retaining its defining globals/default pools and source locations.

`compileSourceModules` takes 1–64 explicit records containing name, package,
source, imports and notice. Names are bounded dotted ASCII module identities;
package parents must be supplied. Source accepts a string or UTF-8 Uint8Array,
including an empty package initializer. Notices are nonempty caller-supplied
provenance, not an automatic license grant. Every source record is compiled
before any application can execute. Unknown/unsupported code in a supplied
record fails the compilation even if the entry would not import that record.

Records, grants and byte views (including Node Buffers) are copied before the
first asynchronous hash. The builder creates source/bytecode/notice descriptors,
verifies their exact asset closure and returns the registry plus immutable
compilation receipts. Import grants are explicit names from that supplied set;
parsing an import never grants access or searches the filesystem/network.
Initialization/cache/cycle rules are the existing [module contract](interpreter-modules.md).
The entry executes under its declared module name, not an implicit `__main__`.

## Source and grammar

Input is UTF-8 or a JavaScript string. Malformed UTF-8, literal nulls and lone
surrogate points in source are refused; escaped surrogate points inside strings
are preserved. A UTF-8 BOM is accepted at the start of a byte array. CRLF/CR
physical lines normalize to LF. Encoding comments do not select another codec.
Tokens retain UTF-16 offsets and one-based line/UTF-8-byte spans; runtime errors
retain those original logical filenames and traceback frame/line order.

The scanner handles comments/blank lines, logical newlines, physical continuation,
matching delimiters, indent/dedent, tab stops and inconsistent indentation.
Identifiers use pinned Unicode 16.0.0 Python classification and NFKC normalization;
raw keyword spelling is checked first. Soft keywords remain names.
`generate_identifiers.py --check` reproduces the committed data from the adopted
reference Unicode database, without parsing application code. Data retains the
[Unicode permission notice](../runtime/licenses/UNICODE.txt) from
[Unicode](https://www.unicode.org/license.txt). Host Unicode upgrades cannot
silently widen the identifier repertoire. Normalized identifiers spelling
None/True/False are refused; `__debug__` is the unassignable True constant.

| Area | Adopted behavior |
| --- | --- |
| Literals | None/bool, arbitrary-precision integers in four bases, decimal binary64 floats, Unicode strings with single/triple/raw/Unicode forms and ordinary/hex/Unicode/octal escapes, adjacent strings, lists/tuples/dicts. |
| Expressions | Names, arithmetic backed by the value profile, boolean/conditional short-circuiting, comparisons including chains/is not/not in, indexing/slicing, calls and keywords, explicit module attributes and bound list.append. |
| Statements | Simple/chained name or item assignment, adopted augmented operations, name/dict-item deletion, expression/pass, if/elif/else, while/for with else, break/continue, return, raise/bare raise, try/except/else/finally, including Python 3.14 unparenthesized multi-type handlers without an alias. |
| Functions | Positional-only/positional/keyword-only and variadic parameters, definition-time defaults, global/nonlocal writes, owned starred calls, shared closure cells and recursion. |
| Modules | Static named/dotted/from/relative imports, aliases/re-exports and explicit verified registry grants, cache/initialization/cycle rules. |

Comparisons and assignments preserve evaluation order and single evaluation.
Chained comparisons stop at the first false result. Item assignment evaluates
its RHS before target lookup; augmented item assignment evaluates its target
once before its RHS. Compiler storage uses private nonidentifier slots that
cannot become Python module attributes, even after a caught error. Those cells
remain frame-owned and counted by the arena until cleared/overwritten or teardown.

Version 4 in-place operations preserve list identity for `+=` with a list,
tuple, string or dict keys, and `*=` with a bounded integer/bool factor. Direct
self-extension snapshots its original items. A repeat factor must be within
-1024..1024 and the final list within 1024 items. Iterator extension is explicitly
unsupported. Ordinary sequence repetition remains deferred in the value profile.
Immutable arithmetic delegates to the same verified value operations.

## Builtins and exclusions

The named source profile provides positional print, zero/one-argument str/bool,
one-argument repr/len/iter/next, isinstance against str/adopted exception classes,
and the existing exception hierarchy. List append is a receiver-owning Python
callable, including when aliased; a module export named append keeps ordinary
module dispatch. Arbitrary object/host attributes remain unavailable.

Print/str retain the None/bool/int/str/exception-message subset; str() is empty
and str(s) preserves identity. repr(x) covers None/bool/int/str. The explicit class
profile adds the [bounded repr/str protocols](interpreter-formatting.md).
Binary repr/str use the [value-family contract](interpreter-value-families.md).
Float/container/default-object formatting and full format specifications remain
deferred. Numeric constructors and finite range/list/tuple/all/any APIs use their
[adopted contracts](interpreter-sequences.md). Unlisted names retain the profile's
lookup error.
Numeric behavior follows the [numeric contract](interpreter-numeric.md). Ordinary
sequence repetition and existing value/transport limits retain explicit boundaries. The independent source grammar does
not imply full Python builtin/stdlib coverage.

Classes/descriptors/decorators, async/await, generators/comprehensions,
annotations, future directives, pattern matching, context managers,
exception groups, formatted/template strings, named Unicode escapes, dynamic imports and implicit host
capabilities remain outside this profile. Function/module reflection and
unlisted implicit metadata are not adopted. Assertions, assignment expressions, lambda functions and finite unpacking/display forms
are adopted through the [ordinary syntax contract](interpreter-ordinary-syntax.md).
Set/frozenset displays/construction, finite set operations, bytes/bytearray values,
strict codecs and owned one-dimensional memoryviews use the finite value-family
APIs. Bytearray resizing, additional codecs, casts and native buffers are deferred.
Syntax/features fail before target
execution; runtime value/resource failures retain their named contracts.

`SourceError` has code, phase, name, message and location. SYNTAX includes
SyntaxError/IndentationError/TabError; UNSUPPORTED, COMPILE_BUDGET and CANCELLED
are distinct. Phases identify tokenize/parse/bind/compile/registry. Runtime
execution retains Python or explicit hard-limit diagnostics. Wording is
profile-specific; source spans and error classes are tested separately.

## Bounds and verification

Hard caps are 256 KiB per source, 32,768 tokens, 64 scanner delimiter/indent
levels, 8192 AST nodes, 64 parser/tree levels, 4096 numeric-literal digits,
65,536 string-literal points and 64 normalized identifier points. Options may
lower maxBytes/maxTokens/maxDepth/maxIndent/maxNodes/maxParseDepth/maxWork.
The shared compilation work cap is 4,194,304 across scanning, parsing, binding
and lowering, including all modules in one registry build. shouldCancel polls
through those phases. Compilation is synchronous between asynchronous hashing
steps; a browser worker can also be terminated externally.

Verified code retains its caps: 128 functions/names, 512 blocks, 4096 instructions,
256 constants/stack values and 32 structured block/value levels. Bytecode assets
are at most 1 MiB; registries at most 16 MiB with 64 KiB notices. Front-end host
allocations are bounded by these input/output/work caps and are separate from
arena-owned execution values. Neither layer promises a host RSS limit. Runtime
steps/work/output/frame/arena limits and cleanup span module initialization.

Run `node --test runtime/*.test.mjs` and
`python runtime/check_conformance.py --engine source --target node` (or browser).
Source reports identify source_execution=true and include raw source/bytecode
hashes, tool/engine/corpus identities, CPython expectations, traces and teardown
counts. Thirty value-expression fixtures requiring additional source builtins
or operators remain explicitly deferred, never credited as executed successes.
The tokenizer separately compares 205 lexical cases; unit coverage also includes
500 scanner and 500 parser mutations, Buffer snapshots, private storage and
cancellation/resource boundaries. CI retains both Node and Chromium reports.
