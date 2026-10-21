# Interpreter profile measurements

`scripts/interpreter_measurements.py` assembles and observes core-only/1 and
operator/1 source consoles. Optional comparisons use the pinned compiled-build
tooling and an explicitly supplied, verified MicroPython runtime. All profiles
execute the same canonical text-metrics computation over three inputs: empty,
Unicode with a newline, and a nonbreaking space. CPython independently verifies
the complete program's stdout before measurement. The shared computation hash
is recorded alongside the complete program and expected output.

```sh
uv sync --locked --group compiled-build --group browser-tests
uv run python scripts/prepare_runtime.py
uv run python -m playwright install chromium
uv run python scripts/interpreter_measurements.py --compiled \
  --micropython-runtime build/runtime --repeats 5 \
  --output build/interpreter-measurements
```

Choose a new output directory; existing outputs are refused. The tool publishes
report.json and one canonical tar.gz per selected profile. `--no-browser` collects
payload and Node observations without importing Playwright; omit `--compiled`
and `--micropython-runtime` for the two independent source profiles alone. The
report explicitly labels unavailable comparisons and future Wasm/host profiles.
CI runs both this Node-only path and the four-profile real-browser path.

## Complete payload and compression

Before counting, the tool verifies the exact receipt, file set, sizes and hashes.
It refuses unrecorded, missing or changed files and unknown file roles. Disjoint
buckets cover engine code, browser bridge/protocol code, optional Python library
code, application source, generated application modules, compatibility helpers,
source maps, notices, data, generated assembly modules and the receipt itself.
Their sum must equal the complete artifact size. Bridge classification is
explicit and the per-file report records every choice. This separates SDK/host
costs from language-engine and ordinary library costs without omitting them.

`gzip_file_transfer_bytes` sums independently gzipped files at level 9 with
mtime 0. This estimates compressed payload bytes; it excludes HTTP/TLS framing,
server compression policies, request timing and cache reuse. A separate archive
uses sorted USTAR entries with mode 0644 and mtime 0, then the same gzip policy.
Archive hashes and zlib version are recorded. The archive and transfer totals
describe different packaging choices.

Both source profiles retain the same complete engine and bridge. The common
workload needs no library. Selecting operator/1 adds its ordinary Python source
and selection metadata; it is not a parser/VM optimization. The separate
[profile conformance suite](interpreter-profiles.md) exercises all eleven selected
operator functions, intentional missing-library errors and bootstrap closure.
No result proves general minimality or justifies removing VM internals.

## Timing boundaries

Each browser cold sample starts a fresh context in the same Chromium process;
OS caches are uncontrolled. Readiness is observed by DOM mutation relative to
navigation. Source and compiled consoles report Ready before corpus execution.
The existing MicroPython shell automatically runs on navigation, so its
navigation-to-Finished observation includes both engine startup and the corpus.
Those startup values have different boundaries and do not establish a ranking.

Warm samples follow installation, an untimed warm-up, then reload/run using the
same-version service-worker cache. Click-to-observed-corpus stdout is recorded
for each profile. Source samples additionally wait for terminal completion before
another run. Source/compiled shells retain a worker; the MicroPython shell
creates and terminates a worker for each run. Counts are included. A separate
offline reload must reproduce the corpus output. Requests must remain local
static GETs, and an unhandled page error fails collection.

Node timing uses fresh processes for engine-module import and the first
compile/registry/run. Within each process, repeated runs create fresh language
registries and arenas, including library verification. The warm summary is the
median of per-process medians; nested runs are not independent process samples.
Timing processes do not force GC. Report raw samples, versions, sample count,
host platform, repository revision, modified-tree flag and tool hashes accompany
all summaries. Build time is a single descriptive observation per artifact.

## Memory scopes

