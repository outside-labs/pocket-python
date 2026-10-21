# Complete browser application measurements

MEASURE-01 defines browser-python-footprints/1, a versioned report for comparable
browser Python application profiles. The first measured profiles are the compiled
text-input PWA with and without source maps. Both use the same computation,
inputs, UI, host protocol and observation method. Independent interpreter data
can join this format once its source/host application exists; missing engines
remain explicit availability records with no invented byte or timing values.

Run from the development checkout with the declared build/browser tooling:

```sh
uv sync --locked --group compiled-build --group browser-tests
uv run --no-sync python -m playwright install chromium
uv run --no-sync python scripts/measure_applications.py \
  --compiler-report ../Python-JavaScript/docs/measurements/2026-10-20-compiler.json \
  --repeats 5 --output build/application-measurements
```

--compiler-report selects the existing compiler component report explicitly; no
compiler repository is silently fetched by the script. CI checks out its adopted
public revision 804a70fa37ef4ca126519c7222d1862966a63d0c to supply that evidence.
A freshly reproduced compiler report is also accepted when its schema, reference
status, source build and common computation match. The original input bytes are
retained as compiler-component-report.json beside the new report with their hash.
Unknown report versions, missing browser/reference evidence or a different
installed compiler/computation are refused. --no-browser collects build/payload
observations with browser fields absent; it supplies no startup/memory result.
--channel chrome records an installed Chrome's actual version. Existing output
is refused.

Output includes report.json, the exact component report and two canonical
compressed PWA archives. Measurement reports are outside the shipped PWA; the
payload counts describe the files inside each application archive, including
its receipt. The script executes only the adopted text-metrics fixture. All
observed application requests must be local static GETs; no remote execution or
upstream interpreter enters a compiled profile.

## Report contract and comparable behavior

The report kind is pocket-python-application-measurements, schema_version=1 and
suite=browser-python-footprints/1. It records collection/repository/script/tool/
host identities, the canonical-LF common source hash, the exact input/output
workload, compression methods, raw samples, profile feature/version information,
comparison sets and unavailable profiles.

Each measured profile has an explicit source-execution mode, new-source flag,
UI profile, capabilities, producer/host versions, source/file records, physical
size buckets, build samples and optional browser observations. Schema changes to
units or comparison semantics need a new version. Reported timings require their
matching method and environment; a field named memory is not enough to compare
engines that measure different allocations.

The shared computation is text_metrics.metrics from the [server/browser example](shared-application.md).
The workload is empty text, supplementary Unicode/combining marks with LF, and a
non-ASCII space. Each result is observed through the actual UI/worker output path
and must equal CPython. The compiler component report uses this exact computation
hash, but a different synchronous adapter and harness. Its initialization/call
boundary is recorded separately and is not ranked against full PWA readiness or
worker memory. Original notices remain in every application archive.

The independent JavaScript source interpreter is deferred behind INT-WEB-01 and
a comparable host adapter; partial VM tests cannot supply this application
measurement. The later C/Rust WebAssembly lane remains planned. MicroPython's
existing schema-1 script shell lacks the same adopted text-input adapter, and
Pyodide remains an unselected integration. Their availability entries contain
reasons/gates instead of zero-sized or faster/slower comparison rows. INT-WEB-01/
INT-11 can add matched interpreter producers to the profile array using this
common workload and explicit engine/source asset buckets. Feature gaps remain
part of any later comparison.

## Complete payload accounting

| Field | Meaning |
| --- | --- |
| input_source_bytes | Selected original source input; not added again to the physical payload |
| application_source_bytes | Standalone runtime application source assets; zero for these compiled outputs |
| generated_module_bytes | Emitted application/module/worker code |
| helper_bytes | Original compatibility runtime and browser host/protocol helpers |
| interpreter_asset_bytes | Interpreter assets; zero because the compiled profile embeds none |
| source_map_bytes | Maps, including any embedded original sources |
| notice_bytes | Compiler provenance and retained original license notices |
| assembly_module_bytes | Generated UI launcher and service worker |
| data_metadata_bytes | HTML/UI data, configuration, manifest, icon and compiler metadata |
| receipt_bytes | The complete application receipt |
| complete_payload_bytes | Sum of physical buckets, including receipt; excludes the separate input metric |

