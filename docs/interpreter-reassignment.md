# Compatible type and hierarchy reassignment

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O88 of #123 completes the storage workstream. The
[85-case matrix](../tests/fixtures/interpreter/reassignment.json) uses the pinned
CPython 3.14.7 oracle in Node and Chromium drain, stepped and parked execution.

| Surface | Contract |
| --- | --- |
| Instance class | Source heap types can replace compatible source heap types. Native payload family, member positions, dictionary/weak-reference capacity, native allocation/collection requirements and inherited layout must agree. The object, payload, dictionary, member values, views and detached handles retain their identities. Incompatible layouts, immutable native types and invalid assignments raise TypeError. |
| Module class | Owned registry modules and source module subtypes permit compatible module class changes, including returning to the native module type. The registry object and namespace remain the same; subsequent hooks and native descriptor bypasses use the new type. |
| Class bases | A nonempty tuple of actual types replaces a source class's bases only when its primary allocation layout is compatible. Duplicate bases, cycles, native allocation conflicts and invalid C3 orders fail without publishing a replacement hierarchy. Member layouts use their original declarations, including private names. |
| Descendant MROs | Native C3 and owned metaclass mro callbacks recompute the class and its live descendants. Proposed bases and the previous MRO are visible during callbacks. Iterable results, descendant failure, reentrant changes and committed callback effects follow the pinned oracle. A failed hierarchy operation restores its own hierarchy changes while preserving committed reentrant changes. |
| Subclasses | type.__subclasses__ and inherited native methods return a fresh list of live immediate children in creation order. Source children come from the owned arena after collection, without a strong child registry. Native children are the adopted native type universe; host interpreter classes and unadopted libraries are outside that universe. |
| Metadata | Source type name and qualification require strings and preserve the assigned object's identity, including string subclasses. Name rejects embedded nulls; qualification preserves them. Module accepts arbitrary owned values and removes first-line metadata. Deletion rules and immutable native types retain native errors. Existing function identities and member names remain stable. Source member/getset descriptor qualification performs owned metaclass lookup once and caches the successful result. |

Actual type assignment remains distinct from advertised __class__ attributes.
Existing from-import lookup honors the replacement module type and preserves
ImportError handling. The installed offline console exercises a module class
change, imported lookup, retained namespace alias and restoration to native type.
Source attribute hooks and descriptors retain their normal precedence; explicit
native object/type descriptors bypass those hooks. Aliases, mapping proxies,
existing super objects and detached callables observe the appropriate retained
owner or updated hierarchy.

Hierarchy transactions and all old/new hierarchy edges are charged and traced
under [accounting revision 15](execution-contract.md#hierarchy-accounting-revision-15).
Parked collection, cancellation, explicit close, recursive callbacks, work and
instruction exhaustion, and allocation failure restore retained classes and
release all execution roots. Subclass enumeration does not keep discarded
classes alive. The eight existing composed resource observations are unchanged.

Existing constructor and native-operation boundaries remain with #116/#117 and
O89–O95. Exception subtype storage remains #124. This stage adds no host grants,
source evaluation, import authority or external dependency.

References: [pinned type, layout and hierarchy mutation](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c),
[pinned descriptor qualification](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c),
[pinned module attribute behavior](https://github.com/python/cpython/blob/v3.14.7/Objects/moduleobject.c).
