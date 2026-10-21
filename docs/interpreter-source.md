# Independent source front end

INT-08 begins with `runtime/source-tokens.mjs`. `tokenize(source, options)` runs
our bounded scanner in Node or a browser worker. It uses no CPython parser,
external compiler, network request, `eval` or JavaScript source translation.
This first step produces tokens; parsing, binding and bytecode generation follow
under the same issue. Tokenization does not establish valid statements or
executable Python. The independent engine remains outside PyPI 0.2.0 artifacts.

Input is a JavaScript string or supplied UTF-8 Uint8Array. Malformed UTF-8,
literal nulls and lone surrogate points in source are refused. Escaped surrogates
inside strings remain Python code points. A UTF-8 byte-order mark is accepted
at the start of a byte array. CRLF and CR physical lines normalize to LF;
encoding comments do not select another codec.

Tokens retain kind, value, UTF-16 source offsets and logical filename with
one-based line/UTF-8-byte columns. Numeric/string tokens have immutable tagged
literals compatible with our VM constants. The token snapshot, spans, literal
arrays and statistics are frozen. No mutable input view is retained.

The scanner handles comments/blank lines, logical newlines, physical continuation,
matching delimiters, indent/dedent, Python tab stops and alternate indentation
checks. Names use pinned Unicode 16.0.0 Python identifier classification and NFKC
normalization. Raw keyword spelling is checked before normalization; soft
keywords remain names. `generate_identifiers.py --check` reproduces the committed
range data from the reference Unicode database, without parsing application code.
Data retains the [Unicode permission notice](../runtime/licenses/UNICODE.txt)
from [Unicode](https://www.unicode.org/license.txt). A newer host's Unicode
identifier properties cannot widen accepted names.

Adopted literals include decimal/binary/octal/hex integers with valid separators,
binary64 decimal floats, single/triple quoted strings, raw/Unicode prefixes and
ordinary/hex/Unicode/octal escapes. Integers retain canonical decimal strings;
strings retain point arrays. Unknown escapes preserve their backslash. Complex,
bytes, formatted/template strings and named Unicode escapes are unsupported.

`SourceError` records code, phase, name, message and original source location.
`SYNTAX` includes lexical SyntaxError, IndentationError and TabError;
`UNSUPPORTED`, `COMPILE_BUDGET` and `CANCELLED` remain distinct. Later grammar
diagnostics use the same shape. Wording is profile-specific.

Hard caps are 256 KiB input, 32,768 tokens, 64 delimiter/indent levels,
4,194,304 scanner-work units, 4096 numeric-literal digits, 65,536 string-literal
points and 64 normalized identifier points. Options may lower the first five
using maxBytes/maxTokens/maxDepth/maxIndent/maxWork. `shouldCancel` polls while
scanning. These bound input/work and transient host allocations; they do not
claim host RSS or replace the execution arena/budgets.

Eight Node test groups cover malformed inputs, freezing, cancellation/budgets
and 500 seeded mutations. `runtime/check_source_tokens.py` compares 205 cases
with CPython in Node and Chromium, including literals and UTF-8 spans. CPython
tokenize/literal evaluation and syntax validation are test oracles only;
application source is never run by the lexical checker. Reports identify
source-lexing and `source_execution: false`.
