# Executable maintenance audit

Run from the repository root with the installed project environment:

```sh
python runtime/check_version_audit.py --report build/version-audit-reference.json
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
