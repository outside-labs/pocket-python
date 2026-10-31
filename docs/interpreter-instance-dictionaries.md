# Live instance dictionaries

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O47/O48 continue #123 and #33. The executable reference is CPython 3.14.7;
`tests/fixtures/interpreter/instance-dictionaries.json` records the finite
contract. Reference execution alone does not establish independent execution.

| Stage | Contract |
| --- | --- |
| O47 | Ordinary object-derived instances expose their live attribute dictionary through `__dict__` and `vars`. Existing attributes retain insertion order and value identity. Exact dictionary replacement supports sharing and cycles; deletion detaches old aliases and subsequent access creates an empty dictionary. Non-dictionary replacement raises TypeError. Custom attribute hooks and data descriptors retain priority. |
| O48 | Dictionary-backed attribute reads, writes and deletions run adopted hash/equality collisions on the owned execution machine. Each operation retains its original dictionary and class fallback while callbacks run. Missing reads use the selected class descriptor/value or AttributeError. Read callback errors preserve their original type and source frames; dictionary mutation converts KeyError to AttributeError as the native object setter does. |

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
mutation checks. Reads preserve a callback's KeyError; dictionary writes/deletes
convert it to AttributeError without retaining its callback frames. Data-descriptor
mutation errors bypass that conversion. Explicit
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

O47 is implemented with lazy promotion from compact instance attributes to an
owned dictionary. The original storage matrix adopts 32 source cases and retains
five explicit reflection refusals.
Focused arena checks cover cycles, foreign dictionary/value transfers, real
allocation failure, transactional rollback and collection after replacement.

O48 uses the shared dictionary probe/mutation phases and an exhaustive owned
continuation for the original receiver, supplied name and selected class fallback.
Missing probes bind that retained fallback. Read callback failures and non-KeyError
mutation failures propagate unchanged. The expanded source matrix includes
explicit refusals, including structural dictionary mutation during comparison.
Lifecycle checks detach receivers, dictionaries and class descriptors during
parked callbacks, then finish, cancel or close with zero logical owners remaining.

All 67 pinned source cases (61 comparisons and six explicit refusals) pass through
Node and Chromium drain, instruction-boundary and parked execution: 402
observations with 402 zero logical teardowns. Retained reports verify 348 current
runtime/driver hashes. Thirty representative probes extend the compatibility
inventory to 295 observations per target. All 71 feature units, 556 adjacent
units and 22 affected Python tests pass; the eight composed execution
observations remain unchanged.

The [instance-state console](../examples/interpreter_instance_dictionaries.py)
composes replacement/deletion aliases, retained methods, properties, lazy
generators and dictionary replacement during collision callbacks. Installed-wheel
offline acceptance passes 1,754 program comparisons, 100 groups and 181
Stop/Restart cycles. The [payload record](measurements/2026-10-28-instance-dictionaries.json)
verifies all 38 files at 706,001 bytes, with an identical fresh rebuild. These are
finite semantic/source/payload observations. Broader reflection remains under
#123/#33 and native async/host adapters remain under #34.

The [O49 keyed class namespace contract](interpreter-class-namespaces.md)
supersedes earlier blanket class-mapping refusals. Enumeration and native
layout/source metadata entries retain explicit boundaries.
