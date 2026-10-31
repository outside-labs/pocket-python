# Live class-body namespaces

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O68 of #123 uses the same owned namespace interface as O67 for ordinary class
body dictionaries. `locals()` and zero-argument `vars()` return the actual body
mapping; `dir()` copies and sorts its current keys. Repeated calls and escaped
aliases share identity. Dictionary writes/deletes affect subsequent body
execution and the namespace copied into the class.

| Operation | Scope and ordering |
| --- | --- |
| Body reads | The class dictionary precedes enclosing free cells and module/builtin lookup. This includes declared nonlocals; stores/deletes still follow their nonlocal declaration. Explicit globals bypass the class dictionary. |
| Body stores/deletes | Ordinary names mutate the actual mapping. Global and nonlocal targets mutate their declared owner. Missing class deletions raise NameError. |
| Private names | Source identifiers are mangled before namespace access. Dictionary keys remain literal; raw private names are not silently rewritten. |
| Metadata | Initial module/qualification/first-line entries precede statements. Module values preserve exact defining-namespace aliases. Body changes affect final type metadata, with native qualification validation. |
| End of body | The compiler's static-attribute tuple is installed before annotation/class cell artifacts. The original mapping retains lexical `__classcell__`; native type construction consumes it and binds the resulting class. |
| Final type | Native construction copies the namespace. Subsequent changes to the original dictionary and class attributes are independent. Stored descriptors bind only through class/instance access and receive ordinary name notifications. |
| Inlined comprehensions | Their first iterable uses the live containing namespace. Their body retains the isolated optimized snapshot/lookup contract. Walrus targets use the containing non-comprehension function/module owner, including lambda defaults and delayed generator evaluation. Class-body walrus binding, iterator rebinding and walrus expressions in iterable clauses raise SyntaxError before effects. |

Class bodies use owned dictionaries from entry so native type copies preserve
physical entry positions through deletion and compaction. Primitive string keys
use direct internal fast paths until callback-bearing keys require owned phases.
Construction and dictionary publication remain transactional. Internal compiler
cells remain private and traced. Namespace, callback, closure and lexical-class
owners survive instruction-boundary stepping, parking, collection, cancellation
and close. Class construction failures preserve escaped original dictionaries.

The interface is deliberately shared with modules so O80 can supply prepared
mappings. Prepared mappings and callable metaclass factories remain O80–O81;
complete native namespace descriptors and class mapping proxies are O69–O70.
The annotation dictionary-cell payload/evaluation protocol remains #125 and
code/cell reflection remains O73. Class syntax still requires classes-source/1;
comprehension assignment binding also works in the existing core source grammar.
No host authority or dependency is added.

## Accounting and verified metadata

`namespace-storage/1` charges exposed class environments and dictionaries as in
[O67](interpreter-module-namespaces.md). Bytecode 5 permits bounded optional
class `staticAttributes` and decorated `firstLine` data. The independent verifier
checks their kind, names and bounds; the registry preserves them without host
execution. Static names retain their source spelling, including private names.

`execution-accounting/4` records exact module-value aliasing during class entry
and charged static-name storage, with all eight composed source observations in
`execution-resources.json`. Previous accounting/3 observations are retained there.
Frame, recursion, instruction, work and arena limits remain shared. These are
logical storage measurements rather than physical heap or performance estimates.

The [64-case source matrix](../tests/fixtures/interpreter/class-body-namespaces.json)
is checked against pinned CPython 3.14.7 in Node/Chromium drain,
instruction-boundary and parked drivers. Focused tests cover callbacks, failed
construction, lexical cells, suspended generators, real limits and zero teardown.
The installed source console includes the same successful source programs and
walrus/default-binding recovery.

References: [pinned class compilation](https://github.com/python/cpython/blob/v3.14.7/Python/codegen.c),
[pinned class construction](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c),
and [PEP 667](https://peps.python.org/pep-0667/).
