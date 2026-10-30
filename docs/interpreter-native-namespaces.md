# Materialized native namespaces

O69 of #123 gives source classes and all adopted actual types complete own
dictionaries. The pinned CPython 3.14.7 inventory contains 81 layouts and 1,148
entries, including the dictionary views introduced by O70. The generated table
records ordered names, literal values and descriptor kinds. Verify it with
`python scripts/generate_native_namespaces.py`; refresh it only after reviewing
the oracle changes. Native documentation carries the PSF license in
`runtime/licenses/CPYTHON.txt`.

Native types materialize complete dictionaries lazily; source construction owns
its actual body and independently copied class dictionary. Repeated namespace views
share its exact keys, stored descriptors and values. Materialization publishes
the complete dictionary atomically. Native method, wrapper, classmethod,
getset and member descriptors retain their defining owner and validate actual
receivers when bound. Binding preserves native method versus Python method
identity and does not invoke descriptors merely because their entries are read.

Source classes preserve original namespace key objects and their recorded
hashes, including non-string keys. Exposed class-body dictionaries and dynamic
namespaces are copied independently. Reserved qualification and lexical cells
are consumed by construction; the original body keeps its artifacts. Native
instance dictionary and weak-reference descriptors, first-line metadata and
the compiler's static-attribute tuple are real stored entries. Inherited storage
does not introduce duplicate descriptors in a child. First-line and static-attribute entries
can be replaced or deleted through ordinary class mutation.

Non-string keys that compare equal to attribute names use owned hash/equality
operations. Attribute reads and writes retain the stored key, execute callbacks
in VM frames and restart after structural mutation. Descriptor notifications
receive the exact original key. Metaclass data descriptors take priority;
nondata shadows and qualified `type.__dict__['__dict__'].__get__` retain their
native behavior. Qualified native metadata getters bypass metaclass shadows.

Listing a native entry does not adopt its library API. Every unsupported native
invocation reports its owner; descriptor reads never substitute a placeholder.

| Boundary | Owner |
| --- | --- |
| Native callable/descriptor documents and copied wrapper metadata | O71 |
| Function globals, builtins and defaults | O72 |
| Code, closures and cell contents | O73 |
| Generator/frame fields | O74 |
| Prepared mappings, factories, base expansion and custom MRO | O79–O82 |
| Remaining metaclass special protocols | O83 |
| Slot storage and new builtin/subclass layouts | O84–O87 |
| Type identity, hierarchy and compatible metadata mutation | O88 |
| Remaining explicit native protocols and descriptor equality/hash | O90 |
| Sequence/dictionary methods and general reverse protocols | #116 |
| Set and buffer APIs | #117 |
| Remaining generator APIs | #120 |
| Exception metadata and APIs | #124 |
| Annotation/type-parameter evaluation | #125 |
| Reduction, state and size protocols | #126 |
| Display and formatting families | #127 |
| Further numeric methods | #184 |
| Type C-ABI/layout fields | Explicit native boundary; no source ABI representation |

The dictionary, keys, descriptor owners, suspended lookup phases and copied
body mappings have explicit memory edges. Materialization and mutation obey
the arena's real work/allocation limits; failures preserve existing values.
The source corpus, complete table checks and lifetime cases cover collection,
instruction stepping, parking, callback errors, cancellation and close. No new
host authority or dependency is required. Complete proxy operations are O70;
directories retain the separate O76–O78 scope.
