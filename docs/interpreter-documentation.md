# Function and property documentation

O41/O42 continue #123 and #33 with a finite CPython 3.14.7 contract.
`tests/fixtures/interpreter/documentation.json` records the pinned executable
reference. Reference observations alone do not establish independent execution.

| Stage | Adopted behavior |
| --- | --- |
| O41 | Python function documentation, leading source docstrings, arbitrary owned assignment and deletion to None; live bound-method reads with read-only method metadata. Ordinary class docstrings, default None, instance shadowing and metaclass reads supply getter metadata. |
| O42 | Four-argument property construction, eager optional getter documentation, arbitrary owned documentation, mutation/deletion and accessor copies preserving CPython's documentation origin and notification name timing. |

Only an omitted or None constructor document reads the getter's `__doc__`.
Optional lookup suppresses AttributeError from lookup, including descriptor and
fallback phases; other exceptions propagate. Documents retain their exact
identities and are never truth-tested. Explicit non-None documents bypass
getter metadata, including false, zero and empty strings/containers.

Accessor copies snapshot the selected accessors and documentation policy before
getter lookup. A document originally obtained from a getter is refreshed from
the selected getter even after manual document mutation. An explicit non-None
document is retained. None or deleted documentation permits getter lookup again.
None accessor replacements preserve their original accessors. The property's
notification name is copied after successful construction, observing changes
made by metadata callbacks. Bound, unbound and rebound native copies share this
policy and validation order.

Function docstrings use an optional string-constant index in verified bytecode
5 function metadata. Existing bytecode without it keeps its layout and behavior;
bytecode 3/4 reject the field. Class docstrings enter the ordinary namespace in
source order. Default class documentation is None and does not inherit a base
class's document; class documentation deletion raises TypeError. This does not
adopt live class dictionaries or additional function metadata.

Documentation adds an owned edge only for a non-None qualified value. Failed
growth or foreign-owner mutation restores the prior value. Pending getter
lookup owns its selected operands and original property across stepping,
parking, collection, cancellation, failure and close. Preserve the eight
existing composed resource observations for programs without documents.

Native builtin/type/value documentation and static/class method wrapper
documentation remain opaque during existing property construction and copy
paths; reading such an unqualified document refuses explicitly. Explicit
property documents bypass this boundary. Property subclass layouts, arbitrary
function dictionaries, module documentation and broader metadata retain their
separate contracts. Reflection belongs to classes-source/1 and bytecode 5;
core admission, host grants and async work under #34 remain separate.

Reference: [CPython 3.14.7 property implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c).
