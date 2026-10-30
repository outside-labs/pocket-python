# Expanded class bases and keyword mappings

O79 of #123 extends `classes-source/1` class headers over the ordinary owned
argument assembly and callback machine. The source grammar accepts repeated
`*bases` and `**keywords`, named keywords and explicit `metaclass`. Positional
base expressions, including starred iterables, run before keyword expressions;
each is evaluated once. Mapping keys are obtained through `keys()` and indexed
lookup. Duplicate keywords and non-string keys fail before base resolution or
class-body effects. The existing argument, base, work and memory bounds apply.

| Construction | Base resolution and identity |
| --- | --- |
| Class statement | Skip actual types. For each remaining original base, optionally read `__mro_entries__` through ordinary attribute lookup and call it with the same original bases tuple. Only lookup AttributeError is optional; callback failures propagate. |
| Replacement | Require a tuple, splice its members once and do not resolve replacements recursively. Select the metaclass from the resolved bases. Duplicate bases and hierarchy conflicts retain their normal construction timing. |
| Original bases | After body execution, store the exact original tuple as `__orig_bases__` only when a hook replaced bases. This overwrites a body entry and remains visible in escaped body dictionaries and the final class. |
| Direct `type` or metaclass call | Require tuple bases and dictionary namespace. Do not perform MRO entry resolution; non-type bases fail without invoking hooks. |

Private names, class cells, decorators, class keywords, descriptors and subclass
notifications compose with the existing construction path. GenericAlias and
type parameters remain #125. Prepared mappings, factories and custom MRO are
O80–O82. Every callback shares the caller's recursion/instruction/work/allocation
limits, original source frames, parking, cancellation and close ownership.

The [26-case source matrix](../tests/fixtures/interpreter/expanded-class-bases.json)
uses CPython 3.14.7 as its reference. Node units also collect at instruction
boundaries and interrupt a suspended base-resolution callback. The common
manifest includes Node/Chromium drain, stepped and parked execution; installed
console acceptance includes successful programs.

References: [pinned base resolution and class construction](https://github.com/python/cpython/blob/v3.14.7/Python/bltinmodule.c),
[pinned type construction](https://github.com/python/cpython/blob/v3.14.7/Objects/typeobject.c).
