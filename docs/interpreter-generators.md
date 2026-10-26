# Generators and comprehensions

INT-GEN-01 uses the pinned CPython 3.14.7 executable reference. The authored
`generators.json` corpus separates reference-only evidence from independently
compiled source. G1 is implemented; G2 remains the next stage. Both require Node and Chromium, both profiles and both
draining and instruction-boundary execution before acceptance.

| Stage | Finite contract |
| --- | --- |
| G1 | Generator functions, bare/value yield, yield from, iter/next, send(value), throw(exception or exception type), close(). Argument binding happens on construction; body effects start on resume. Return values travel in StopIteration.value and close() returns a caught GeneratorExit handler's return value. |
| G2 | List, dictionary, set and generator comprehensions, nested synchronous for/if clauses and unpacking targets. Iteration bindings have a separate lexical scope; the leftmost iterable and iterator acquisition run immediately in the enclosing scope. Dictionary keys precede their values. |
| Future | Async generators/comprehensions, generator frame/code/traceback reflection, deprecated multi-argument throw, assignment expressions inside comprehensions, and interpreter shutdown finalizers require separate contracts. |

Yield preserves the exact block cursor, operand stacks, loop/exception/finally
controls, local cells, closures and active exception. Suspended frames are owned
arena graphs rather than permanently active roots. Resumption uses ordinary
frames on the existing execution controller; it never recursively drains a new
execution or resets instruction, work, allocation or recursion budgets. Running
generators reject reentry with ValueError. An escaping StopIteration becomes
RuntimeError. A yielded value during close raises RuntimeError; the suspended
generator can subsequently be resumed or closed again.

Yield-from relays yielded values, non-None sends, thrown exceptions and close to
adopted delegates; only advancement/delegation exhaustion consumes StopIteration.
User delegates use their ordinary attribute/iteration callbacks. Other callback
failures retain Python frames and source locations. Explicit close unwinds
finally; hard quota/cancellation/session teardown releases ownership without
executing arbitrary Python finalizers, as with existing hard interruption.
Garbage collection does not promise CPython reference-count finalization timing.

Generator aliases and cycles survive collection at any instruction boundary.
Repeated close and session teardown must release logical objects, bytes, frames,
roots and external leases. These logical observations make no host RSS claim.

No new host capability, runtime dependency, publication or deployment is included.
See the [yield expression and generator method reference](https://docs.python.org/3.14/reference/expressions.html#yield-expressions).
