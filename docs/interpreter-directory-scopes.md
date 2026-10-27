# Directory copying and generator-expression namespaces

O18–O20 continue the finite reflection work under #123. CPython 3.14.7 is
the executable oracle for `tests/fixtures/interpreter/reflection.json`.
Reference-only cases specify behavior before independent implementation.
The APIs retain classes-source/1 and bytecode 5; core-source/1 stays unchanged.

O18–O20 are implemented within the finite boundaries below. The compatibility
inventory and offline console include composed acceptance of all three stages.

| Stage | Contract |
| --- | --- |
| O18 | `locals()` and zero-argument `vars()` inside generator expressions containing no list/dict/set comprehensions return fresh shallow snapshots of the acquired outer iterator under `.0`, currently bound targets and captured free cells in Python order. Zero-argument `dir()` sorts those names. Aliased builtins inspect their immediate Python caller. Snapshot mutations cannot rebind cells; escaped iterators and values keep their ordinary identity after suspension and close. Private compiler storage stays hidden. |
| O19 | When a custom `__dir__` result is a user instance, acquire its iterator, then consult the original iterable's type-selected `__len__` and, if length is absent or raises TypeError, `__length_hint__`. Length accepts the existing index protocol; a hint must itself be an integer. A hint call raising TypeError or returning NotImplemented uses the default. Hint descriptor lookup failures propagate; other callback failures propagate. Negative counts raise ValueError and counts outside the signed 64-bit size range raise OverflowError. Counts above the adopted sequence bound refuse through the shared budget before consumption. Hints do not constrain the number of yielded entries. |
| O20 | Custom directory entries may be arbitrary adopted values. Return a fresh, stable sorted list using rich less-than and truth conversion, preserving duplicates and entry identities. Copy the iterable completely before comparison callbacks. Descriptor, reflected ordering and truth phases enter ordinary owned frames. The comparison schedule is an implementation choice; callers must not depend on a particular number or sequence of comparisons. |

`__len__` rejects every negative result before signed-size conversion, so even a
huge negative length raises ValueError. `__length_hint__` converts first: a value
below the signed minimum raises OverflowError, while the representable negative
minimum raises ValueError. Descriptor errors and callback errors retain their
separate recovery phases in both cases.

Inlined list/dict/set comprehension reflection, live module/class/global
namespaces, instance dictionaries, mapping proxies, default directories, boxed
integer identity, builtin instance layouts and dynamic source remain separate
contracts. Admitting `__length_hint__` for this directory copy does not adopt
length hints for other iterable consumers. Those consumers keep their explicit
refusals. Native iterator adapters for user length hints retain their existing
boundaries. Native coroutine/await and host adapters remain under #34.

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

## Accepted evidence

The 160-case reflection matrix contains 147 adopted comparisons and thirteen
explicit refusals. Node and Chromium each pass draining and instruction-boundary
execution: 640 observations and 640 measured zero logical teardown records.
All 58 source/driver hashes and the corpus hash match the retained reports.
Comparison scheduling is deliberately outside the conformance promise; stable
results, identities, descriptor/truth behavior and error propagation are covered.

All 948 Node tests pass, including the eight unchanged composed resource cases.
Dedicated tests collect between instructions and interrupt length, hint, index,
descriptor, comparison and truth callbacks, including partial copies and escaped
generator iterators. Callback/source errors, recursion and real instruction/work/
allocation failures release their owners. The 60-test Python suite passes with
one optional runtime skip, including its loopback integration test with local
server access. Wheel/source allowlists and four isolated installations pass.

Installed-wheel offline acceptance passes 845 program comparisons and 58 groups,
with 130 Stop/Restart cycles. The reflection example composes advisory length
hints, rich comparison/truth results and escaped generator-expression snapshots
after offline reload. A waiting class-to-core update still removes reflection
builtin authority. The inventory's 128 probes retain explicit live/inlined
namespace and host boundaries.

The [payload and source record](measurements/2026-10-27-directory-scopes.json)
verifies all 38 files and 37 receipt members at 645,626 bytes; a fresh assembly is
identical. This is exact payload evidence without a performance, package, device
or native-async claim. #123 and #34 remain open for their remaining slices.
