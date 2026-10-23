# Executable maintenance audit

Run from the repository root with the installed project environment:

```sh
python runtime/check_version_audit.py --report build/version-audit-reference.json
python runtime/check_version_audit.py --target node --report build/version-audit-node.json
python runtime/check_version_audit.py --target browser --report build/version-audit-browser.json
python runtime/check_version_audit.py --target matrix --report build/version-audit-matrix.json
python -m unittest discover -s tests -p test_version_audit.py -v
```

The command requires **CPython 3.14.7 / Unicode 16.0.0** and fails before
execution if that identity changes. It never installs an interpreter or changes
the oracle. It reads only the finite committed corpus in
`tests/fixtures/interpreter/version-audit/`; there is no arbitrary source input.
Each program is at most 8 KiB, with a five-second subprocess deadline, and this
corpus uses at most ten dictionary entries and small scalar/container values.

The manifest links each case to official tagged CPython sources. Eight cases
describe observable semantic/diagnostic deltas; four controls cover list deletion,
Unicode binding/conversion and small-precision formatting. Controls do not
reproduce the related native allocation or security defect. Six excluded probes
retain explicit reasons, including near-`INT_MAX` precision, stale native `errno`,
and the old comprehension compiler crash. This is a bounded audit, not a complete
regression suite for either maintenance release.

Every reference subprocess compiles the committed synthetic Python text. CPython
is only the oracle. A reference-only report sets `source_execution: false`, has
zero engine observations and makes no Node/Chromium claim. The pinned expected
signatures are checked against fresh observations; disagreement fails the run.
Stdout, exception type and declared diagnostic fields are compared. Full observed
exception messages are retained even when they are outside the declared
cross-platform signature.

Later outcomes are explicitly **source-only** expectations with the first
relevant maintenance release. They remain `not-independently-verified`; the
3.14.7 observation cannot turn them into later-version execution evidence. A
later installed interpreter and explicit comparison would be needed for that.
`control-only` means no version difference is being asserted for that probe.

Reports hash the manifest, each source, this harness and the official source
identity ledger. Hashes normalize CRLF to LF, matching existing engine reports.
This identifies logical text across platform checkouts; it is not a raw-byte
archive integrity claim. The audit does not modify shared corpus inventories,
engine assets, profiles, workflows or dependency locks.

## Independent engine observations

Node uses the existing `runtime/source-runner.mjs`; Chromium uses the existing
`runtime/source-worker.mjs` through `check_conformance.run_browser`. Both call
the public source-request adapter and independently compile the Python text.
No CPython bytecode, Python AST compiler, hand-compiled fixture or oracle fallback
enters the engine. Both `core-source/1` and `classes-source/1` are requested
explicitly, with an empty supplied module/import grant registry apart from `app`.
Use `--channel chrome` only to select an already installed browser channel.

The manifest declares each engine observation's expected classification:

- `supported`: a successful control matches the pinned observable signature.
- `unsupported`: an explicit profile refusal, with its phase and exception type.
- `unavailable-builtin`: a named builtin is absent and raises `NameError`.
- `denied-import`: the source session has no declared library import grant.
- `syntax-rejection`: invalid source is rejected; diagnostic contracts differ.

Only `supported` receives compatibility credit for that finite control signature.
The other classifications describe boundaries and receive none. Refusals must
occur at the declared phase; a malformed source registry cannot masquerade as a
feature refusal. The Unicode numeric control compares converted values with
scalars so that it measures conversion separately from float display.

The report checks every response ID exactly once. Created sessions must retain
the requested profile and source SHA-256 in compilation metadata, have no live
frames at completion, and close with zero bytes, objects, roots, frames and
external handles. A compile refusal must have no session, output or teardown
counters: it reports `session-not-created`, never a measured zero teardown.
This is logical engine accounting, not JS heap reclamation or CPython GC.

The matrix command reruns both hosts, verifies identical oracle/corpus/harness
and engine source identities, and compares compact observations including
compile fingerprints, errors and teardown. Host disagreement fails the command.
It preserves the two actual host versions and Playwright/channel identity, with
one copy of the reference evidence. Full single-host reports retain additional
compiler and allocation statistics. None of these commands execute a later
CPython interpreter.

The existing CI discovers `tests/test_version_audit.py`, including its real Node
check when the pinned oracle and Node are available. Browser and matrix audit
commands are standalone local checks; this batch does not add workflow steps.
Existing CI's broader browser suite remains separate evidence from this audit.
The checked-in [observation snapshot](observations.json) is historical evidence
for its recorded hashes. It must not be interpreted as a fresh run of a later
merged engine tree. Recreate a current matrix before using it after integration.
