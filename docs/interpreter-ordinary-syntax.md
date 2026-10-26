# Ordinary expressions, assertions and unpacking

INT-SYNTAX-01 is tracked by [#119](https://github.com/outside-labs/pocket-python/issues/119)
and focused children #215–218. CPython 3.14.7 is the semantic reference. Both
source selections use the shared owned execution machine; class callbacks still
require the explicit class selection.

| Stage | Contract |
| --- | --- |
| Control | `assert` evaluates its test once and evaluates its optional message only on failure. Its exception identity ignores user bindings named AssertionError. Messages use the existing None/bool/int/string exception profile. Assignment expressions bind a bare name in the current lexical scope and return that same value; global/nonlocal declarations and private-name mangling apply. |
| Lambda | Anonymous functions use ordinary parameter binding, definition-time defaults and lexical cells. Their name is `<lambda>`; precedence, scope and calls use the same function machinery. |
| Unpack | Tuple/list/starred targets, nested targets and loop targets preserve cardinality errors and left-to-right partial assignment. |
| Display | Starred tuple/list displays and dictionary expansions preserve evaluation order, mapping overwrite order and aliasing. |
| Future | Unadopted assertion message formatting and comprehensions retain explicit refusals. |

The initial 59-program matrix specifies later stages before admission. Control
is implemented first: 29 semantic/error observations plus three future refusals.
Malformed assignment-expression targets and declaration order remain SyntaxError;
type aliases and comprehensions retain separate syntax gates.

Modern bytecode adds a verified assertion-exception instruction. It uses the
canonical builtin directly, while ordinary calls still honor name shadowing.
Assignment expressions lower to ordinary duplicated values and writable cells.
Their result stays rooted across stores, callbacks and instruction pauses.
Legacy bytecode rejects the new instruction.

Every stage needs independently compiled Node/Chromium source comparisons,
drain/instruction stepping, collection and zero logical teardown. Resource cases
exercise cancellation, work and allocation failure. The eight existing composed
observations remain unchanged. Source/container/argument limits remain bounded;
no new host capabilities, dependency, release or deployment are included.
