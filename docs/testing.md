# Validation suites

Local work and CI use `scripts/test_manifest.py` through the same runner. Install
the declared tools with `uv sync --locked --group compiled-build --group browser-tests`.
Interpreter differential checks require the pinned CPython 3.14.7 oracle; use
`UV_PYTHON=3.14.7` on POSIX or set `$env:UV_PYTHON = "3.14.7"` in PowerShell.

```sh
# Preview and run only a feature's Node units and differential drivers.
uv run --no-sync python scripts/run_tests.py focused --feature native-descriptors --list
uv run --no-sync python scripts/run_tests.py focused --feature native-descriptors

# The same suites and shard assignments used in CI.
uv run --no-sync python scripts/run_tests.py interpreter --shard 1 --shards 4
uv run --no-sync python scripts/run_tests.py prepare-browser
uv run --no-sync python scripts/run_tests.py browser-conformance --shard 1 --shards 4
uv run --no-sync python scripts/run_tests.py browser-integration --shard 1 --shards 3
uv run --no-sync python scripts/run_tests.py python
```

`python` prepares the supplied runtime, checks generated locks, runs Python tests,
builds distributions and checks isolated installations. `interpreter` combines
Node unit and differential checks. `browser` combines browser conformance and
integration checks. `reference` contains standalone CPython reference runs;
`measurements` contains the repeated diagnostic workloads. `full` runs all of
these, including preparation and the short `smoke` suite, in dependency order.
`pr` runs the regression suites without standalone references or measurements.
For application measurements,
place the Python-JavaScript checkout at `build/compiler-reference`, at revision
`804a70fa37ef4ca126519c7222d1862966a63d0c`; CI supplies that reference automatically.

Repeat `--feature` to select multiple check ID substrings. `--list` (or `--dry-run`)
previews commands without executing them. Independent checks use deterministic
weighted shards; packaging and preparation retain their required order. New
`runtime/*.test.mjs` files are included automatically. Add a corpus or a new
driver/profile combination to the manifest alongside its implementation.

Each invocation writes a JSON report and command logs under `build/test-results/`.
Reports include the tested Git revision, whether the checkout was modified,
selected suites/features, command results and durations. Use `--report PATH` for
a separate report location. Failures print the end of their log and return a
nonzero exit status after the remaining selected checks finish.

## Fast development and merge policy

Run the smallest meaningful local checks for the behavior being changed. A
feature's Node unit file and differential matrix are usually enough while
implementing it; add browser or package checks when the change touches those
paths. Let the parallel PR workflow provide broad regression coverage. Do not
repeat the full local suite when passing CI already covers the same code.

PR coverage retains every Node test, both interpreter drivers, core/class
profiles, parked execution where adopted, browser conformance, offline console
and Stop/Restart acceptance, and packaging on Linux/macOS/Windows. Browser
conformance uses six cost-balanced shards to fit the expanded native layout
inventory within the existing job timeout. Standalone CPython reference runs
duplicate references already exercised by differential
checks, so they and repeated measurements run only in exhaustive validation.
Nightly validation runs at 10:23 UTC; manual dispatch, release tags and the
publication workflow also run the exhaustive inventory. Publication waits for
that validation. Main pushes only build a wheel, start its installed CLI and
execute a small program in each interpreter source profile.

Reuse the successful PR run for an ordinary squash merge. Merge stacked PRs
oldest first, reconcile and retarget immediate dependents before removing their
parent branch, and trust Git's normal merge/conflict handling. A clean base
reconciliation or retarget alone does not require new local suites, byte-for-byte
tree/artifact comparisons, or another full CI waiting period. Passing checks on
a descendant that includes the dependency can supply batch evidence for that
dependency. Record the relevant run link in the PR when reusing that evidence.
No up-to-date-branch requirement or merge queue is added by this policy.

Re-run affected checks when implementation changes, conflicts require edits,
checks fail, or overlapping changes create a concrete integration concern.
History-only reconciliation commits may use GitHub's `[skip ci]` marker after
successful batch coverage; never use it to hide implementation changes or a
failure. Do not rewrite shared history. Inspect the ordinary PR diff when
retargeting, stop if a Git operation fails, and verify the completed batch with
the final main smoke run. Superseded runs cancel automatically. Test reports and
run links identify evidence without downloading and rehashing every artifact.
