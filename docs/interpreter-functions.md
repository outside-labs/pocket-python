# Functions, lexical cells and exception unwinding

INT-06 adds our own `pocket-python-bytecode` version 3 interpreter in
runtime/functions.mjs. The same verified code runs in Node and browser workers.
Versions 1 and 2 retain their formats and implementations. Published
pocket-python 0.2.0 excludes this independent engine.

Input is bytecode. runtime/function_fixtures.py uses CPython AST/symbol tables
only to build trusted test fixtures; it never runs in a worker. The independent
[source front end](interpreter-source.md) now compiles newly supplied source;
INT-WEB-01 owns the offline console.
Execution uses this independent VM.

## Supported behavior

- Positional, positional-only, keyword and keyword-only parameters, immutable
  literal defaults, implicit None and explicit return values. Arguments evaluate
  once in source order before binding, including calls that fail binding.
- Lexical locals, module globals and shared closure cells: intermediate captures,
  enclosing rebinding, recursive local functions and mutual module recursion.
  NameError/UnboundLocalError distinguish missing globals, empty free cells and
  unbound locals. Module assignments update globals; function assignments update
  declared locals. Python calls use an iterative frame stack.
- If, while/for, loop else, break/continue and return through nested handlers.
- Raise an adopted exception instance/class, bare re-raise, named builtin
  handlers/tuples, subclass matching, bare except, else and finally. A final
  return/error/loop transfer replaces the pending completion. Handler aliases
  clear on every exit, including captured aliases. Failed handler-type
  evaluation runs finally and preserves exception context.
- Tracebacks retain function names and original filename/spans, including caller
  sites and bare re-raise behavior. Diagnostics export no frame locals or
  unleased objects. Fixtures use one-based CPython AST line/UTF-8 column offsets;
  differential tests compare traceback frame/line order.

The explicit hierarchy is BaseException, Exception, ArithmeticError,
ZeroDivisionError, OverflowError, LookupError, IndexError, KeyError, ValueError,
TypeError, NameError, UnboundLocalError, RuntimeError, RecursionError and
StopIteration. INT-07 adds the shared ImportError, ModuleNotFoundError and
AttributeError classes. Builtin identities are stable during a run; name shadowing applies.

The fixture output profile provides print, str and the existing len. Print uses
spaces/newline without keyword options. Print/str format None, bool, int, str and
exception messages. Exceptions accept zero or one argument with that formatting.
Other formatting and multiple exception arguments fail with UNSUPPORTED; broad
formatting retains its own protocol/value gates. The source engine additionally
adopts [bounded repr/str](interpreter-formatting.md), including primitive repr and
explicit class callbacks. Non-callable errors preserve
TypeError with a stage-specific message. Binding-error messages in the corpus
match CPython, including nested qualified names.

Starred expansion, mutable/computed defaults, annotations, global/nonlocal
statements, decorators, arbitrary attributes/reflection, explicit exception
causes, exception groups, classes/descriptors, generators and async remain
unsupported. Handlers initially name the adopted builtins; dynamic expressions
and arbitrary aliases require later lowering. Bytecode identifiers are bounded
ASCII names in version 3. Version 4 accepts pinned Unicode identifiers and
compiler-private local storage, with [module](interpreter-modules.md) and
[source](interpreter-source.md) profiles.

## Verified format

A version 3 program has format, version, immutable tagged constants and functions.
Entry 0 is a module without parameters/free cells. Each function has name,
qualname, params, locals, free, body and blocks. Parameters contain posonly,
positional, kwonly, constant-index defaults and named kwdefaults. Captures must
resolve to a declared local/free cell in the defining function. Defaults refer
to immutable constants. Blocks record statement/expression kind, instruction
arrays and optional filename/spans. Existing value operations retain their
operand behavior.

| Instruction | Operands/behavior |
| --- | --- |
| load / store / delete | Name; stores/deletes require a declared local. |
| function | Function index; captures cells and the module environment. |
| call | Positional count and ordered unique keyword names; callable then argument values. |
| if | Then/else statement blocks; consumes a condition. |
| while | Test expression, body and else statement blocks. |
| for | Local target, iterable expression, body and else blocks. |
| try | Body, ordered handlers, optional else and optional finally. |
| end | Zero values for statements, one for expressions. |
| return / raise | Exactly one value in the completing block. |
| reraise / break / continue | Zero values; loop transfers require a containing loop. |

Handlers are [builtinNames, aliasOrNull, blockIndex, sourceSpan]; empty names
mean a final bare handler. Structured state prevents jumps into another block
or handler. Verification snapshots nested records, checks all opcodes including
unreachable ones, operands, spans, captures and reachable stack joins. It rejects
fallthrough, cyclic/excessively nested/orphan blocks and invalid loop transfers.
Expression blocks cannot contain statement control operations.

Bounds: 128 functions, 512 blocks and 4096 instructions per program, 128 names
per function/name array, block depth 32, stack height 256 and the existing 256
constants/value limits. Memoization bounds shared block-graph traversal.

## Ownership and resource policy

Functions own code pools, module environments and captured cells. Cells own
bound values; exceptions own arguments and context. Frames root locals,
operands, iterators, pending completions and active errors. These graphs may
cycle and use INT-05's iterative accounting. Conservative serialized metadata
cost is charged once per code pool, alongside decoded constants, object and
active-scope costs.

InterpreterSession.run accepts version 3 and retains results through owned
handles. Closures remain alive after call frames return. By-value function
serialization is unavailable. Releasing the final handle reclaims unreachable
cyclic graphs; stale/foreign-arena access remains explicit.

Default call depth is 48, bounded by arena scopes; excessive Python recursion
raises catchable RecursionError. Instruction/work limits, logical allocation
failure, cancellation and unsupported operations are hard execution failures;
Python except/finally cannot intercept or prolong them. Host failures release
all VM scopes. Output is charged and bounded to 65,536 UTF-16 units per run;
tracebacks are bounded to 256 frames. Costs describe logical accounting, not
process RSS or host GC timing.

## Verification

Run with Python 3.14, Node 24.19 and the declared browser-tests group:

```sh
node --test runtime/functions.test.mjs
python runtime/check_functions.py --report build/functions-node-report.json
python runtime/check_functions.py --target browser --report build/functions-browser-report.json
python runtime/check_conformance.py --engine vm3 --report build/vm3-node-report.json
python runtime/check_conformance.py --engine vm3 --target browser --report build/vm3-browser-report.json
```

The tagged function corpus includes the three original adopted cases. CPython
executes each source as an oracle; the engine executes bytecode. Comparisons
cover stdout, errors/adopted messages, context and traceback frame/line order.
Resource cases require deterministic failures and clean frame teardown. Reports
identify both corpus inputs, fixture-compiler digest, host/reference versions
and source_execution=false.

Node 24.19.0/Chromium 156.0.8078.4 checks against CPython 3.14.7 passed 64
function/resource cases on both targets. Version 3 also passed 187 broader cases,
with four malformed-source entries explicitly unsupported in fixture mode.
The source engine now checks those as actual source syntax errors. Node tests
cover retained cyclic closures, owned handles, foreign/stale roots, cancellation
and malformed bytecode. CI retains both target reports.
