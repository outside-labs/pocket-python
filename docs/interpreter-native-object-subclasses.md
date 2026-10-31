# Descriptor, wrapper, module and super subclasses

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O87 of #123 adopts property, staticmethod, classmethod, module and super
subclasses. The [54-case matrix](../tests/fixtures/interpreter/native-object-subclasses.json)
uses the pinned CPython 3.14.7 oracle and all six Node/Chromium source drivers.

| Layout | Contract |
| --- | --- |
| Property | Empty native allocation precedes initialization. Native initialization publishes accessor fields before owned documentation lookup, resets the property name, and places subclass documentation through its own attribute protocol. Getter-derived and explicit documentation retain pinned AttributeError handling. Native get/set/delete and set-name bind through the actual subtype; accessor copies construct that subtype and preserve the stored name. |
| Static/class wrappers | Native allocation is initially unbound. Initialization owns the callable and copies metadata incrementally into the actual subclass dictionary. Source binding/call hooks override native behavior; explicit native operations bypass those hooks. Wrapped callable fields remain read-only, while subclass slots and dictionaries remain live. |
| Module | Native allocation creates an owned namespace; initialization writes the standard name/doc/package/loader/spec fields without clearing other entries. Instance state, vars and the native dictionary alias that namespace. Source hooks and module namespace hooks retain their distinct lookup behavior; native directory results enumerate module keys. |
| Super | Uninitialized/unbound/bound states retain native receiver fields. Source state and hooks compose with native target lookup; binding an unbound subtype constructs that subtype. Native initialization/reinitialization and detached handles retain their original owners. |
| Storage | Each native payload uses the existing eight-byte edge. Dictionary/weak-reference capacity and slot restrictions follow the native layout. Other non-subclassable types retain TypeError; exception subclass payloads remain #124. |

Native documentation reads, wrapper updates, source hooks and subtype copy
constructors run on the same owned machine. Earlier callback effects survive
errors. Retained source instances trace native payloads, accessors, callables,
module namespaces and super receivers through parked collection, cancellation
and close. No foreign executable data or host authority is introduced.

The native namespace and directory inventory remains O78's existing matrix;
these source subtypes inherit its native descriptor layouts and add their real
instance state.
Native super target lookup precedes subtype state; native object lookup can
read that state directly. Module missing-name hooks follow a single namespace
probe, and failed writes never invoke native read fallback.
The installed offline console also constructs and reinitializes a slotted
module subtype while retaining its dictionary alias and member values.

Existing object/type-derived layouts are retained. Compatible
class and base reassignment is the final storage stage, O88. Remaining native
entry-point and property diagnostic completion remains O90.

References: [pinned property initialization and subtype copies](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c),
[pinned wrapper/super construction and binding](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c),
[pinned module initialization and attribute behavior](https://github.com/python/cpython/blob/v3.14.7/Objects/moduleobject.c).
