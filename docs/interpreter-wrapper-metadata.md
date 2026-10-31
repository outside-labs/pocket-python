# Wrapper and descriptor metadata

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O71 of #123 adopts `staticmethod(value)` and `classmethod(value)` metadata in
classes-source/1. Construction reads `__module__`, `__name__`, `__qualname__`,
then `__doc__` through ordinary owned attribute operations. Only AttributeError
is suppressed. Each present value is copied by identity into the wrapper's
live dictionary; later callable mutation does not refresh these copies.

`__dict__` and `vars(wrapper)` share the actual dictionary, including arbitrary
keys and callback-bearing string collisions. Attribute writes and deletes use
that dictionary. Replacement requires a dictionary; deletion raises TypeError.
`__func__`, `__wrapped__` and the computed abstract marker retain native read-only
storage and take priority over dictionary shadows. The existing binding and
staticmethod direct-call rules are unchanged. Automatically installed wrappers
for source `__new__` and `__init_subclass__` retain their native empty dictionaries;
Python's internal type normalization does not copy constructor metadata.

The generated pinned CPython 3.14.7 native table now includes callable and
method/wrapper/getset/member descriptor documents. Reads use qualified owners,
including detached bound native methods. Native documents remain read-only.
Source dictionary and weak-reference descriptor documents use their native
storage descriptions. Property construction and accessor copies can now obtain
native documents through the same owned lookup path as source getters. Getter
origin remains distinct from explicitly supplied documents: replacing a getter
refreshes an inherited document, including after document mutation, while an
explicit document is retained.

Super dictionary lookup binds the inherited dictionary descriptor to its original
receiver. Class-bound super returns the stored descriptor; unbound super and a
super whose remaining MRO has no dictionary raise AttributeError. Its three
receiver fields remain read-only and support qualified native getset access.

Annotation, annotation-provider and type-parameter evaluation remains #125.
Wrapper construction does not evaluate those fields. Wrapper/super directories
remain O77; subclass storage and explicit native reinitialization remain O87.
Unrelated native invocations retain their existing owners.

The executable contract is `tests/fixtures/interpreter/wrapper-metadata.json`.
It runs on Node and Chromium through drain, instruction-boundary and parked
execution. Unit coverage adds foreign-owner rejection and collection,
cancellation and close during optional metadata callbacks. The corpus also runs
through the installed offline console, including error cases.

Semantic references: [function and wrapper implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/funcobject.c),
[property and descriptor implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/descrobject.c).
Native documentation remains under `runtime/licenses/CPYTHON.txt`.
