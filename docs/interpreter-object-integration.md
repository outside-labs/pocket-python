# Integrated object acceptance

O96 accepts the finite O-series scope after the
[O95 reconciliation](interpreter-object-scope.md). The source matrix in
`tests/fixtures/interpreter/object-integration.json` composes modules, functions,
classes, slots, native payloads, descriptors and verified dynamic code. It uses
the pinned CPython 3.14.7 oracle and the existing Node/Chromium drain,
instruction-boundary and parked drivers.

The matrix covers prepared metaclasses and descriptor notification inside dynamic
class definitions; granted module/package and relative imports; exact module and
function globals; closure-cell execution; function-code/default replacement;
retained super and mapping proxies after base reassignment; module subtype hooks;
immutable/mutable native payloads with slots and native bypass; suspended frame
locals; property subtypes and wrapper metadata; actual-metaclass matrix and
reflected ternary-power dispatch; custom MRO; compatible class reassignment; and
retained effects/original diagnostics when callbacks or dynamic code fail.
Registry grant denial is tested through Python-visible ImportError handling;
ambient module availability is never a source of authority.

Dedicated units park and collect at every instruction boundary while an imported
module's slotted descriptor runs inside compiled exec. They finish, cancel or
close the same execution owner and require zero logical bytes, objects, roots,
frames and external ownership. Further composed cases verify shared instruction,
work, memory and recursion limits, callback failure and dynamic source locations.
Close and cancellation must not execute more application callbacks.

The installed console accepts fresh composed source and
`examples/interpreter_object_integration.py` after offline reload, preserves
original dynamic error locations, and stops/restarts a dynamic descriptor that
uses the selected operator library. Existing acceptance also verifies package and
asset locks, failed initialization/retry, reduced-profile updates, cache cleanup
and the explicit core/class admission boundary. CI retains all earlier stage
matrices and lifecycle checks; those accepted contracts are not replaced by the
smaller composition matrix.

Run `python scripts/run_tests.py focused --feature object-integration --feature
object-scope`, then the corresponding `browser-conformance --feature
object-integration` selection. Broad PR CI supplies regression and offline-console
coverage. The final acceptance record links those runs and the final-main
wheel/installed-CLI/source-profile startup smoke. Only then may #123 and its
Project item close; #33, #34 and the named neighboring API owners remain separate.