The script verifies every builder-selected file against its receipt, rejects
extra/missing files and checks that physical counts agree. Each report file record
includes its hash, size, bucket and independent gzip size. Gzip-file transfer
bytes sum level-9, mtime-zero streams; they estimate compressed asset transfer
and exclude HTTP/TLS framing, duplicate fetches and server encoding policy. The
separate canonical USTAR+gzip archive includes headers/padding. Its compressed
bytes are not interchangeable with independently compressed HTTP assets. The
zlib version is retained for exact reproduction.

Omitting maps removes map files and associated receipt/precache records. It does
not hide executable code. The full builder option first validates the declared
mapped input and then recompiles without maps, so its measured build time is not
a shortcut that assumes map omission must build faster.

## Startup and memory observations

Five is the default sample count; 3–31 samples are accepted. Build observations
warm compiler imports/the Unicode repr table and time source verification,
compilation, manifest/receipt construction and publication into a new directory.
Input preparation and Python process startup are excluded. Repeated application
builds must have identical receipts and bytes.

Cold samples create a fresh browser context for each navigation. A page observer
records performance.now when the actual UI first says Ready (subscriptions
installed) and when offline installation completes. The three computations then
run through the real Run button and result DOM. Per-result time starts when the
input is set/clicked and ends at the expected observed output. Browser process,
OS caches, CPU frequency and background activity remain shared/uncontrolled.

Warm samples use one installed context, an untimed warm-up and same-version
service-worker-controlled reloads. They retain HTTP/storage caches. Offline
reload plus the complete workload is checked separately. The observer instruments
the page without editing any hashed application asset. There is no retry or
replacement of a failed computation with a reference result.

Worker memory uses separate fresh contexts. At Ready and after the observed
workload, CDP forces a V8 GC and reads the dedicated worker selected by URL and
browser-context identity. Used/total V8 heap, embedder heap and backing storage
are bytes. These observations do not assert transport quiescence. They exclude
page/service-worker/CacheStorage allocations, process RSS, peak memory and
native/code allocations outside Runtime.getHeapUsage. A low worker heap value
cannot establish low total browser memory. The raw samples retain both states;
no physical memory limit or universal improvement is inferred.

CI runs the current browser/package/reference gates and retains its new reports.
The checked-in observations below describe one host/tool run, with source/script
hashes identifying the pre-commit collection inputs. Reproduction generates new
timing/heap samples; deterministic application bytes can be checked exactly.

## Recorded observations

[The 2026-10-20 application report](measurements/2026-10-20-applications.json)
records CPython 3.14.7, Chromium 156.0.8078.4 and five samples per condition on one
Darwin arm64 host. The compiler component evidence is retained separately in
[Python-JavaScript](https://github.com/outside-labs/Python-JavaScript/blob/804a70fa37ef4ca126519c7222d1862966a63d0c/docs/measurements/2026-10-20-compiler.json).
The compared PWAs each select 757 input-source bytes, including the same
581-byte computation. No source-reduction statistic is used as an interpreter
startup or memory result.

| Profile | Complete payload B | Per-file gzip B | Gzip archive B | Cold Ready ms | Installed warm Ready ms | Post-workload worker used heap B |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| compiled-maps | 94,594 | 30,526 | 27,150 | 38.000 | 21.100 | 444,464 |
| compiled-no-maps | 92,135 | 29,552 | 26,452 | 38.200 | 21.500 | 444,400 |

In this fixture, map omission removes 2,459 complete payload bytes, including
1,379 map bytes and related metadata/precache entries. Both variants preserve
the same outputs. These observations establish their measured payload costs,
not general speed/memory gains or superiority to unmeasured interpreter profiles.
