# Inlined comprehension namespace reflection

O21 and O22 continue #123 against pinned CPython 3.14.7. The reference cases in
`tests/fixtures/interpreter/reflection.json` specify these stages before their
independent implementation. They extend classes-source/1 and bytecode 5 only;
core-source/1 and bytecode 4 retain their existing admission rules.

| Stage | Contract |
| --- | --- |
| O21 | In optimized functions, lambdas, generators and generator expressions, list/dict/set comprehensions expose the enclosing optimized namespace through locals(), zero-argument vars() and zero-argument dir(). Include initialized targets and bound enclosing parameters, locals and free cells. Nested comprehensions overlay targets. Restore shadowed names after completion and exceptions; targets remain absent outside unless independently bound. |
| O22 | Module/class list/dict/set comprehensions expose an isolated optimized namespace: initialized targets and referenced free cells, excluding the module/class namespace, implicit iterator and compiler storage. Nested comprehensions share this isolated namespace while active. Private-name mangling and lexical closure rules still apply. |

Every locals/vars call returns a fresh shallow dictionary in Python
parameter/local/cell/free order. Snapshot mutation cannot rebind cells; contained
objects and escaped closures retain identity. `dir()` sorts the same names
by Unicode code point. Aliases inspect their immediate Python caller; ordinary
helper functions called by a comprehension inspect their own frames.
Initial iterable expressions run in the enclosing scope before target binding.
Generator expressions remain separate generator scopes, including their adopted
`.0` iterator. An inlined comprehension within a generator expression includes
that generator's namespace.

Namespace ordering follows Python operand and control-flow order. Inlined
iteration targets keep local positions even when captured by nested functions.
Enclosing locals captured only by an inlined comprehension remain in local
order; real nested functions move ordinary captured locals to cell order.
Empty, filtered and failed comprehensions do not leak targets.
The outermost active comprehension hides enclosing local bindings of all targets
in its nested inlined comprehensions. A nested target absent from the current
comprehension frame therefore stays absent before and after its nested loop,
until its containing comprehension restores the enclosing binding. Captured
free cells and hidden local target slots retain distinct restoration rules,
including through intermediate nested comprehensions, as the pinned cases record.

The engine may retain its existing owned comprehension frames. Bounded verified
namespace metadata and active frame overlays must preserve established cell
allocation/root order and the eight composed resource observations. Snapshots
own their values independently of execution frames. Collection between
instructions, suspension, cancellation, close, callback errors and real
instruction/work/allocation limits must release all owners with zero logical
teardown. Source frames and implicit lookup rules remain intact.

Live module/class/global mappings, ordinary instance dictionaries and mapping
proxies, default directories, unboxed integer identity, assignment expressions
or yield inside comprehension bodies, builtin layouts and dynamic source
admission retain separate contracts. Native coroutine/await and host adapters
remain under #34. No dependency, host grant, release, publication or deployment
is included.

Acceptance requires the pinned reflection matrix in Node and Chromium, draining
and instruction-boundary execution; ownership and malformed metadata checks;
composed installed-wheel offline execution and Stop/Restart; compatibility
updates; exact example assets and a reproducible rebuild.

Semantic anchors: Python 3.14 [locals](https://docs.python.org/3.14/library/functions.html#locals),
[PEP 709](https://peps.python.org/pep-0709/) and
[PEP 667](https://peps.python.org/pep-0667/).
