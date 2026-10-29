# Expanded function binding

INT-FUNC-01 adopts ordinary function binding in seven focused steps, tracked by
[#199–205](https://github.com/outside-labs/pocket-python/issues/199) under
[#118](https://github.com/outside-labs/pocket-python/issues/118). The reference is
CPython 3.14.7; the initial 94-program matrix records expected stdout and error
types. A reference-only result certifies the matrix, not engine execution.

| Stage | Adopted contract |
| --- | --- |
| Defaults | Evaluate computed/mutable positional and keyword-only defaults once per definition in the defining namespace. Preserve identity across calls, fresh values across repeated definitions, closure reads, decorator/default/application order, failures and cycles. |
| Scope | `global`/`nonlocal` loads, stores and deletion, including augmented assignment, loop/import/definition/handler targets. Validate parameter conflicts, declaration order and missing nonlocal owners. Class namespaces are skipped when finding enclosing function cells; an intervening global declaration stops capture. |
| Variadic | `*args` and `**kwargs` with ordinary, positional-only and keyword-only parameters. Pack extra positionals in an immutable tuple and extra keywords in a fresh insertion-ordered dictionary. Positional-only names may occur independently in `**kwargs`. |
| StarArgs | Multiple `*iterable` arguments and ordinary arguments, consuming each iterable once before later positional expressions. Evaluate all positional parts before keywords, including syntactically earlier keywords. Use ordinary owned iteration and preserve errors from acquisition/advancement. |
| StarKw | Multiple `**mapping` and explicit keywords. Dictionaries retain insertion order; custom mappings call ordinary `keys()` then indexed reads. Reject duplicates before reading the repeated value or evaluating later keyword expressions. Validate keyword strings at final invocation, after mapping reads. |
| Future | Annotations and generators retain their own source admission gates. |

Both source profiles receive ordinary function behavior. Class/descriptor examples
require explicit `classes-source/1`; core mode gains no class syntax or host grant.
Default values may use any expression already admitted by the selected profile.
Parameter/argument counts, container sizes and source budgets stay bounded.
Construction hints and arbitrary builtin subclasses retain their separate value
contracts. Unsupported forms must refuse before misleading partial execution.

## Bytecode and ownership

Preserve bytecode 3 literal-default fixtures. Source bytecode 4/5 may add verified
instructions and optional metadata for runtime defaults, scope writes, variadic
parameters and call assembly. Old programs retain their format and accounting.
The engine fingerprint identifies the actual implementation; a bytecode version
alone does not promise all current source features.

Functions own runtime defaults alongside their defining environment and closure
cells. Calls root argument packs before allocating locals or invoking callbacks.
An in-progress expansion owns the callable, accumulated arguments/keywords,
iterator/mapping/key and enclosing continuation. New values transfer to a rooted
owner before the previous owner is released. Callback errors unwind through the
ordinary machine and retain original source locations.

Work, instruction, depth, cancellation, output and logical allocation failures
retain the execution contract. Test pauses and collection at every instruction,
and cancel/close while callbacks are pending. Verify exception cleanup and cyclic
default graphs. The eight composed execution observations remain unchanged.

## Validation

Integrated acceptance runs all 111 class observations and 77 core observations
in Node/Chromium with both draining and instruction stepping. The console has
288 comparisons/checks and 70 Stop/Restart cycles, including new function source
after offline reload and a waiting class-to-core update. The
[payload record](measurements/2026-10-26-functions.json) retains the preceding
699-byte application fixture: complete core payload is 483,229 bytes, an increase
of 22,779 bytes. No startup or speed improvement is claimed.

The Defaults stage is implemented: sixteen semantic cases and two future refusals
pass in Node and Chromium, including instruction stepping. Functions own runtime
default vectors; modern bytecode verifies their exact positional/keyword layout.
Legacy literal-default programs retain their previous representation and costs.

The Scope stage implements explicit module writes and shared nonlocal cells.
Forty-seven selected cases (including the Defaults cases and two future refusals)
pass in the class profile; ordinary cases also run in the core profile. Optional
verified scope metadata survives registry normalization. Scope declaration errors
are compilation errors, including declarations inside unreachable suites.

The Variadic stage adopts extra positional/keyword packs. Sixty-five selected
class observations and the profiled core subset pass; focused units exercise
fresh dictionaries, aliasing/capture, malformed signatures, collection and OOM.

The StarArgs stage uses an owned argument record and resumable acquisition/
advancement. The expanded matrix has 95 reference cases; 78 selected observations
include three future refusals. Call assembly bounds each positional/keyword group
to 128 values. Starred forms with user length hooks conservatively refuse before
binding/iteration pending the separate construction-hint contract: CPython's
single-star and assembled positional paths need not query the same hint owner.

The StarKw stage adopts dictionaries and instance mappings. The 111-program
matrix includes full key materialization before indexed reads, cached dictionary
hashes, separate custom-key probe/insertion hashes, descriptor binding, duplicate
error formatting callbacks, late string validation and arbitrary string keyword
names. Mapping AttributeError/KeyError conversion follows the pinned reference;
errors raised while formatting a duplicate key propagate normally. Source-dict
structural mutation during merge retains its explicit restart refusal. Message
text and default object display identities are outside the comparison contract.

A composed scope correction adds three cases, bringing the current matrix to
114 observations. A class may use a declared global in its own namespace while
its methods capture an enclosing function's same-named cell. Verified class
metadata preserves both roles; ordinary function conflicts remain invalid.
Class reads/defaults/writes use the module binding and method reads use the cell.

The authored corpus is `tests/fixtures/interpreter/function-binding.json`.
Implemented stages advance with each execution PR. Unimplemented stages are
selected only for reference checks until their source behavior is adopted.

```sh
python runtime/check_classes.py --reference-only --corpus tests/fixtures/interpreter/function-binding.json
python runtime/check_classes.py --corpus tests/fixtures/interpreter/function-binding.json --stages Defaults
python runtime/check_classes.py --target browser --stepped --corpus tests/fixtures/interpreter/function-binding.json --stages Defaults
```

The final step runs both targets with drain/instruction stepping, both source
profiles, pending ownership/resource units and newly entered offline-console
source with Stop/Restart. Reports retain reference version, source hashes,
execution driver and logical teardown. Publication, deployment, native ABI,
library coverage and complete Python compatibility remain separate milestones.

The separate [documentation contract](interpreter-documentation.md) adopts
function/class source docstrings, owned function documentation and live bound
method reads. It leaves arbitrary function dictionaries and signatures outside
this binding slice.

The later [O45/O46 function dictionary contract](interpreter-function-dictionaries.md)
adopts live custom function attributes and bound-method fallback. Broader native
metadata, instance/module/class live mappings and async remain separate work.
