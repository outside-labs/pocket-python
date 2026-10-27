# Ordinary sequence repetition

R1–R3 continue the finite arithmetic protocol in #123. CPython 3.14.7 is the
executable reference for `tests/fixtures/interpreter/repetition.json`.
Reference-only observations do not establish independent execution.
R1/R2 are implemented in both source profiles; R3 uses classes-source/1.

| Stage | Contract |
| --- | --- |
| R1 | Ordinary list and tuple multiplication accepts integer/boolean counts on either side. Copies are shallow: list results always have independent outer storage while contained objects retain identity. A tuple repeated once, or an empty tuple repeated by any valid count, retains its original identity. Nonpositive counts produce empty results. |
| R2 | String multiplication repeats Unicode code points on either side, including astral characters, combining marks and lone surrogates. Augmented assignment rebinds the immutable string/tuple result. Count one retains the original immutable value. |
| R3 | After adopted numeric/reflected multiplication candidates return NotImplemented or are absent, repetition converts a user count through actual-type-selected `__index__`. Descriptor binding and invocation use ordinary owned frames, ignore instance shadows and ordinary attribute hooks, and run exactly once even for an empty sequence. Callback-visible list replacement, deletion and growth take effect before copying. In-place list repetition retains its existing alias and factor-quota contract. |

Primitive R1/R2 source runs in core-source/1 and classes-source/1, retaining
bytecode 4/5. User callbacks require classes-source/1. Arithmetic methods can
return arbitrary owned values; a successful result suppresses index conversion.
Binding/body errors, invalid index results and NotImplemented truth/conversion
errors propagate without requesting further fallback. Existing right-subclass
priority and same-type reflected suppression remain unchanged.

Ordinary repetition first converts the count to a signed 64-bit index-sized
integer. Overflow raises Python OverflowError before inspecting empty/negative
output cases. Valid negative factors clamp output length to zero. Compute the
result length with exact integers and reject growth beyond the existing 1,024
container-item or 65,536 text-code-point quota before host allocation. Count
conversion, traversal and copying consume the activation's work budget. Existing
primitive bytes repetition and list in-place accounting are unchanged.

The owned arithmetic/index continuation retains both original operands and the
outer destination across descriptor/callback frames and collection. Copy the
sequence only after conversion returns; do not retain an earlier list snapshot.
Work/instruction/recursion/allocation failures, cancellation and idempotent close
release all logical owners without invoking new callbacks or finalizers. The
eight existing composed resource observations retain their accounting.

Direct native repetition descriptors, builtin instance subclasses, memoryview
repetition and bytearray in-place resizing keep their separate boundaries.
Broader namespace/metaclass/dynamic-source protocols remain under #123; native
coroutine/await and host adapters remain under #34. No dependency, host grant,
release, publication or deployment is included.

Acceptance requires the pinned source matrix in Node/Chromium with draining
and instruction-boundary drivers, shared primitive core cases, owned lifecycle
and resource-failure tests, installed offline execution and Stop/Restart, then
an exact reproducible example asset record.

Semantic anchors: Python 3.14 [sequence operations](https://docs.python.org/3.14/library/stdtypes.html#common-sequence-operations),
[numeric dispatch](https://docs.python.org/3.14/reference/datamodel.html#emulating-numeric-types)
and the pinned [multiplication fallback](https://github.com/python/cpython/blob/v3.14.7/Objects/abstract.c).
