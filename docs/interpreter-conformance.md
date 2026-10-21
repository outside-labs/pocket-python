# Interpreter conformance harness

Run `python runtime/check_conformance.py --report build/interpreter-node-report.json`
with Node 24.19.0 and CPython 3.14.7. For a real browser worker, install the
declared browser-tests group and Chromium, then run
`python runtime/check_conformance.py --target browser --report build/interpreter-browser-report.json`.
An installed Chrome can be selected with `--channel chrome`. CI pins the oracle
to CPython 3.14.7 and retains both reports. Local reports record actual versions.

The versioned corpus combines tests/fixtures/interpreter/language.json with its
compact values.json extension. The report hashes their length-prefixed bytes in
that order. Each semantic
case has feature tags. runtime/engines.json declares an engine's identity,
backend, supported tags, input mode and entry points. Every supported case must
have an explicit engine fixture and reference expression; missing fixtures fail
the harness. CPython evaluates only committed reference expressions, in an
isolated subprocess with a five-second timeout. It never substitutes for an
engine run. Node and browser execute the same engine module and bytecode fixtures.

The prototype compares arbitrary-precision addition/subtraction; vm1 additionally
compares multiplication, signed floor division/modulo, comparison, branching and
division errors. Negative checks cover invalid operands, unreachable unknown
operations, integer input/growth limits, bounded loops and seeded mutations.
Select vm1 with `--engine vm1` on either target. Their input is bytecode, not
Python source. Remaining semantic and malformed-source cases are reported as
unsupported. This proves neither parsing
nor full Python compatibility. Source adapters, side effects, exceptions,
further container behavior, memory ownership and language fuzzing must grow with their
implementation stages. Accounted integer-size limits do not measure host RSS.

Each schema-1 report records corpus/source SHA-256, engine/backend, exact host
and oracle versions, feature tags, expected and actual typed values/errors,
and separate pass/fail/unsupported statuses. Integers cross JSON as decimal
strings. Negative tests compare engine error codes; semantic error tests compare
Python exception classes once implemented. Requests and responses must have
matching unique IDs. Node has a 15-second process timeout; each browser case
has a ten-second worker timeout and terminates its worker. Engine instruction
budgets bound loops independently of those host timeouts.

Every subsequent interpreter change must extend the corpus and run both targets
for its new features. Unsupported source tests remain visible until an independent
source parser can execute them. An engine declaring source execution without a
source adapter fails the harness instead of receiving credit for oracle results.

Select `--engine vm2` for [bytecode-2 values](interpreter-values.md), including
None, float/Unicode, tuples/lists/dicts and iteration. Both targets use tagged
values with float bits, code-point arrays and ordered dictionary entries. NaN
arithmetic is compared with a canonical payload; retained input NaN bits have
separate round-trip tests. Function/parser cases remain unsupported.


[Version 3 functions and exception unwinding](interpreter-functions.md) extend
the verified engine and differential corpus. Select `--engine vm3` and run
`runtime/check_functions.py` on both Node and browser targets. Bytecode fixtures
still require build-time lowering; independent source parsing remains INT-08.

## Independent source execution

Select `--engine source` for `pocket-python-source/1`. Its Node runner and browser
worker accept supplied source registries and run our tokenizer/parser/binder/
bytecode compiler plus VM locally. No CPython bytecode or prepared AST enters
those workers. CPython remains the test oracle. Source JSON, module/notice and
generated-bytecode hashes, input/tool digests, source traces and teardown counts
are retained; reports explicitly set `source_execution: true`. Additional source
builtin/operator fixtures remain listed as deferred. Negative syntax/features
and hard limits are verified outcomes, distinct from successful language execution.

The separate `check_source_tokens.py` reports lexical-only comparisons with
`source_execution: false`. The older vm1/vm2/vm3/vm4 fixtures retain their input
profiles; adding a source front end does not make fixture runs source execution.