Browser memory collection uses separate untimed contexts and forces GC through
CDP before reading the dedicated worker's Runtime.getHeapUsage at Ready and after
corpus output. V8 heap, embedder heap and backing storage are observed values,
excluding the page, service worker, cache, process RSS, peak allocation and
unreported native/Wasm memory. The compiled adapter has no asserted transport
quiescence. The MicroPython shell has already terminated its worker at Finished;
retained-worker memory is explicitly unavailable rather than sampled after
changing that product lifetime.

Separate Node --expose-gc processes collect process.memoryUsage after forced GC
at the imported baseline, compiled registry, completed live session and teardown.
RSS is a snapshot, not peak RSS. Arena peakBytes accounts logical VM/registry
allocations and excludes parser, host and V8 overhead. Teardown must release
logical bytes, roots and frames; this is distinct from host heap collection.
Neither logical accounting nor these host observations establish a hard physical
memory bound. Compare repeat observations only within their recorded scopes.

## Recorded baseline: 2026-10-21

The [complete report](measurements/2026-10-21-interpreter.json) was collected from
clean commit [0ac0cbe](https://github.com/outside-labs/pocket-python/commit/0ac0cbe7144cff85ccbc485ce4feda323666bc10),
using Python 3.14.7, Node 24.19.0, Playwright 1.64.0 and Chromium 156.0.8078.4 on
Darwin 27.0.0 arm64. Each condition has five observations, with nested Node warm
runs summarized per process. The supplied MicroPython identity and compiled
producer/profile/source fingerprint are retained in the report. All four profiles
reproduced the exact CPython corpus output online and after offline reload.

All sizes below are bytes and include the complete application receipt:

| Profile | Complete payload | Independent-file gzip | Canonical tar.gz |
| --- | ---: | ---: | ---: |
| Source core-only/1 | 268,574 | 78,117 | 68,752 |
| Source operator/1 | 271,475 | 78,914 | 69,249 |
| Compiled, maps omitted | 93,829 | 29,919 | 26,815 |
| Supplied MicroPython | 577,275 | 236,390 | 235,116 |

Both source selections have 195,095 engine bytes and 29,985 bridge bytes. Selecting
operator/1 adds 457 library-source bytes and 2,444 configuration, receipt and
assembly bytes: 2,901 additional bytes overall. Original notices are already
present in the core closure. These exact corpus artifacts establish the selected
optional-library difference, without claiming a smaller generated VM. The
compiled artifact has no interpreter or deployed source editor; the MicroPython
artifact uses its existing fixed-program shell.

Observed median browser times, in milliseconds:

| Profile | Cold context readiness | Installed warm readiness | Warm click to stdout |
| --- | ---: | ---: | ---: |
| Source core-only/1 | 52.9 | 22.6 | 29.5 |
| Source operator/1 | 57.8 | 28.7 | 32.3 |
| Compiled | 38.4 | 22.4 | 1.3 |
| Supplied MicroPython | 37.3 | 21.9 | 17.0 |

The MicroPython readiness column includes its automatic corpus run; the other
rows stop at Ready before the run. Its click samples create new workers while
the other profiles reuse theirs. Fresh contexts do not flush OS caches. These
are observations on this host and workload with different adapter boundaries,
without a universal startup or execution-speed conclusion.

After-output median dedicated-worker V8 used heap was 1,165,476 bytes for core,
1,280,008 for operator and 439,800 for compiled. Embedder/backing-storage fields
are recorded separately. MicroPython retained-worker heap is unavailable because
the shell terminates that worker. These values exclude browser process/page/cache
memory and unreported native/Wasm allocations.

Node's median cold compile/registry/run was 24.80 ms for core and 26.80 ms for
operator; median warm per-process medians were 9.06 and 10.82 ms. Maximum observed
logical arena peaks were 23,354 and 30,450 bytes, respectively. Every measured
session released its logical bytes, roots and frames on close. The corresponding
median live process RSS snapshots were 65,159,168 and 65,929,216 bytes, illustrating
why logical accounting is not a physical-memory limit. Raw samples and baseline,
compiled, live and closed process snapshots remain available in the report.
