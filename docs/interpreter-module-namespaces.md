# Live module and global namespaces

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O67 of #123 adopts live namespaces in `classes-source/1`. Pinned CPython
3.14.7 is the oracle for the independently authored
[module namespace corpus](../tests/fixtures/interpreter/module-namespaces.json).

| Entry point | Result and effects |
| --- | --- |
| `globals()` | The defining module's actual dictionary; no arguments or keywords. |
| Module `locals()` / `vars()` | The same dictionary, including aliases retained before later statements. |
| `module.__dict__` / `vars(module)` | That module's dictionary, with read-only dictionary attribute identity. |
| Global load / store / delete | Reads and mutates the dictionary, including explicit `global`, imports, loops, exception aliases, existing functions and suspended generators. Missing names retain builtin fallback / NameError. |
| Module attribute operations | Share dictionary storage; native `__dict__` / `__class__` precedence, missing-attribute errors and builtin getattr/hasattr defaults are preserved. |
| Module `__getattr__(name)` | Called only after a missing ordinary attribute, without descriptor binding. AttributeError alone is suppressed by optional lookup; from-import uses the granted registry's package-child fallback. |
| Module `__dir__()` / `dir(module)` | A stored hook runs as an owned call. The native default copies the live keys. Ordinary dir copies/sorts the result using the existing owned iterable and comparison phases. |

Non-string keys and stored key/value identities survive unchanged. Hash, equality
and truth callbacks use ordinary frames, shared budgets and original source
errors. Structural mutation restarts namespace lookups after their current
candidate is invalidated. Iterators retain insertion positions: value updates
are visible, size changes raise RuntimeError, and deletion/reinsertion follows
the pinned remaining-key checks rather than exposing a copied key list.

The compact cell representation remains until the dictionary is first exposed.
Conversion publishes atomically and drops stale public cells. Internal compiler
slots stay private. Retained dictionaries, functions and modules own the same
values through parked execution, collection, cancellation and initialization
failure. A failed import leaves an escaped failed dictionary intact; retry uses
a new namespace. Persistent callbacks retain their original defining dictionary.

Optimized function and comprehension locals retain their snapshot contract.
The first iterable of a module comprehension executes in the live module scope.
Class bodies are O68. Function default/builtin metadata is O72; dynamic
execution/import callable admission is O91–O94. General dictionary library APIs
are #116; this stage adopts the namespace operations above. Registry package
resolution remains explicit and does not execute CPython's ambient importlib
loader or gain filesystem/network authority. Core source admission is unchanged.

## Namespace storage accounting, revision 1

Unexposed environments and ordinary dictionaries retain their existing layouts.
An exposed environment owns its dictionary through an eight-byte edge (72 base
bytes), plus the existing charged internal-cell entries. Namespace dictionaries
charge 112 base bytes and 56 bytes plus hash text per entry; the additional
storage records insertion serials. Their iterators charge 80 bytes for the
remaining-key and insertion-position state. Existing value/key edges and all
callback continuations are traced. Materialization and growth failures publish
no partial namespace. This is logical accounting, not a physical heap estimate.

The source matrix runs in Node and Chromium with drain, instruction-boundary
and parked drivers. Focused lifecycle tests collect at every instruction and
cover cancellation, close, import retry and separate persistent activations.
Offline source-console acceptance includes live writes, deletion and recovery.
No dependency or capability change accompanies this stage.

References: pinned [module attribute and directory operations](https://github.com/python/cpython/blob/v3.14.7/Objects/moduleobject.c),
[pinned dictionary operations](https://github.com/python/cpython/blob/v3.14.7/Objects/dictobject.c),
and [PEP 667 namespace rules](https://peps.python.org/pep-0667/).
