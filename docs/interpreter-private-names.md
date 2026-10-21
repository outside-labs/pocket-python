# Private names in the class-source profile

INT-09 adopts private-name mangling as a separate C2 step before descriptors and
decorators. This is a compiler transformation within explicit classes-source/1,
using existing bytecode 5 identifiers. The default core-source/1 remains unchanged.
The compiler now implements this contract; broader C2/INT-09 remain open.

## Adopted transformation

After identifier normalization, a name beginning with at least two underscores
and ending with fewer than two uses the nearest textual class name. Remove that
class name's leading underscores, then prefix the identifier with an underscore
and the remaining class name. An all-underscore class name leaves names unchanged.
Nested functions retain the enclosing class context; a nested class starts its
own context for its body. Its bases and its binding use the outer context.

Transform variable/attribute reads and bindings, parameters, loop and exception
targets, deletion and import bindings before lexical resolution. Preserve function
and class __name__/__qualname__, literal strings and call keyword names. A private
module/member import uses the transformed import operand; a dotted module name
keeps its spelling while its bound name may change. Import aliases get their own
transformed binding. Names outside a class keep their spelling.

See [Python's private-name rules](https://docs.python.org/3.14/reference/expressions.html#private-name-mangling).

## Bounds and compatibility

Generated identifiers must meet the existing 64-code-point/128-code-unit VM
identifier limit; excess length gives COMPILE_BUDGET before execution. There is
no truncation. Transformation work shares the existing compilation budget and
cancellation checks. Parameter collisions introduced by mangling give SyntaxError
before effects. Original source spans and qualified names remain available for
diagnostics; generated storage names are ordinary verified identifiers.

Mangling avoids accidental inheritance collisions; it does not provide access
control. Explicit mangled names remain ordinary attributes. Existing successful
C1 programs retain their behavior. Updated engine fingerprints select the new
compiler, while an installed application's previous complete graph remains intact
until its waiting update activates. No new opcode, library, host grant or runtime
dependency is required. Descriptors, decorators, implicit class cells and custom
special methods retain their individual gates.

## Evidence and delivery

The 33 original cases in `tests/fixtures/interpreter/private-names.json` record
explicit stdout/error types and synthetic module/grant records where needed.
The CPython oracle materializes those modules in a temporary directory and uses
real isolated imports. It does not supply missing code to the independent engine.
Run the reference contract with:

```sh
python runtime/check_classes.py --reference-only \
  --corpus tests/fixtures/interpreter/private-names.json
```

The compiler lowers normalized private names before binding, preserving source
spans and original function/class metadata. All 33 cases run against CPython in
Node/Chromium, with report/input hashes and logical arena teardown checks. Node
tests additionally cover post-mangling parameter collisions, identifier growth,+cancellation and denial of imports without the transformed module grant. The
default source profile and later-feature refusal boundary retain their tests.

Run the source matrix with the same command and `--target node` or `--target
browser` in place of `--reference-only`. Offline-console private-name acceptance
follows as a separate integration step. Broader C2/C3 and alpha publication
remain separate tasks.
