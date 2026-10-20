# Browser host protocol 1

HOST-01 adopts this contract for future compiled applications and our independent
interpreter. It specifies an adapter, not an implemented browser engine. Released
MicroPython schema-1 applications retain their existing console messages.
Profile/engine identities remain independent of this protocol and of each other.

## Placement and capabilities

The main thread owns the DOM, events, network/storage adapters and worker lifetime.
The worker owns language execution and its Python objects. All host calls are
asynchronous. A compiler must adopt its async adapter before lowering a Python
host call; receiving a JavaScript Promise does not implement Python await.

An application manifest declares required capability/version pairs. A trusted
host configuration grants a subset with explicit named controls, URLs, virtual
file paths, storage namespace and limits. Source code cannot widen those grants.
Initialization fails for a missing/unknown required capability. Optional
capabilities return UNAVAILABLE when absent; they never cause engine fallback.

| Capability | Operations and initial scope |
| --- | --- |
| output/1 | `output.write` appends a text value to stdout/stderr as a DOM text node. Ordered per stream; no HTML interpretation. |
| dom-text/1 | `dom.read` / `dom.write` read or replace text/value on a named granted control. No selectors, innerHTML, arbitrary properties or script URLs. |
| dom-events/1 | `events.subscribe` / `events.unsubscribe` manage a named control's granted event (initially click). Events carry a callback handle, subscription handle and an optional text snapshot. No raw Event/Node object crosses the boundary. |
| fetch/1 | `fetch.text` issues an allowed GET/POST and returns status, final URL and text. Initially explicit HTTP(S) URL grants, credentials omitted, redirects rejected, bounded UTF-8 text body/response and permitted Accept/Content-Type headers only. |
| files/1 | `files.read` / `files.write` use normalized relative virtual paths under a granted application root. Initial resources may be read-only UTF-8 files; writes need a separate grant. No host filesystem, traversal or symlinks. |
| persistence/1 | `persistence.get` / `persistence.set` / `persistence.delete` store bounded text by a granted key in an explicit app/storage-version namespace. Missing keys return None. Storage quota/eviction failures remain visible. |
| handles/1 | `handles.release` releases owned adapter resources. Mandatory whenever a capability returns handles. |

The text_metrics fixture requires only output/1, dom-text/1, dom-events/1 and
handles/1. Fetch, files and persistence are separately requested optional adapters;
the first UI does not need networking. Budgets are explicit in init: maximum
message bytes/depth, pending requests, subscriptions, output characters, text
response bytes and operation deadline. Initial adapter defaults are 1 MiB/message,
depth 64, 32 pending requests, 32 subscriptions, 64 Ki code points/output stream,
1 MiB/text response and 10 seconds/operation. Implementations may grant smaller
limits, must report actual limits, and must reject oversized input before work.

Request arguments are plain records with the following exact initial fields.
Text/content/key fields carry tagged str values; control, path, method, URL and
stream are bounded metadata strings. No operation accepts additional properties.

| Operation | Arguments | Result value |
| --- | --- | --- |
| output.write | stream (stdout/stderr), text | None |
| dom.read / dom.write | control; write also has text | str / None |
| events.subscribe | control, event (click), callback (worker callback handle) | main-owned event.subscription handle |
| events.unsubscribe | subscription (main subscription handle) | None |
| fetch.text | url, method; optional body (str) and headers (permitted metadata string pairs) | Ordered dict with str keys status (int), url (str), text (str) |
| files.read / files.write | path; write also has text | str / None |
| persistence.get / persistence.set / persistence.delete | key; set also has text | str or None / None / None |
| handles.release | handles (bounded array of granted resource handles) | None |

## Envelope and lifecycle

Every structured-clone message is a plain record with
`protocol: "pocket-python-host"`, `version: 1`, `session`, `seq` and `kind`.
The host creates a fresh unpredictable 128-bit session identifier (32 lowercase
hex digits) per worker. `seq` starts at 1 independently in each direction and
increases by one; it is a safe integer at most 2**31-1. Restart before exhaustion.
Only messages from that dedicated worker are accepted. Stale sessions are
discarded without changing active counters or calling callbacks.

Init's `application` record carries manifest_sha256, profile, profile_version,
entrypoint and engine (null for a compiled module, otherwise exact
implementation/version/backend). `capabilities` is an array of grant records
with an id such as dom-text/1 and only that capability's named controls/events,
URLs, paths or storage namespace. `limits` uses the field names in the versioned
initialization example. Ready echoes application, accepted capability IDs and
the effective limits. Identities must match the verified application manifest;
claims in a ready message do not verify executable code or asset hashes.

| Kind | Additional fields and rule |
| --- | --- |
| init | Host's first message: exact application/profile/engine identities, verified entrypoint identity, granted capabilities and limits. No ambient source imports. |
| ready | Worker's first reply: accepted identities/capabilities/limits. Sent only after validation and initialization. No requests before ready. |
| request | `id`, `operation`, `arguments`, `timeout_ms`. ID is `hN` from host or `wN` from worker, increasing and never reused in a session; N is 1–2**31-1. Named arguments follow the capability's schema. |
| result | `reply_to` and exactly one of `value` or `error`. May arrive out of request order. Exactly one terminal result per admitted request. |
| event | `subscription`, `callback`, `value`. The subscription and callback must both be live in this session. Delivery is ordered; exceeding the bounded event queue is an explicit event-overflow error. |
| cancel | `reply_to` identifies a pending request. Receiver aborts its work and resolves CANCELLED once. A completed-request race is ignored; cancellation cannot retract committed side effects. |
| close | Reason `stop`, `restart`, `completed` or `error`. Enter closing state; reject new work and discard callbacks. |
| closed | Cooperative teardown acknowledgement. Host teardown and worker termination do not depend on receiving it. |
| fatal | A bounded structured protocol/initialization error; teardown follows. No further application messages. |

