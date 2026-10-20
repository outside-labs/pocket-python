# JavaScript-first interpreter architecture

INT-02 records the selected first implementation: an ES module JavaScript VM
under runtime/ in pocket-python, with Node as its CLI/test host and the same
engine inside a browser worker. The owner selected this route on 2026-10-20 and
retained C/Rust-to-WebAssembly as an explicit later backend.

## Decision and ownership

JavaScript supplies BigInt, Unicode-capable strings and host garbage collection,
and loads directly in browser workers. We implement Python behavior deliberately
on top: Python truthiness, integer/float rules, strings, values, scopes, exceptions,
modules and source parsing do not arise automatically from using JavaScript.
The compiler's ECMAScript compatibility values are a separate API.

Keep engine development and build/test inputs under runtime/ initially. The
Python packaging CLI gains no runtime dependency and its current wheel/sdist
allowlists exclude these engine files. There is no new npm package, repository
or service. Extract a separate engine distribution only for a concrete consumer
with its own identity/license/release decision.

Node 24.19.0 is the initial pinned development/test host. Browser execution uses
native ES modules and workers. Node's availability does not imply an installed
standalone native application; that distribution is separate packaging work.

## Measured vertical prototype

runtime/prototype.mjs executes our own experimental version-0 instruction list:
canonical integer constants, addition/subtraction, jump and return. It validates
all instructions, snapshots them, checks stack use and enforces deterministic
instruction/stack/integer-text limits. It uses no eval, Python implementation,
source transpiler or server execution.

The Node tests and real-browser worker smoke check demonstrate precision for
9007199254740993 + 1, malformed instruction/version rejection, backward-jump
budget termination, underflow/return errors and bounded integer/stack growth.
The browser receives only local ES modules and tagged integer/error responses.
The worker adapter terminates after each smoke case; a main-thread timeout
provides a separate final stop path.

The measured prototype source is 3,090 uncompressed bytes plus 422 bytes for the
worker adapter on 2026-10-20. These counts exclude a Python parser, language/value
implementation, libraries, browser UI and packaging. They are not a prediction
of interpreter size, startup time or memory. C/Rust/WASM performance has not been
measured by this spike; INT-WASM-01 follows a useful measured JavaScript baseline.

Reproduce:

```sh
node --test runtime/prototype.test.mjs
uv sync --locked --group browser-tests
uv run python runtime/browser_smoke.py
```

Use --channel chrome with the browser script for installed Chrome. CI pins Node
and runs the prototype tests; the existing pinned browser-test environment runs
the real worker alongside the current MicroPython PWA regression.

## Engine boundaries for subsequent work

1. Own tokenizer/parser and binding/compiler passes produce our versioned IR/
   bytecode with source spans. CPython ast may produce early test fixtures only.
2. INT-03 replaces the experimental format with a specified versioned verifier
   and execution loop. Reject unknown versions, malformed control flow and
   unsupported operations; retain negative and budget evidence.
3. Python ints use BigInt with explicit operation limits. Python floats and
   JavaScript Number values remain distinguishable. Strings need code-point
   indexing/iteration helpers; tuples, lists and dicts need Python semantics.
4. JavaScript GC manages host allocations, while our VM tracks supported object
   ownership, closure/host handles and conservative accounted-allocation/work
   budgets. These are not a hard operating-system RSS limit. Expensive native
   primitives require prechecks; worker termination is the final browser stop.
5. Functions, exceptions and module/library records own Python scope, lifetime,
   initialization and error behavior. Host calls cross an explicit async
   capability protocol; DOM/events stay on the main thread.

The prototype does not parse or execute Python source yet, implement Python
objects/functions/modules, claim GC/host-handle completeness or provide a
security sandbox. It is architecture evidence, not the interpreter alpha.

## Later C/Rust WebAssembly backend

INT-WASM-01 selects C or Rust and a pinned reproducible toolchain after the
JavaScript baseline is measurable. INT-WASM-02 implements its native/Wasm engine;
INT-WASM-03 integrates it and compares common native/browser behavior, asset
closure, startup, memory, cancellation and offline new-source execution.

Preserve the language corpus and host protocol across backends. Define compatible
bytecode/ABI versions or an explicit translation; do not assume memory layout or
host GC is portable. A C/Rust backend needs its own Python integer, Unicode,
allocation/GC, exception and host-handle implementation and conformance evidence.
Engine manifests name the backend/version explicitly. Never silently switch
backends to work around an unsupported operation.
