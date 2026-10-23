# Python 3.14 maintenance audit

INT-VERSION-01A, for [#122](https://github.com/outside-labs/pocket-python/issues/122)
in [Pocket Python](https://github.com/orgs/outside-labs/projects/13).
Reviewed 2026-10-23 against engine source commit
`266c4fcc94773f2bae180d026d374bb035729d33`.

## Release and oracle identities

The [documentation index](https://docs.python.org/3.14/) identified itself as
**3.14.9**, last updated 2026-10-23 10:04 UTC. The maintenance interval is
therefore **3.14.7 → 3.14.8 → 3.14.9**, not a new minor language version.
The project semantic oracle remains **CPython 3.14.7 / Unicode 16.0.0**.

| Release | Official release date | Annotated tag object | Peeled source commit |
| --- | --- | --- | --- |
| [3.14.7](https://www.python.org/downloads/release/python-3147/) | 2026-08-05 | `dccefbc14adf6cd13693f3b6b2802945c4e23e01` | `823f0323ee6ec1402088b73bce1a38473cac36dc` |
| [3.14.8](https://www.python.org/downloads/release/python-3148/) | 2026-09-30 | `992560c2cc62d47b308cec662feb485456847931` | `8e6e75d9102e39bed2a2b279203a396741180f12` |
| [3.14.9](https://www.python.org/downloads/release/python-3149/) | 2026-10-21 | `17acf00d155cb8536eca1c3af3a8404db648e37f` | `ead82c07db1f111d613926ed1b6667411d768125` |

These identities were checked with `git ls-remote` against
`https://github.com/python/cpython.git`, including the `^{}` tag dereferences,
and each commit's `Include/patchlevel.h`. This establishes source identity;
it is not a signature-verification claim. [sources.json](sources.json) records
immutable source URLs and SHA-256 digests. Its two NEWS files delimit the
interval independently of the moving documentation site.

The installed reference is CPython 3.14.7. No installed 3.14.8 or 3.14.9
interpreter was found. Newer expected outcomes below are **source-backed
expectations**, not independently executed observations. No new interpreter,
runtime dependency, oracle upgrade or profile change is part of this audit.

## Review coverage

The complete release NEWS files were used to triage the interval. Counts are
NEWS entries, not commits, distinct bugs, or supported features. An issue can
occur in multiple entries. Section labels are upstream classifications;
security entries can affect builtins or libraries.

| Upstream section | 3.14.8 | 3.14.9 | Treatment |
| --- | ---: | ---: | --- |
| Core and Builtins | 26 | 24 | Separate observable behavior from implementation fixes below. |
| Security | 9 | 5 | Formatting and Unicode candidates below; other changes belong to libraries, packaging or host integrations. |
| Library | 85 | 56 | Separate library contracts; no implicit engine library admission. |
| Documentation | 1 | 1 | EPUB navigation and the array `w` docstring; neither changes language semantics. |
| Tests | 4 | 4 | Upstream test infrastructure only. |
| Build | 7 | 3 | Build configuration and identity details; no engine language change. |
| Windows / macOS | 5 / 1 | 3 / 1 | Platform integration, encodings and handles, outside this engine. |
| IDLE / Tools and Demos | 30 / 3 | 1 / 0 | Editor and tooling changes, outside source profiles. |
| C API | 3 | 6 | Native ABI, allocation and writer fixes; no native ABI claim. |

## Observable candidates and bounded coverage

The applicability column is an audit decision about this independent engine,
not a statement that every CPython fix should be copied. Existing
[source](../interpreter-source.md), [numeric](../interpreter-numeric.md),
[iteration](../interpreter-iteration.md), and
[formatting](../interpreter-formatting.md) contracts remain authoritative.

| Category / first release | Affected APIs and upstream evidence | Applicability and executable scope |
| --- | --- | --- |
| Builtin / 3.14.8 | [gh-158254](https://github.com/python/cpython/issues/158254): reverse dictionary and view iterators detect changed keys. | Future reverse traversal contract. A small clear/refill case can record 3.14.7 behavior and the later expected `RuntimeError`. Forward traversal is a separate control. |
| Language / 3.14.8 | [gh-154719](https://github.com/python/cpython/issues/154719): template interpolation expression text preserves trailing whitespace. | Template strings remain outside both source profiles. Small ordinary and debug interpolation cases record the delta without claiming parser support. |
| Diagnostics / 3.14.8 | [gh-156894](https://github.com/python/cpython/issues/156894), [gh-157378](https://github.com/python/cpython/issues/157378): non-ASCII source error ranges and invalid-encoding offsets. | Unicode text and byte-source diagnostics are distinct. Record a bounded text-error case; byte decoding is outside the Unicode-string input boundary. Exact CPython diagnostic offsets are not an adopted engine contract. |
| Diagnostics / 3.14.8 | [gh-151464](https://github.com/python/cpython/issues/151464): obsolete `<>` tokenization and suggested replacement. | Record rejection and reference diagnostic text. Engine rejection is not Python syntax compatibility or agreement on suggestion wording. |
| Language limit / 3.14.8 | [gh-156091](https://github.com/python/cpython/issues/156091): nested comprehensions stop at the compiler block limit. | Comprehensions remain unsupported. Do not stress or crash the pinned compiler to reproduce its old defect. |
| Builtin / 3.14.8 | [gh-155526](https://github.com/python/cpython/issues/155526): complex `abs` can depend on stale C `errno`. | Complex recovery is outside the adopted numeric surface. An ordinary NaN case cannot verify the stale-`errno` fix. Record the gap without injecting native state. |
| Builtin / 3.14.8 | [gh-158446](https://github.com/python/cpython/issues/158446): float/complex formatting rejects precision near `INT_MAX`. | Relevant to future float formatting and quotas. Do not execute the vulnerable precision on 3.14.7. Small precision is a control only; it does not validate the fix or authorize enormous output. |
| Builtin / 3.14.9 | [gh-159739](https://github.com/python/cpython/issues/159739): dynamic percent-format width overflow. | Percent formatting is a separate unsupported surface. No huge width allocation in this audit; record a decision for future format limits and error semantics. |
| Builtin / 3.14.9 | [gh-159430](https://github.com/python/cpython/issues/159430): errors resolving `__bytes__` propagate from bytes percent formatting. | A bounded descriptor case distinguishes the old exception from the expected later exception. Bytes and buffers remain unsupported; this does not generalize to adopted numeric callbacks. |
| Builtin / 3.14.9 | [gh-158583](https://github.com/python/cpython/issues/158583): from-hex buffer bounds. | Bytes/bytearray and host buffers need independent ownership and admission. No native invalid-memory probes. |
| Library + Unicode / 3.14.8 | [gh-155292](https://github.com/python/cpython/issues/155292): StringPrep and IDNA use RFC 3454-era attributes. | `stringprep` and `encodings.idna` are separate library/codec contracts. A small U+1E9E mapping case is useful oracle evidence. It does not change identifier, numeric digit, repr or normalization tables. |
| Library + Unicode / 3.14.8 | [gh-152204](https://github.com/python/cpython/issues/152204): pure Python ISO-date parsing enforces ASCII fields. | The pure Python fallback must be tested separately from the C datetime implementation. No datetime admission or generic Unicode-digit rule follows. |
| Library + Unicode / 3.14.9 | [gh-159739](https://github.com/python/cpython/issues/159739): normalization allocation failure and truncated encoding names. | Allocation/buffer defects, not new Unicode classification rules. No memory-failure injection or C codec implementation is included. |
| Implementation / 3.14.9 | [gh-158592](https://github.com/python/cpython/issues/158592): list deletion/shrink allocation policy. | Ordinary list deletion and alias behavior are useful unchanged controls in both profiles. CPython array capacity is not part of the engine's memory model. |

The remaining library entries concern modules such as asyncio, SSL, archives,
XML, io, debuggers, email, hashing and operating-system adapters. They require
their own module, capability and resource contracts. Neither a source import
refusal nor a successful CPython program establishes engine library support.
The 3.14.9 bundled-pip/certificate change is packaging security, not a new
language baseline. Host trust-store management is outside this audit.

## Implementation-only exclusions

Other core entries address free-threaded reference counts, GC bookkeeping,
weak references, startup and shutdown, tracers, specialization, stack usage,
allocation failure, CPython AST input, annotations or exception groups. These
do not establish adopted engine behavior. In particular:

- CPython AST object validation is separate from independently compiling source.
- Tokenization speed and constant folding are implementation choices; no
  benchmark or bytecode equivalence is claimed.
- Reentrant bytearray buffer acquisition, native aliases and C API ownership
  need a separate bytes/buffer track.
- CPython annotation/generic-class and exception-group fixes do not admit those
  features into `classes-source/1`.
- This engine's logical teardown must be measured through its own session
  counters. CPython reference counting and JS garbage collection are different
  measurements.

## Unicode and later minors

The `unicodedata_db.h` files at all three peeled release commits have the same
SHA-256 digest and declare **16.0.0**; see [sources.json](sources.json). This
verifies that database file, not every Unicode algorithm or library. The
StringPrep correction demonstrates why a stable database version alone does
not establish semantic equivalence. Keep Unicode 16 identifiers, normalization,
numeric conversion and repr decisions separate from RFC 3454's Unicode 3.2
library rules. Do not regenerate tables as part of this audit.

Python 3.15 and later minors are outside this interval. Any adoption needs an
explicit syntax, behavior, Unicode, library and profile review with a matching
reference environment. The presence of newer documentation is insufficient.

## Decisions and evidence still required

1. Preserve CPython 3.14.7, Unicode 16.0.0, `core-source/1` and
   `classes-source/1`. This audit proposes no compatibility upgrade.
2. Record bounded synthetic reference programs with explicit later expectations.
   Keep expected differences separate from independently verified results.
3. Run those programs through the existing Node and Chromium source entry
   points. Report supported behavior, diagnostic differences, explicit refusals,
   unexecuted cases and teardown separately.
4. A future oracle upgrade requires an available, authorized later interpreter,
   differential execution and decisions for changed observable semantics.
   Hazardous native/allocation reproductions stay unverified here.
5. #122 remains open during this batch. Final queue status and integration
   belong to the integrating workstream; this document does not change them.
