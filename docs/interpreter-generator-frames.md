# Generator and frame reflection

Current scope and boundary owners are consolidated in the
[O95 reconciliation](interpreter-object-scope.md). Earlier delivery counts and
remaining-work statements below describe their recorded checkpoint.

O74 of #123 adopts generator state and a finite owned source-frame interface in
classes-source/1. Reading metadata never resumes a generator. Existing generator
execution protocols remain with #120.

| Generator field | Contract |
| --- | --- |
| `gi_code` | Stable verified code selected when the generator was created, including after function-code replacement and generator closure. |
| `gi_frame` | Stable owned frame while created/running/suspended; None after closure. Created frames expose bound arguments without entering the body. |
| `gi_running`, `gi_suspended` | Actual executing and yielded states; both false when created or closed. |
| `gi_yieldfrom` | Current acquired delegate or None, cleared on completion/close. |
| `__name__`, `__qualname__` | Creation-time function metadata; independently writable strings, with native replacement/deletion validation. |

Frames expose read-only `f_code`, `f_back`, `f_globals`, `f_builtins` and
`f_locals`, plus current original-source `f_lineno` and inactive `f_trace=None`.
Code/globals/builtins retain their actual owners and aliases. Back links preserve
visible source callers; generator links detach during suspension/closure.
Retained caller frames keep their defined locals after return. Inlined list,
dictionary and set comprehensions share their containing source-frame identity;
frame locals expose active target cells and restore enclosing bindings afterward.
Class/module comprehensions expose their temporary optimized namespace while
active, then return to their actual unoptimized namespace dictionary.

## Optimized frame locals

Every optimized `f_locals` read returns a fresh FrameLocalsProxy over the same
actual frame. Proxies for one frame compare equal; different frames compare
unequal independently of their values. Dictionary comparisons use a fresh owned
snapshot. Native hash attempts raise TypeError.

Item writes update actual locals, captured cells and nonlocal bindings. Unknown
keys enter a shared extra-locals dictionary, including non-string keys. Deleting
or popping a declared local raises ValueError even while unbound; extras support
ordinary deletion/pop. Empty local reads fall through to extras, then KeyError.
Known local names retain priority over equal extra keys. Hash/equality callbacks,
mutation, error timing and effects execute through the existing owned protocols.

`keys`, `values` and `items` return fresh lists in native local/free/extra order;
iteration snapshots keys and reversed() returns the native reversed key list.
Length counts visible bound entries and extras without invoking key callbacks.
`copy` and dict(proxy) collect keys then perform owned reads/inserts. `get`,
`setdefault`, `pop`, dictionary/proxy union and reflected/in-place union use the
pinned interfaces. `update` accepts exactly one positional dictionary or another
FrameLocalsProxy. Unsupported input forms raise TypeError before user lookup.
Updates read each source value after obtaining its key, preserving partial effects.
The pinned native update-error TypeError replacement and in-place-union
SystemError/context behavior are covered explicitly. This introduces the existing
plain SystemError native layout without adopting broader exception construction.

Extra keys participate in later locals()/vars() snapshots and no-argument dir().
Captured cell writes and comprehension target writes remain live. Retained
proxies release obsolete comprehension cells when scope visibility changes.
FrameLocalsProxy(frame) validates its actual frame receiver; an unoptimized
frame's explicit proxy covers temporary fast/extra storage, while its f_locals
attribute returns the real module/class dictionary.

Frame values retain cells, source/code/namespaces and their explicit back link.
On leaving an activation, reflection keeps a small metadata snapshot instead of
private execution stacks/continuations. Abandoning an active generator closes
its reflected state without resuming user cleanup. Retained local cells remain
owned; collection, cancellation and session close release all logical owners.

`execution-accounting/11` charges frame records (128 bytes plus eight per local,
free and optional dictionary edge), proxies (48 bytes), cached name records
(eight plus 32/two-per-character entries), dictionaries and optional generator
name/frame edges. Class code also records its original definition line. All eight
composed work/instruction observations remain unchanged; prior storage records
remain in `accounting_10_cases`.

Frame tracing, jumping, backend instruction positions, frame clearing and other
unadopted native frame APIs remain outside this finite interface. Traceback
construction remains #124; default directories for the introduced layouts remain
O78. The 51-case `generator-frames.json` corpus runs through six source drivers
and installed offline acceptance. Units add foreign-owner/allocation rejection,
parked callbacks, retained-frame cancellation and hard-limit teardown.

Pinned references: [frame and proxy implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/frameobject.c),
[generator implementation](https://github.com/python/cpython/blob/v3.14.7/Objects/genobject.c),
and [PEP 667](https://peps.python.org/pep-0667/).
