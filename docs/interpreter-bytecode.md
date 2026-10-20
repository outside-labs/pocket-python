# Bytecode version 1 and bounded execution

runtime/bytecode.mjs verifies our `pocket-python-bytecode` format, version 1.
runtime/vm.mjs executes its frozen snapshot in Node or a browser module worker.
The prototype format remains separate architecture evidence. Neither input is
Python source, CPython .pyc or the application compiler IR.

An input contains `format`, `version`, `constants` and `instructions`. Constants
are `{type: "int", value: "-7"}` canonical decimal strings or
`{type: "bool", value: true}`. The pool is limited to 256 entries and integers to
4096 decimal digits excluding sign. The instruction list has 1–1024 entries.
Optional `source` contains a filename (1–256 characters) and one
`[line, column, endLine, endColumn]` span per instruction; coordinates are ordered,
one-based and bounded to one million.

| Instruction | Operand | Stack behavior |
| --- | --- | --- |
| const | Constant-pool index | Push the immutable value |
| add, subtract, multiply, floor-divide, modulo | None | Pop right, then left; push the integer result |
| equal, less | None | Compare numeric values; push a bool |
| dup, pop | None | Duplicate or remove the top value |
| jump | Instruction index | Transfer unconditionally |
| jump-if-false | Instruction index | Pop condition; branch for zero/False |
| return | None | Finish with exactly one value |

Every opcode/operand, including unreachable instructions, is validated before
execution. Iterative control-flow analysis checks reachable stack underflow,
the 256-value stack limit, exact return height, matching heights at joins and
fallthrough. Stack-growing loops fail validation; balanced infinite loops are
valid and require an execution budget. This proves structural stack safety,
not termination or general Python typing. Unknown versions and call/recursion
instructions fail with BYTECODE. Functions and their explicit call-depth limit
belong to INT-06; the current loop never uses host recursion.

Python integers use BigInt. Bool remains a distinct result type and participates
in numeric operations as 0/1. Floor division and modulo preserve Python's signs
for both operands. Division by zero reports ZeroDivisionError, not a host
BigInt exception. Runtime errors include code, exception name, instruction index
and optional original source span. Syntax is not parsed at this stage.

`execute(program, {maxSteps, maxWork, shouldCancel})` defaults to 10,000 steps and
one million arithmetic-work units. Steps are bounded to 1–1,000,000 and work to
1–100,000,000. Add/subtract/compare charge the larger operand digit count;
multiply/divide/modulo charge their digit-count product before the primitive.
Results exceeding 4096 digits fail with BUDGET. Primitive inputs are already
bounded; multiplication can transiently allocate an 8192-digit result. These
limits bound this numeric core. The [INT-05 memory layer](interpreter-memory.md)
adds rooted object graphs and deterministic allocation accounting to execution;
neither layer claims a hard host RSS limit.

Cancellation polls the supplied callback before instructions and arithmetic
primitives. A synchronous worker loop cannot process a queued stop message;
the browser may terminate the worker, while later execution scheduling adds
cooperative message handling. CALL, object allocation, I/O and host callbacks
are not silently provided by the JavaScript host.

Run `node --test runtime/vm.test.mjs` and both targets of
`python runtime/check_conformance.py --engine vm1 --target node` (or `browser`).
The shared corpus compares precision, all sign combinations of division/modulo,
numeric comparisons, a conditional branch and ZeroDivisionError with CPython.
Seeded invalid indices, unknown versions, unreachable opcodes, stack joins,
fallthrough, digit limits and bounded loops exercise the verifier and budgets.

[Bytecode version 2](interpreter-values.md) extends this verifier with explicit
core values, container construction/mutation, indexing/slicing and iteration.
Version 1 retains the integer-only format described above.
