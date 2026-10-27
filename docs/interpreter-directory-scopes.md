# Directory copying and generator-expression namespaces

O18–O20 continue the finite reflection work under #123. CPython 3.14.7 is
the executable oracle for `tests/fixtures/interpreter/reflection.json`.
Reference-only cases specify behavior before independent implementation.
The APIs retain classes-source/1 and bytecode 5; core-source/1 stays unchanged.

O18 is implemented. O19 and O20 remain reference-only stages until their
separate implementation changes are accepted.

| Stage | Contract |
| --- | --- |
| O18 | `locals()` and zero-argument `vars()` inside generator expressions return fresh shallow snapshots of the acquired outer iterator under `.0`, currently bound targets and captured free cells in Python order. Zero-argument `dir()` sorts those names. Aliased builtins inspect their immediate Python caller. Snapshot mutations cannot rebind cells; escaped iterators and values keep their ordinary identity after suspension and close. Private compiler storage stays hidden. |
| O19 | A custom `__dir__` result is copied after acquiring its iterator. Consult the original iterable's type-selected `__len__`, then `__length_hint__` if length is absent or raises TypeError. Length accepts the existing index protocol; a hint must itself be an integer. A hint call raising TypeError or returning NotImplemented uses the default. Hint descriptor lookup failures propagate; other callback failures propagate. Negative counts raise ValueError and counts outside the signed 64-bit size range raise OverflowError. Counts above the adopted sequence bound refuse through the shared budget before consumption. Hints do not constrain the number of yielded entries. |
| O20 | Custom directory entries may be arbitrary adopted values. Return a fresh, stable sorted list using rich less-than and truth conversion, preserving duplicates and entry identities. Copy the iterable completely before comparison callbacks. Descriptor, reflected ordering and truth phases enter ordinary owned frames. The comparison schedule is an implementation choice; callers must not depend on a particular number or sequence of comparisons. |

Inlined list/dict/set comprehension reflection, live module/class/global
namespaces, instance dictionaries, mapping proxies, default directories, boxed
integer identity, builtin instance layouts and dynamic source remain separate
contracts. Admitting `__length_hint__` for this directory copy does not adopt
length hints for other iterable consumers. Those consumers keep their explicit
refusals. Native coroutine/await and host adapters remain under #34.

Directory copying retains the original iterable, acquired iterator and partial
copy across callbacks. Sorting retains every entry, comparison result and outer
destination. The closed continuation records enumerate all logical roots.
Traversal, validation, copying, ordering and truth conversion share the existing
instruction/work/arena budgets; hints never request an unbounded host allocation.
Cancellation, close, callback exceptions and real allocation failure release
all owners without running new finalizers. The eight established composed
resource observations retain their accounting rules.

Acceptance requires the pinned source matrix in Node and Chromium through drain
and instruction-boundary execution, collection between instructions, interruption
in descriptor/body/truth callbacks, source diagnostics and zero logical teardown.
The installed offline console must execute new composed source after reload and
recover through Stop/Restart. Compatibility boundaries and exact example assets
must match the accepted source. No dependency, service, host grant, release,
publication or deployment change is included.

Semantic anchors: Python 3.14 [dir](https://docs.python.org/3.14/library/functions.html#dir),
[locals](https://docs.python.org/3.14/library/functions.html#locals),
[length hints](https://docs.python.org/3.14/library/operator.html#operator.length_hint)
and [sorting stability](https://docs.python.org/3.14/howto/sorting.html#sort-stability-and-complex-sorts).
Pinned reference cases settle the finite callback/error boundaries.
