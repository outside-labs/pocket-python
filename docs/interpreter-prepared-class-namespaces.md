# Prepared class namespaces

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O80 of #123 adopts optional metaclass `__prepare__` lookup and custom mapping
class bodies in `classes-source/1`. Preparation runs after base resolution and
metaclass selection, before body initialization. Its name, resolved bases tuple
and keyword values retain their identities through metaclass construction.
Inherited functions, classmethods and descriptor-backed preparation use ordinary
owned attribute lookup. Only lookup AttributeError selects an empty dictionary;
errors from the preparation call propagate. Native `type.__prepare__` returns a
fresh dictionary and accepts its native unrestricted argument shape.

| Phase | Contract |
| --- | --- |
| Validation | A prepared dictionary or object whose actual type supplies `__getitem__` is a mapping. Other results fail before the body. Missing writes fail on the first metadata store. |
| Reads | Read the prepared mapping first, including `__name__` during module metadata initialization. KeyError falls back to lexical cells, globals and builtins. Other errors propagate with their original callback frames. Explicit globals bypass the mapping. |
| Writes/deletes | Every ordinary body binding uses owned item assignment/deletion. Private identifiers are already mangled. Declared global/nonlocal targets retain their owners. A missing deletion becomes NameError. |
| Reflection | `locals()` and zero-argument `vars()` return the exact prepared mapping; `dir()` obtains its keys and sorts a fresh result. Retained aliases survive body and construction failure. |
| Body completion | Store static-attribute and required class/dictionary cells, then original bases. Pass the original mapping to the metaclass without enumerating it. Descriptors, subclass hooks and decorators retain their ordering. |
| Native construction | `type.__new__` accepts a dictionary and copies it; custom metaclasses may explicitly convert another mapping. Original mappings remain independent of final class mutation. Validate and propagate `__classcell__`; missing, invalid or mismatched cells retain construction errors. |
| Comprehensions | The first iterable reads the prepared mapping. Inlined comprehension bodies keep their isolated namespace and lexical/global lookup rules. |

The [29-case matrix](../tests/fixtures/interpreter/prepared-class-namespaces.json)
is pinned to CPython 3.14.7. Callback ownership tests collect at parked instruction
boundaries and cover completion, cancellation and close. All work shares the
existing execution/arena limits. No host mapping or executable is admitted.
Factories and custom MRO remain O81–O82; slots and builtin storage remain O84–O88.
Unadopted dictionary library methods retain #116; native diagnostic completion
retains O90.

References: [pinned class preparation](https://github.com/python/cpython/blob/v3.14.7/Python/bltinmodule.c),
[pinned type validation/copying](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
