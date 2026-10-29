# Live instance dictionaries

O47/O48 continue #123 and #33. The executable reference is CPython 3.14.7;
`tests/fixtures/interpreter/instance-dictionaries.json` records the finite
contract. Reference execution alone does not establish independent execution.

| Stage | Contract |
| --- | --- |
| O47 | Ordinary object-derived instances expose their live attribute dictionary through `__dict__` and `vars`. Existing attributes retain insertion order and value identity. Exact dictionary replacement supports sharing and cycles; deletion detaches old aliases and subsequent access creates an empty dictionary. Non-dictionary replacement raises TypeError. Custom attribute hooks and data descriptors retain priority. |
| O48 | Dictionary-backed attribute reads, writes and deletions run adopted hash/equality collisions on the owned execution machine. Each operation retains its original dictionary and class fallback while callbacks run. Missing entries use the selected class descriptor/value or AttributeError; callback exceptions preserve their original type and source frames. |

The native instance dictionary slot belongs to the ordinary class that first
introduces the object-derived instance layout. An explicit class `__dict__`
attribute can shadow it in that class or a subclass. Inherited slots retain
their data-descriptor priority over dictionary entries named `__dict__`.
Custom properties and get/set/delete descriptors retain ordinary binding and
precedence; `vars` still returns custom lookup results unchanged. Native
`object.__getattribute__`, `object.__setattr__` and `object.__delattr__` bypass
custom instance hooks while preserving descriptor dispatch.

Dictionary values are returned unchanged, without descriptor binding. Data
descriptors precede stored values; stored values precede non-data descriptors
and class attributes. Implicit special protocols keep actual-type lookup.
Arbitrary adopted dictionary keys retain normal hash/equality semantics and
mutation checks. A callback's KeyError is not a missing attribute. Explicit
supplied attribute names retain insertion/callback identity; replacing equal
keys keeps the first stored key. Implicit source names have no interning promise.

Materialization preserves the compact storage of an untouched instance. Reading
its native dictionary, replacing it or using an explicit supplied insertion name
adopts ordinary arena-owned dictionary storage. Deletion resets compact storage
without changing old dictionary aliases. Attaching a dictionary validates all
arena edges transactionally. The instance, original dictionary, selected class
fallback, keys and values remain owned through collection, parking, cancellation,
failure and close. Any accounting extension must retain the earlier composed
observations and identify storage/work introduced by this feature.

This belongs to classes-source/1 and bytecode 5. Root `object` instances have no
dictionary. Class/module mappings, native getset descriptor reflection, explicit
super dictionary reflection, default directories, builtin subclass layouts and
unadopted special attribute names remain separate contracts. Native coroutine/
await and browser host adapters remain under #34. No dependency, host grant,
release, publication or deployment change is included.

Reference implementations: [generic attribute lookup and mutation](https://github.com/python/cpython/blob/v3.14.7/Objects/object.c)
and [instance dictionary slots](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
