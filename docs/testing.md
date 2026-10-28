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
these, including preparation, in dependency order. For application measurements,
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