Lifecycle is created → initializing → ready → closing → closed. A malformed
active-session envelope, sequence, duplicate/unknown reply or required operation
is a protocol error and closes the session. A valid denied capability, bad
argument or failed I/O returns a structured result error without closing it.
The receiver clamps a request's positive timeout to its granted deadline and
aborts on expiry with TIMEOUT. Pending IDs remain bounded and retained until
their terminal result; cancellation does not permit premature ID reuse.

DOM handlers and output remain responsive because computation stays in a worker.
Stop aborts pending main-thread operations, removes listeners, releases handles,
rejects pending promises and terminates the worker. Restart creates a new worker
and session; no callback, handle, output or stale result is forwarded to it.
Persistent app data survives only under its explicit storage namespace. Repeated
stop/restart must return listeners and handle tables to their baseline counts.
A busy synchronous VM may require immediate worker termination; cooperative
message cancellation requires the later scheduling implementation.

## Serialized values

Envelope metadata and argument names use ordinary JSON-compatible scalar strings
and bounded integers. Python values use the following tagged, acyclic by-value
forms. Unknown tags, invalid numeric encodings, excessive depth/size and malformed
dictionary entries fail with BAD_VALUE. No implicit coercion loses type data.

| Value | Encoding |
| --- | --- |
| None | `{"type":"none"}` |
| bool | `{"type":"bool","value":false}` |
| int | `{"type":"int","value":"9007199254740993"}`; canonical signed decimal, no leading zeros or negative zero |
| float | `{"type":"float","bits":"8000000000000000"}`; 16 lowercase hex digits, IEEE-754 binary64 big-endian bits, including signed zero, infinities and NaNs |
| str | `{"type":"str","codepoints":[65,128512,101,769]}`; integers 0–0x10ffff, including deliberately preserved lone surrogates |
| tuple/list | `{"type":"tuple","items":[...]}` or type list; recursive tagged values |
| dict | `{"type":"dict","entries":[[key,value],...]}`; ordered entries, with hash/equality and invalid keys checked by the language engine |
| handle | `{"type":"handle","owner":"main","kind":"dom.node","id":"m1"}`; or worker-owned callback handle; opaque, session-bound, never a raw host object |

By-value containers carry neither aliases nor language identity. Cycles and
alias-sensitive objects require a separately adopted handle API; they cannot be
silently flattened. Python str code-point arrays distinguish an astral character
from two explicit surrogate characters. The DOM adapter projects those points
to UTF-16 for display; a subsequent DOM read uses Unicode code-point iteration
and may combine a surrogate pair. This explicit UI conversion does not alter
the engine's stored Python str. Error metadata shown to users is text, never HTML.

Resource handles are created by their owner, have monotonically unique IDs and
are accepted only for their declared session, kind, capability and operation.
The receiver holds a reference, not authority to arbitrary host properties.
Subscription creation retains the worker callback until unsubscribe/teardown.
Unsubscribe releases the listener and its callback reference; repeated release
is idempotent, but use after release returns STALE_HANDLE. Closing invalidates
every handle. An event already queued for a released subscription is discarded.
VM object identity, garbage collection and host-handle roots need INT-05 evidence.

## Errors and the acceptance UI

Errors have `domain` (protocol/host/runtime), stable `code`, `type`, `message`,
optional `location: {filename,line,column,end_line,end_column}` and bounded
`frames`. Initial host codes are BAD_VALUE, DENIED, UNAVAILABLE, TIMEOUT,
CANCELLED, STALE_HANDLE, NOT_FOUND, QUOTA and IO; protocol failures use PROTOCOL.
Runtime types retain the engine's Python exception name and original source
location. Stacks expose only recorded application source identities, never host
credentials or adapter internals. Engines do not reconstruct exceptions by eval.

The text_metrics host defines controls `input` (textarea), `run` (button),
`result` (text output) and `stop` (button). After ready, worker initialization
registers one run callback. A click supplies the input's text snapshot. Shared
Python computation returns character/word/line counts; the worker requests a
plain-text result write. Empty input and astral/combining characters use the
shared corpus. Invalid arguments show the source-located error; output is bounded.
The host owns stop/restart controls even while computation is busy.

The versioned examples in tests/fixtures/host/protocol.json illustrate envelope,
integer/Unicode/float preservation, cancellation and teardown. WEB-03 and the
compiler browser adapter must prove actual UI output, denied capabilities,
deadline races, stale messages/handles, listener cleanup and offline restart.
INT-WEB-01 additionally proves newly entered source with our independent parser.

HTTPS/localhost and a complete cached asset set are required for offline reload.
Network adapters can fail offline without affecting local computation. A worker
and capability table are an application boundary, not a security sandbox for
arbitrary same-origin code. Browser origin permissions still apply: unrelated
private data must use a separate origin and must never be included in client
allowlists. No adapter provides ambient cookies, OS access, dynamic imports or
generic host eval.
