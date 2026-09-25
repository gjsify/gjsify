<!-- Authored Open-TODO sections — area: @gjsify/node-gi.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### node-gi invalidates a handle `gtk_window_destroy()` drops, where gjs keeps the object

MEASURED on this machine (gjs 1.88.1 / node 24.19.0 / GTK 4.22.4), the same corpus on
both legs of `@gjsify/gtk-host` (ADR 0030), which is what made it attributable:

    const w = new Gtk.Window();
    w.present();
    w.destroy();
    w.get_visible();     // gjs: false        node-gi: TypeError: invalid GObject handle

`gtk_window_destroy()` drops the reference GTK holds on a toplevel. On gjs the JS
wrapper still holds one, so the object goes on living at rc=1 and answers every
accessor — measured, a second `destroy()` on it is silent too. On node-gi the handle
is gone with GTK's reference and the proxy raises from `gi.js`'s accessor path
(`Proxy.get_parent`, `gi.js:1470`).

It surfaced through ADR 0054's toplevel placement, where seven vectors were green on
gjs and red on node — and the first six were OUR defect, not this one: `destroy()`
retracted a toplevel a second time after `remove()` had already run the declared
`destroy`, which gjs swallows. That is fixed (the retraction has one owner now). The
seventh vector was reading a property back off a destroyed window, and it is written
against the EFFECT instead — `unmap` fires once, measured on both.

What is undecided is whose defect the divergence is. A JS variable naming a GObject
keeping that object alive is what gjs does and what a caller expects; node-gi's model
may be deliberate for objects whose lifetime GTK owns. Deciding it means reading
`node_gi.node`'s reference handling for a `GtkWindow`, not patching a call site. Until
then the rule for host code is the one that repaired the six: **a retraction has one
owner, and nothing reads a widget after it.**


### node-gi: two callable shapes diverge from gjs in calling convention, and their arity with it

Found by the `callable-arity` conformance probe while closing the gtk-host node
leg (which is now green, 1934/1934 on both runtimes, and CI-wired — see
node-gi.yml's `gtk-host-node` job). A materialized method's `Function.length`
is derived from the SAME skip pre-scan the invoke loop consumes JS args with,
so where the length diverges from gjs, the CALL SHAPE diverges — the length is
the messenger, not the defect:

- **`Gio.InputStream.read`** — a variable-length caller-allocates OUT array.
  gjs reports length 2 (you PASS the buffer to fill); node-gi reports 1 and
  cannot take a caller buffer (the caller-alloc path covers fixed-size C
  arrays and structs only, see the "size=0 defers cleanly" branch in
  calls.cc).
- **`Gio.MemoryInputStream.add_data`** — a GDestroyNotify with no closure
  index. gjs reports 1 (the notify is not JS-consumed); node-gi reports 2 and
  consumes a JS function for it.

Both are deliberately NOT pinned by `callable-arity` — pinning the length
without aligning the call shape would make the reported arity lie about the
invoke. Fix the calling convention first; the arity then follows for free from
the shared pre-scan.

Since 0.51 the arity is also ENFORCED (a call with too few arguments throws
gjs's `TypeError` rather than padding with `undefined`), so the second of these
two now has a visible consequence rather than only a wrong length: node-gi
demands 2 for `add_data`, so `add_data(bytes)` — which gjs accepts — is refused
there. It is the same defect from the same line, still fixed by aligning the
calling convention; the refusal is merely no longer silent. `read` diverges the
lenient way (node-gi demands 1, gjs 2) and refuses nothing gjs accepts.

One string/object leniency measured in the same pass and also left open:
node-gi accepts BOTH `null` and `undefined` as a NULL utf8/object IN arg,
while gjs throws `Expected type string … got type undefined` for `undefined`
everywhere and refuses `null` for non-nullable args. Every gtk-host call site
spells `?? null`, so nothing observable rests on it today; tightening it is
regression surface for consumers that pass `undefined` through optional
params, so it needs its own conformance program when it moves.


### node-gi: a declared-but-unimplemented vfunc reads as absent instead of throwing

gjs 1.88.1 THROWS `Virtual function not implemented` at the PROPERTY READ of
`vfunc_notify` on a plain instance whose class declares but does not implement
the slot; node-gi reports the member absent (`undefined`). Making that
faithful means throwing from inside the prototype's materialize trap — a
descriptor read that throws is real regression surface for `in`-checks,
spreads and devtools over every wrapper, in exchange for a corner no consumer
has hit. Recorded rather than fixed, deliberately: the divergence is kept out
of the conformance corpus (nothing pins the current behaviour as correct
either), and the day a consumer needs the throw, the place to add it is the
`vfunc_` branch of `makeClassPrototype`'s `materialize` (gi.js), gated on the
engine addressing the slot.


### node-gi: an interface's vfuncs are not installed from a JS class

`registerClass` installs a `vfunc_*` override only into the CLASS struct of an
ancestor. A class that `Implements: [Gio.ActionGroup]` and defines
`vfunc_query_action` gets the warning "registerClass vfunc 'query_action' not found
on any ancestor" and C never calls it: the interface struct
(`GActionGroupInterface`) is never looked up. gjs fills it in its interface init.
The C→JS half is ready — `CToJsCall` (marshal.cc) already answers class vfuncs and
GI callbacks in gjs's OUT/INOUT shape; what is missing is the lookup in the
implemented interfaces and an ffi closure per slot in the interface init. Found
while fixing the class-vfunc OUT write-back; no consumer has hit it yet.

`CToJsCall` also still refuses two OUT shapes with a TypeError naming the parameter:
an OUT array with a separate LENGTH parameter (the length is a second OUT, and
whether the JS answer carries it is a decision gjs has not made either), and
GList/GSList/GHashTable OUTs.


### node-gi: two `GLib.Error` shapes, and they answer `instanceof` differently

A GError node-gi hands to JS takes one of two shapes, and they are not the same
object. A **thrown** one — a failed sync invoke, via `ThrowGError` → the L1
builder — is the `GLibError` JS class: `instanceof GLib.Error`, `.domain` the
quark NAME string with the number on `.domainQuark` (a divergence gjs does not
have, already documented in `docs/node-gi-gjs-surface.md`). A **marshalled** one
— a GError-typed return or OUT parameter — is a boxed handle over the real
`GError*`: `.domain` the numeric GQuark, as on gjs, but `instanceof GLib.Error`
false, because L1 shadows the introspected `GLib.Error` with the JS class.

What is left open is the IDENTITY, not the marshalling. The hand-back half —
measured while landing #1495 and fixed with it — was a separable defect and had
to be: `GLib.propagate_error(caughtError)` refused with `expected a GLib.Error
for argument 'src', got Object` where gjs accepts, so the direction the OUT half
exists for was closed to exactly the errors an application holds. A GError IN arg
now takes either shape (`CreatedErrors`, marshal.cc), which changes nothing about
what a `catch` sees.

Still divergent: `marshalled instanceof GLib.Error` is false, `.domain` is a
number on one shape and a name string on the other, and `GLib.Error.new_literal`
— the introspected constructor — is hidden by the shadow. Fixing THAT is an L1
identity decision (either the class gains a lazily-built backing GError, or the
shadow goes and `instanceof` + `.matches()` move onto the boxed handle), and both
options change what every existing `catch` sees, so it wants its own conformance
program pinning the two shapes' surfaces before either is picked.


### `@gjsify/node-gi` — an UNANNOTATED pointer array field still marshals EMPTY in silence

The annotated half is CLOSED. `GstMapInfo.data` is `<array length="3" c:type="guint8*">` with field 3 being `size`; `FieldArrayLength()` in `src/marshal.cc` now reads that sibling, and `test/struct-field-array-length.test.mjs` holds it against gjs as the oracle (32 == 32, contents compared, A/B-proved: three of its four cases fail on the previous build).

This entry once opened "a dependency GI cannot express for a struct-field READ". **That was wrong, and it is why the defect lived so long** — the annotation is in the GIR, it survives into the typelib, and the call-argument path in `calls.cc` had been resolving it all along. Only the field reader passed a hard `-1`. Worth keeping as the shape of a mistake: the entry stated an impossibility and then, one sentence later, described the fix for it, and the impossibility is the half people read.

Two cases remain, and the second one bites harder.

**No annotation at all.** `GIArrayToJs` falls through to `length = 0` when the field is neither zero-terminated nor fixed-size, so a pointer array whose length the GIR never states comes back empty and successful — the same silence, one branch over. Prefer failing loudly; the judgement to make first is whether any real GIR field hits it, because a throw on a shape nobody produces is a worse trade than the silence.

**INLINE (by-value) record elements are still unreadable, and the length is now deliberately declined for them.** `ReadCElement` dereferences a `GI_TYPE_TAG_INTERFACE` element as a pointer and `CElementSize` reports `sizeof(gpointer)` instead of the record's size, so resolving a length for such a field walks garbage: `new Pango.GlyphString(); gs.set_size(3); gs.glyphs[0].glyph` SIGSEGVs the process. `ElementsAreReadable()` gates the new path so those fields keep returning empty, and `test/struct-field-array-length.test.mjs` holds the process-survival assertion (it fails with the gate removed).

That is the SAME deferred work `calls.cc` already records at its CALLER_ALLOCATES site — "a struct-by-value element array would need `gi_struct_info_get_size` per element + field-access read-back (a later PR)". One piece of work with two entrances, now both closed to it. Doing it means teaching `CElementSize` the record size for non-pointer interface elements and `ReadCElement` to hand back a borrowing sub-handle at `src` rather than dereferencing it — `refs/gjs/gi/arg.cpp` is the reference. Affected fields include `Pango.GlyphString.glyphs`, `GObject.EnumClass.values`, `Gio.InputMessage.vectors`; `GObject.SignalQuery.param_types` is the adjacent `GI_TYPE_TAG_GTYPE` gap, which `ReadCElement` answers with `undefined`.


### `@gjsify/node-gi` — by-value container elements: the WRITE side is closed, the READ side is not

**CLOSED for the IN path** (#1473 the pointer half, #1482 the by-value half). An IN C
array now carries an enum/flags member and a whole record, so `Gtk.Accessible
.update_property` / `update_state` / `update_relation` answer on a node host — the ARIA
surface a React-Native-vocabulary application reaches through 46 `accessibilityLabel`
sites, previously one caught exception at startup and then nothing for the session.
Measured against every installed typelib, the same refusal had stood in front of **140
IN parameters**, among them `Gio.ActionMap.add_action_entries`, `GObject.Object.newv`,
`Gsk.LinearGradientNode.new`, `Gio.OutputStream.writev`, `HarfBuzz.shape` and
`Graphene.Box.init_from_points`.

**One claim in the previous version of this entry was wrong, and the shape of the
mistake is worth more than the correction.** It read: the enum half "unblocks NO call by
itself — `update_property` needs both arrays". True of `update_property`, and recorded
as a general fact. The scan that produced the 140 also splits them: **34 are enum-only
arrays** (`Gst.Query.set_formatsv`, `GstAudio.audio_channel_positions_to_mask`,
`Atk.StateSet.add_states`, `Flatpak.Installation.list_remotes_by_type`), each of which
the enum half alone would have unblocked. A claim measured on the case under
investigation and written down as the general one — the same failure this file records
elsewhere under other names.

**What still refuses, each measured rather than assumed:**

| shape | why, and what it costs |
|---|---|
| a by-value element being READ BACK (OUT, INOUT, return) | `ReadCElement` dereferences an interface element as a pointer; `CElementSize` answers `sizeof(gpointer)` for it. `ContainerUse::kReadBack` keeps the refusal, and the two reachable OUT shapes measured — `Pango.get_log_attrs` (LogAttr, 64) and `GLib.MainContext.query` (PollFD) — still throw the pre-existing `caller-allocates OUT parameter type is not yet supported`. **This is the remaining work**, and it is the same single root cause the inline-record field path above records and `calls.cc:630` records at its CALLER_ALLOCATES site. |
| a by-value element in a GList/GSList/GHashTable | elements there are POINTER slots filled through `gi_type_info_hash_pointer_from_argument`, which passes a pointer through unchanged — meaningless for a four-byte enum or a twenty-four-byte record. Not measured for those kinds, so not admitted. |
| a by-value RECORD array with `transfer` other than none | the cell is a bitwise copy of a handle's storage, so the callee freeing the elements would free contents the caller's handles still own. No general remedy: an arbitrary record has no copy function. Cost measured: of the 140, **139 are `transfer=none` and exactly one is not** — `Gsf.property_settings_free`, whose whole job is to free what it is given. |

**The trap that shaped the fix, kept because "teach the size function the real size" is
the obvious change and it is the wrong one.** The C-array write loop does
`memcpy(dst, &a, elemSize)` where `a` is a **GIArgument union** — eight bytes. Answering
24 for a by-value `GValue` would make that read sixteen bytes past the union, off the
stack, once per element, while compiling cleanly and printing plausible numbers. So a
record never enters a GIArgument; each is written straight into its cell, and the size
is a consequence of that path rather than a substitute for it. For the same reason
`CElementSize` is untouched: it is also the READ stride, and a right stride in front of
a wrong read is more plausible output with the same defect.

**Ownership is measured, not asserted.** A `GValue` cell is initialised in place — from
a plain JS value (gjs 1.88.1 accepts `update_property([LABEL], ['text'])`) or by
`g_value_copy` from a handle — so each is unset before the buffer is freed. A/B on one
workstation, 4000 calls carrying 20 KiB each: with the unset **0.1 MiB** RSS, with it
compiled out **78.4 MiB**. Every other record is copied from a boxed handle, which is
what gjs requires, so nothing there is ours to free; the type check guarding that copy
is a safety property, because reading `elemSize` bytes out of a smaller record reads
past its end.

**The widening nearly replaced a LOUD REFUSAL with a SILENT NOTHING, which is the more
expensive of the two and the reason this paragraph exists.** Some callees FILL a
by-value GValue array rather than read it — `GObject.Object.getv`,
`Gst.Object.get_g_value_array`, `Gst.ControlBinding.get_g_value_array`. Before the
change those threw; after it they ran and did nothing, leaving the caller with an empty
GValue that looks like a data state rather than a failure.

**No annotation check could have found it.** Measured field by field: `g_object_getv`'s
`values` reports direction=IN, caller-allocates=false, transfer=none — byte for byte
the same metadata as `GLib.parse_debug_string`'s genuinely read-only `keys`. The typelib
does not distinguish "the callee reads this array" from "the callee fills it", so only a
before/after comparison of BEHAVIOUR shows it. The answer is therefore not a predicate
but a write-back: a cell that came from a caller's GValue is copied back into it after
the invoke, with `g_value_copy` rather than a memcpy, because the cell is unset
immediately after and a bitwise copy would leave the caller pointing at a string that
unset frees. gjs has the same gap — `getv` there also reads back `null`, measured on
1.88.1 — so this is a deliberate divergence, and the annotation is recorded in
`status/upstream-patch-candidates.md`.

**One deliberate divergence from gjs.** Two arrays naming ONE length argument are
refused when they disagree. The autofill wrote it once per array, so the last array
silently decided the count the callee read both by. gjs does not check it — measured on
1.88.1, `update_property([LABEL, DESCRIPTION], ['one'])` is accepted and reads out of
bounds.

**Read the suite number as "this run".** node-gi is 612 tests, 597 passing, 13 skipped,
2 failing; the two are `Canvas2DBridge` and `Excalibur.js`, both golden-image, and their
`actual` strings are BYTE-IDENTICAL with the change reverted — same cause, not merely
the same count, which is the check a bare `2 failed` on both sides does not make.


### `@gjsify/node-gi` — `GTK_IS_EVENT_CONTROLLER` assertion failures on the reverse bridge

Running any GTK app through node-gi intermittently produces `Gtk-CRITICAL **: gtk_event_controller_handle_crossing: assertion 'GTK_IS_EVENT_CONTROLLER (controller)' failed` and can take the process down mid-frame. NONDETERMINISTIC, which is the trap: single runs prove nothing in either direction. Measured on the showcase — node 1/6/1 criticals over three consecutive runs, bun likewise, deno clean in the same sample. It is INDEPENDENT of audio (still occurs with audio gated off, and on code predating the GValue marshalling fix). The event controllers are attached by `@gjsify/event-bridge` via `attachEventControllers`, so the likely shape is the JS wrapper for a controller being collected while GTK still holds the C object — a toggle-ref/lifetime question, not a GStreamer one.

**A second measurement, on a different application, names the site — the toggle/teardown drain, reached through the loop bridge.** A React-Native-vocabulary GTK4 application (~30 routes, ~2.3 MB `--app node` bundle) run repeatedly on linux-x64, node 24.19.0, node-gi 0.45.0's published prebuild: **exit 139 / 134 / 0 / 139 over four runs**, i.e. two distinct signals and one clean completion, which is this entry's nondeterminism from a second direction. The `Gtk-CRITICAL` line is one symptom; there is also a bare SIGSEGV with no critical at all, and the core dump's main-thread backtrace carries **no application frame**:

```
g_application_run                          (libgio)
  g_main_context_dispatch_unlocked         (libglib)
    nodegi::uv_source_dispatch             (node_gi.node)   ← libuv pumped FROM GLib
      uv_run                               (node)           ← entered FROM the GLib dispatch
        v8impl::ThreadSafeFunction::AsyncCb (node)
          nodegi::DrainTsfnCb              (node_gi.node)
            g_object_get_qdata             (libgobject)
              g_type_check_instance_is_fundamentally_a  ← SIGSEGV
```

So the pointer the TSFN drain hands `g_object_get_qdata` is not a live GObject. The frame to fix is `RunTeardown` (`src/toggle.cc:278`-`283`; it is `static` and absent from the trace, so it inlined into the drain): it reads `inst->gobject` and skips the qdata call only when the weak-ref net has already nulled it, so the crash is a teardown running against a GObject that is already gone. Worth noting for whoever fixes it, though this crash does not prove it was the route: that read and the write that nulls it (`OnGObjectFinalized`) are BOTH outside `g_queue_mutex`, so a stale non-null pointer is reachable there by construction. That is ADJACENT to this entry's "collected while GTK still holds the C object" hypothesis rather than identical to it: the wrapper was indeed collected, but here the C object did not outlive it. Same toggle-ref/lifetime seam, seen from the other end, and now with a frame to put a fix in. (Read on: the race in that frame was real and is closed — but "a GObject that is already gone" is only half of it, and the wrong half to design against. See § The qdata half is CLOSED.)

**`uv_run` IS nested here, and the route matters more than the fact.** The trace carries TWO `uv_run` frames — #6 and #33, at distinct return addresses — and the path between them is `uv_run` → `uv__run_check` → `node::Environment::CheckImmediate` → JS → `g_application_run` → `g_main_context_dispatch_unlocked` → `uv_source_dispatch` → `uv_run`. That does NOT contradict `g_in_uv_pump` (`src/loop.cc:222`), which makes `uv_source_dispatch` return immediately while set: that guard stops the pump re-entering ITSELF, and the outer `uv_run` here is not inside the pump at all — it is Node's own loop, and the GLib loop was entered from one of its **immediate** callbacks. Which is to say: the nesting arrives through `applicationRunAsync`'s `setImmediate` deferral, so the very mechanism that makes a GTK application measurable on this bridge is also what puts `g_application_run` inside a `uv_run`. Worth stating plainly, because "uv never nests in uv" is true of the guard and false of the process.

What the trace shows beyond that is the DESIGNED POSIX co-pump, and node-gi's own comment states the consequence (`src/toggle.cc:134`-`136`): under a blocking GLib loop the uv_source bridge pumps `uv_run(NOWAIT)`, and Node implements the TSFN over a uv_async, "so that pump dispatches the drain too". GObject teardown — `remove_toggle_ref` → dispose → arbitrary JS — therefore runs NESTED inside `g_main_context_dispatch`, in the middle of GLib's own dispatch sequence, not between iterations.

**Two candidate triggers are RULED OUT, with the control in the row.** Neither a minimal `Adw.Application` draining 3200 promise continuations under `runAsync()` (exit 0) nor one performing 400 rounds of 40 widgets built, handed to an async continuation, removed and dropped — 16 000 widgets, `global.gc()` per round — reproduces it (exit 0). Plain widget churn is not enough.

The tempting explanation — that the probes never entered the TSFN path — is WRONG, and is written down because it is the reasoning the next probe would otherwise inherit. The drain has TWO producers (`src/toggle.cc:145`-`147`): TEARDOWNS, enqueued by the canonical External's own finalizer ON THE JS THREAD (`NodeGiInstanceFinalize`, `toggle.cc:469`, ending in `WakeDrain()`), and TOGGLES, off-thread toggle-notifies marshalled in. The 16 000-widget probe therefore DID reach `DrainTsfnCb` and `RunTeardown`, thousands of times, and survived. What neither probe produced is the off-thread half: `Promise.resolve()` stays on the JS thread, so no foreign-thread toggle-notify ever arrived. A reproduction needs a genuinely cross-thread completion (a GStreamer bus message, a GIO/soup async finish) or an attached event controller, which is what `attachEventControllers` supplies and what both probes lacked.

One caution for whoever measures this next, learned by nearly reporting the opposite: a first probe used **synchronous** `app.run()` and survived 90 seconds, which looked like evidence and was none — the continuations never drained, so the probe never reached the code it was testing. That is the node-gtk #442/#121 nested-microtask-checkpoint caveat which `applicationRunAsync` (`gi.js`) exists to dodge, by deferring the blocking `run()` to a `setImmediate` macrotask OUTSIDE the caller's await scope. `runAsync()` is required for the measurement to mean anything, and the surviving-tick count is the check that it did.

**§ The qdata half is CLOSED — the `Gtk-CRITICAL` half is still unreproduced.**

The named race is real and is closed. `RunTeardown` read `inst->gobject` outside `g_queue_mutex` while `OnGObjectFinalized` nulled it outside the same lock; the read, the qdata detach, the queued-toggle cancel and `g_object_weak_unref` are now all inside it, and only `g_object_remove_toggle_ref` — the one call that re-enters JS — stays outside, so the no-lock-across-dispose invariant `gc-cross-thread`'s progress counter enforces is unchanged. An atomic exchange was rejected on purpose: it removes the data race and keeps the bug, because the reader is still free to act on a pointer the notify is about to invalidate — the mutex is what makes the detach and the read-then-use mutually exclusive. It cannot deadlock against glib, measured on glib 2.88.3 on BOTH notify paths the model now holds the lock across: from inside a weak notify, `g_object_get_qdata`/`set_qdata`, `g_object_weak_unref` and `g_object_add_toggle_ref` all return; from inside a TOGGLE notify — the leg `MakeGObjectHandle`'s locked arming block needs, since a `g_object_unref` under the lock can raise one — the same calls return and the notify even re-enters itself, which a held `G_LOCK` (a plain non-recursive `GMutex`) could not survive. So glib holds no lock across either notify, the lock order is one-directional (`g_queue_mutex` → glib internals, never back), and there is no ABBA edge. The one call under the lock that could in principle reach `dispose` → JS is that `g_object_unref`, and it cannot: `add_toggle_ref` took a ref of its own first, so the count is ≥ 2 going in.

**But the race was the second-order symptom, and what sits under it is measured rather than reasoned: `g_object_run_dispose` notifies every `GWeakNotify` — and clears every `GWeakRef` — on an object that goes on LIVING.** Measured on glib 2.88.3: notify fires, `G_IS_OBJECT` true, refcount 1 afterwards, object still usable. **A caution about how far that reaches, because the first version of this entry overstated it:** `gtk_window_destroy()` is NOT a `run_dispose` caller on GTK 4.22.4 — measured directly in C, no notify fires and the window survives at rc=1, and the source agrees (it hides, releases the application and unrealizes). `run_dispose`-on-widget-destroy was GTK3's `gtk_widget_destroy`. What DOES land here on GTK4 is every `run_dispose()` a JS program makes — the bridge exposes it — and `gtk_native_dialog_destroy()`, whose documentation explicitly promises it keeps the object's references "as opposed to destroying a `GtkWindow`" (measured, GTK 4.22.4: notify fires, dialog alive at rc=1). Narrower than "every GTK app that closes a window", and still the exact shape of this defect: a caller that disposes an object it means to keep. The net read the notify as "C finalized the object", nulled `inst->gobject`, and the teardown then skipped the `g_object_set_qdata(obj, quark, nullptr)` it does under that pointer: **a LIVE GObject was left holding a qdata pointer to the record the teardown went on to `delete`.** Everything after that is this entry's crash class — the next re-wrap reads the freed record's `handle_ref` (`napi_get_reference_value`, SIGSEGV), or the recycled block reaches the drain and `RunTeardown` hands `g_object_get_qdata` its garbage `gobject` field, which is exactly the backtrace above. The detach therefore now happens IN the weak notify: it is the one moment the object pointer is guaranteed addressable, and `g_object_set_qdata` from inside a notify is legal in both the run_dispose and the real-finalize case (measured).

Deterministic reproduction, single-threaded — no race window to hit: push a `Gio.Cancellable` as the thread-local current one (a BORROWED pointer, the only shape whose wrapper stays collectable while C can still hand the object back — the same vehicle #1475 needed), `run_dispose()` it, collect the wrapper, drain the teardown, ask C for it again. **SIGSEGV before the fix, never after** — 10/10 and 9/10 on two independent runs of the standalone probe, 0/10 both times with the fix; the count varies because the crash needs the freed block recycled, which is exactly why no single number belongs in a rule. Landed as `gc-identity` case 4c, red 5/5 against the unfixed engine and green with it. Two witnesses keep it from going green-and-blind: the `WeakRef` proves a collection actually happened (if a future GC stops collecting there, 4c fails instead of passing vacuously), and case 4d proves the VEHICLE still works — a `WeakRef` cannot show that the notify fired, so if glib ever stops notifying on `run_dispose`, 4c would quietly degenerate into 4b while 4d goes red and says so.

**What is NOT claimed.** The original `Gtk-CRITICAL **: gtk_event_controller_handle_crossing` symptom was not reproduced, so it is not proven to be this defect. The probe built with the ingredient the earlier ones lacked — 60 000 real `Gtk.EventController{Motion,Scroll,Key,Focus}`/`GestureClick` attached to widgets and dropped over 300 `runAsync()` rounds with `global.gc()` each, alongside ~38 M genuine off-thread `g_object_ref`/`unref` iterations driving the foreign-thread toggle producer — ran 5/5 clean BEFORE the fix, so it measures nothing about it in either direction. Whoever picks this up next needs a GTK application that reproduces ON DEMAND; widget churn plus off-thread toggles is now also ruled out, with the control in the row.

**Residual — STILL OPEN, and it costs more than one ref.** An object that SURVIVES `run_dispose` keeps a toggle ref this binding can no longer remove: the record's pointer is gone and glib offers no way to learn afterwards that the object lived. Three consequences, all measured on glib 2.88.3, two of them not visible from the leak framing:

* **wrapper identity does not survive a `run_dispose`, and JS instance state goes with it.** The detach severs a LIVE object from its wrapper, so the next hand-back from C builds a NEW one — `Gio.Cancellable.get_current() !== c` right after `c.run_dispose()`, measured through the bridge. That is invariant (a) of the whole toggle bridge. This bullet first reached for `gtk_window_destroy()` as its example, which is the overstatement the paragraph above retracts — measured, it is not a `run_dispose` caller on GTK 4.22.4. The reach is the narrower set named there: any `run_dispose()` a JS program makes, and `gtk_native_dialog_destroy()`, where a dialog handed back by GTK is no longer `===` the wrapper the app holds. The identity loss does not rest on that example — it is measured through `Gio.Cancellable`. On a `registerClass`ed subclass the class link survives (`instanceof` and `constructor.name` resolve by GType) but every JS field does NOT: measured, a field set in the constructor reads `undefined` on the re-wrap, where the same probe against the unfixed engine reads it back. The app's own variable is unaffected — only a hand-back FROM C produces the new wrapper — but that is silent data loss where the old code had none, and it is the half of this residual worth fixing first.
* **the re-wrap installs a SECOND toggle ref, and glib then notifies for neither.** `toggle_refs_notify` delivers only while there is exactly one (`Unexpected number of toggle-refs` at the next 1↔2 crossing, measured in C). So the new wrapper never goes weak: the wrapper AND the GObject are immortal, not just the one ref.
* the old code leaked exactly the same toggle ref — it just kept identity and took a use-after-free with it. Strictly better, not free.

Pinned executable by `gc-identity` case 4d, which asserts the identity loss so it cannot change unnoticed in either direction.

**The shape that retires it** — not built here, because it changes who owns the free, which is the ownership model #1475 settled, and that wants its own PR. The detach exists for ONE reason: the record may be freed while a live object still points at it. So make that impossible instead of severing the link — once the weak net has fired, the record is never freed; it stays as the object's TOMBSTONE (a `weak_fired` flag; `RunTeardown` deletes the napi reference and leaves the record). qdata keeps naming it, so the cached External stays reachable and identity + JS state survive, and the crash is closed just as hard: nothing can read a freed record if none is freed. The tombstone then carries the knowledge the second toggle ref needs — it says "an orphaned toggle ref of ours is on this object", so the re-wrap ADOPTS it (drop the construction ref instead of `g_object_add_toggle_ref`) rather than adding a second, restoring one-toggle-ref-per-object and letting the eventual teardown finally release it. Cost: one leaked ~48-byte record per weak-notified object, which on a real finalize is all that leaks. A second never-cleared qdata sentinel would buy the adoption half alone, without the identity half.

Discriminating on `ref_count` at notify time (2 under `run_dispose`, 1 under finalize — confirmed by an independent C probe) would avoid all three and was deliberately NOT done: it reads an implementation detail of `g_object_unref`'s last-ref ordering, and a rule that clever is one refactor away from being simplified back into the bug.


### `@gjsify/node-gi` — `gc-cross-thread` dies at the cross-env worker roughly 1 run in 10

Written down because the next red CI run will otherwise be blamed on whatever PR is open. Under the FULL parallel `npm run test:gc` — and, less often, with the file alone; see the three-point run below, which overturns the 22/22-clean standalone reading this entry first carried — `test/gc-cross-thread.test.mjs` occasionally reports `✖ … 'test failed'` with **no failing subtest**: the process dies after test 7 (`soak`) and the last three never report — `cross-env: a worker wrapping a singleton the owner cached does not UAF (DEFECT 1)`, `reentrant-drain`, and `liveness`. So the file is lost inside the cross-env WORKER test, and the suite total drops 617 → 615.

Measured on `3356ac7c66`, i.e. BEFORE the weak-net work in that PR: 1 in 12. It is not new, and it is not a toggle-model regression — file-parallel CPU contention is what makes it appear. Whoever picks it up should start from the worker in test 8; artificial load raises the rate, but it is not the ingredient.

**Three points, freshly built, and it reproduces STANDALONE.** Run to answer one question — whether the ownership fix in `503ea7c8e7` introduced this — with the addon rebuilt from scratch at each revision and 20 runs each of `NODE_GI_NATIVE=build node --test --expose-gc test/gc-cross-thread.test.mjs`, the file alone, nothing else running. `test/gc-cross-thread.test.mjs` is byte-identical at all three revisions, so only `src/toggle.cc` differs between them:

| revision | | failures |
|---|---|---|
| `f1034428cd` | `503ea7c8e7^` — before the ownership fix | 3/20 |
| `87c5835f60` | `main` | 2/20 |
| `f51400b68e` | this branch | 3/20 |

Every failure had the shape described above, the one CI reports: `tests 9 / pass 8 / fail 1`, `soak` reported, the last three absent. **8 failures in 60 single-file runs across three independent builds** (20-thread Linux desktop, node 24.19.0), so "never when the file runs alone" describes the host that first measured it rather than the defect.

**The three numbers do not support a ranking, and are recorded with that limit.** At n=20 and a rate near 1 in 8, 2 and 3 are the same measurement; separating even a factor-of-two effect would take roughly 200 runs per point. What they do establish is what was asked: no point is clean, none is dramatically worse — the crash predates the ownership fix, and this branch does not close it either. A number kept without its uncertainty gets read later as precision it never had.

**Possibly a different class from the `worker.terminate()` mid-native-call residual, and deliberately not filed as a correction of it.** Both are nondeterministic crashes around worker teardown, but that one is a SIGSEGV at 12/200 with a named mechanism — a terminate landing while the worker OS thread sits inside a blocking GLib call — while this one loses the file inside the cross-env worker with no failing subtest at all. Nothing measured here shows they are one thing, and merging them on resemblance would cost the next reader both rates.


### `@gjsify/node-gi` — `type_interfaces()` answers nothing, and the host verbs are not OWN

Found by `packages/framework/gtk-host/src/generated.spec.ts`, which holds the generated
method artifact against the running type system. Two questions gjs answers and the bridge
does not, both measured on the `framework suites over the reverse bridge` leg and on the
darwin shipped closure:

**`GObject.type_interfaces()` returns nothing.** Not "fewer" — for every one of the 168
types the spec walks, the list is empty, so the INTERFACE half of the artifact's `ANCESTRY`
cannot be held there. The class half is fine: `type_parent` answers for all of them, and the
spec's own probe prints `named` and `withInterfaces` on every run.

**The GJS host verbs are not on `GObject.Object.prototype` at all.** `connect`,
`connect_after`, `connect_object`, `disconnect`, `emit` and `set` are ABSENT there over the
bridge — not inherited rather than own, which is what a first reading assumed and what cost
a second CI round. The artifact measured the host verbs by SUBTRACTION on the generating
host (everything on the prototype that is not a typelib method of GObject), so the
prototype is what that measurement depended on; the half that survives everywhere is the
claim about the ARTIFACT, that a host verb is not also a typelib method.

Both are scoped with `it.failing(..., { when })` rather than skipped, so each RUNS on every
host, stays strict on gjs, and fails the day the bridge starts answering — the marker
retires itself. Whoever closes either one should expect the corresponding `it.failing` to go
red as a PASS and delete the marker in the same PR.


### `@gjsify/node-gi` — the `$gtype` surface is incomplete

gjs exposes `$gtype` uniformly (`[object GType for 'X']`); node-gi does not. **One of the three shapes this entry listed is now closed, and it closed the opposite way to the fix shape recorded here** — worth keeping rather than deleting, because the recorded fix was measured impossible: `makeEnum` FREEZES its member object, so a lazy getter cannot be attached afterwards at all. The enum GType is therefore resolved and defined EAGERLY, non-enumerable, and simply absent for an enum the typelib does not register (`gi.js`, `Ns.Enum.$gtype`; witnessed by `conformance/golden/class-realization.txt`, `enum $gtype: true`).

Two shapes remain, both measured against gjs on the same source: `GLib.Variant.$gtype` is a static-method THUNK (`$gtype` falls through the struct proxy to method resolution); `String(Gio.Application.$gtype)` throws `Cannot convert object to primitive value` (the GType handle is a bare tagged External). The handle works fine as an ARGUMENT (`GObject.Value.init(GObject.TYPE_STRING)` round-trips), so this is a surface gap, not a marshalling one. Fix shape for what is left: give the struct path the same `$gtype` the class path gets, and give the GType handle a `toString`/`Symbol.toPrimitive` + `.name` so it prints like gjs's GType object. Do NOT reach for a lazy getter on a frozen object again.


### `@gjsify/node-gi` — nothing in CI runs the bridge against MUSL, or against the declared gjs floor

The arch axis is covered: `node-gi.yml`'s `arm64` leg builds the addon on a native `ubuntu-24.04-arm` Fedora 44 container, runs the gjs/node/bun/deno golden-diff plus the tier-B typelib oracle, and re-verifies the STAGED prebuild with `test:bun`+`test:deno`. Two other axes are not, and a 2026-08-03 hand run on a OnePlus 6T / postmarketOS (aarch64) is currently their only evidence:

- **musl.** Every CI image is Fedora/glibc, and the one leg that executes anything on musl does not reach this bridge. `prebuilds.yml`'s `build-prebuilds-musl` (which runs `.github/prebuild-toolchain/musl-build.sh`, including its `dlopen(RTLD_NOW)` assertion, in `alpine:3.24`) is no longer dispatch-only — it runs on every PR and push the workflow's paths reach and can go red — but it builds `@gjsify/sab-native` and `@gjsify/lightningcss-native`, not node-gi, whose addon is published from `napi.yml`/`release.yml` and whose `paths:` are deliberately a different trigger. The COMMITTED bridge prebuilds have left the other half of the hole: `musl-committed-check.sh` was split out of the build leg and now runs on PRs and pushes as `check-committed-musl` (one native runner per arch) and again inside `commit-prebuilds`, over the staged tree. It cannot reach node-gi — this entry's subject commits no binary at all, its addon being published from `napi.yml`/`release.yml` — so for THE BRIDGE nothing still asserts musl loadability on a PR or a merge. That the assertion is `RTLD_NOW` is not incidental and must not be "simplified": measured with `@gjsify/sab-native`'s pre-#955 prebuild on aarch64 musl and in `alpine:3.24` x86-64, a plain/lazy load LOADS the broken library and the two unresolvable symbols (`fcntl64`, `__cmsg_nxthdr`) only surface at the first call — which is why its suite lost exactly two fd-passing tests and `@gjsify/worker_threads` four cross-process tests instead of everything, and GI's own `G_MODULE_BIND_LAZY` is that lazy path. A load-only gate using default flags would have passed that library; `RTLD_NOW` fails it at load. Both arches behave identically here. Wiring options, cheapest first: give `node-gi.yml` an Alpine leg shaped like `build-prebuilds-musl` (one `docker run alpine:3.24` from a glibc runner, so no JavaScript action has to run on musl — the arm64 constraint that shape exists for); add an Alpine leg driving the existing `test:bun` for real execution coverage; and keep the glibc-floor `SHT_GNU_verneed` audit (#963) as the check that needs no musl machine at all — it is what caught this one. Deno cannot participate in a musl leg: it publishes no musl build.
- **gjs 1.86.0, the declared floor.** Fedora 44 ships 1.88.x, so the floor this repo advertises is never exercised. Measured green through `org.gnome.Platform//49` (glibc 2.42, gjs 1.86.0), and it immediately caught a test encoding an unstated GLib ≥ 2.88 assumption (`GLib.Bytes.new_from_bytes` static-vs-instance introspection, fixed in the same change). A flatpak-runtime leg would be the honest gate; the GNOME runtime is a stable, pinnable image.

Also unmeasured on aarch64 specifically, in CI and by hand: the display legs (`gtk-smoke`, `adw-smoke`, `gtk-template*`, `strv-construct`, `interface-props`) and the `--expose-gc` toggle-ref stress leg — `gtk-smoke` is `ubuntu-latest` (x64), and the device is driven over SSH with no display. Note the GTK TYPELIB path itself is fine there: `Gtk`/`Gdk`/`Adw`/`Pango`/`Graphene` all resolve and `Gtk.DrawingArea` subclasses with NO `GI_TYPELIB_PATH`/`LD_LIBRARY_PATH` help, on musl and inside the flatpak — the darwin "Failed to load shared library … referenced by the typelib" class is dyld-specific (no rpath on a plain `node`), not a Linux exposure.


### `@gjsify/node-gi` — the LOW-LEVEL `registerClass` still drops an unresolvable signal param type in silence

The L1 `GObject.registerClass` no longer does: an entry `signalSpecToNative` cannot turn into a type name now THROWS, naming the signal and the index (that silent drop is what made the GJS-canonical `param_types: [GObject.TYPE_INT]` register a zero-param signal and deliver an `undefined` payload). The engine's own loop is the second copy of the same mistake and is still there: `src/class.cc` reads each `paramTypes` entry with `TypeNameToGType(NodeGiToUtf8(...))` and does `if (t != G_TYPE_INVALID && t != G_TYPE_NONE) push_back(t)` — so `registerClass(name, ns, parent, { signals: [{ paramTypes: ['bogus'] }] })` from `@gjsify/node-gi` (the native passthrough, not the L1) still yields a signal with fewer parameters than declared and says nothing. Same for `returnType`. Fix shape: accept a GType HANDLE there too (`ReadGTypeHandle` first, name lookup second — the L1 already round-trips through the name, so this is only about the direct callers) and throw a `Napi::TypeError` naming the signal instead of skipping. Not folded into the L1 fix because it needs a native rebuild, and the host that measured the defect (aarch64 postmarketOS, deliberately node-free) cannot run `node-gyp`.


### GI/GObject runtime for Node (Axis 5) — deferred limitations

`@gjsify/node-gi` graduated Tier 3→2 per ADR 0005 (2026-07-14) — the four gate items landed (teardown crash, vfunc OUT/INOUT, GTK/Cairo layer, second real consumer), the GIMarshallingTests oracle sits at 370 pass / 0 fail, the Excalibur-WebGL and Adwaita-window/storybook GTK capstones render byte-identically to `gjs -m`, and the cross-runtime legs (Bun full core parity, Deno conformance subset) ship from one N-API binary. The step-by-step roadmap provenance lives in git/CHANGELOG. Known gaps left for follow-up PRs (each surfaces a clear error or is benign; none is silently wrong):

- **Cross-runtime consumer survey — prioritized backlog.** `scripts/node-gi-consumer-harness.mjs` generalizes the consumer proof (a package's OWN GJS suite runs `--app node` on node/bun/deno); the `consumer-suites` CI job gates the proof set `sqlite`+`http2`+`zlib` under `--require-pass`. Full survey + gap report: `docs/reports/node-gi-consumer-survey.{md,json}` — 17 packages already run unchanged. Remaining blockers, priority order: **P3** — GLib/GObject marshalling-helper gaps (`ByteArray.fromGBytes`, `GLib.filename_from_uri` undefined; blocks `child_process`/`os`/`module`); **P4** — `normalizeEncoding`/`checkEncoding` unresolved when a polyfill is `--alias`ed onto Node (`crypto`/`string_decoder`). Follow-ups: full 22-package `test:gjs-on-node` rollout + a non-gating full-survey CI job that publishes the table.
- **Bun/Deno conformance is a curated subset, not the full suite.** Excluded from `test:bun`/`test:deno`: the display/GTK tests (CI Xvfb leg), the `--expose-gc` toggle-ref stress leg (Node's GC-safety gate), and the mainloop/runasync/pump uv-integration cases (they assert the Node-only libuv↔GLib bridges; Bun/Deno drive the non-blocking case via `startMainContextPump`, and `async-gio-await` is ledgered for them accordingly).
- **Reverse-bridge polyfill routing over runtime natives** — on Node the global `fetch` stays the NATIVE undici one (the register convention never overrides an existing native), so `@excaliburjs/plugin-tiled`'s fetch-based fileLoader cannot load the root-relative `/res/…` asset paths our GJS fetch/XHR resolve against the program dir. This is what blocks the FULL `excalibur-jelly-jumper` on `gjsify run --runtime node` — everything else boots. Needs an opt-in GJS-parity-globals mode for reverse-bridge builds (route `fetch`/friends to the `@gjsify/*` polyfills over the runtime natives).
- **Gst audio decode/playback on node-gi is PROVEN on node, bun and deno; the residual is the bun/deno pump requirement.** The former nondeterministic decodebin SEGFAULT was the `(transfer full)` GObject IN-arg ownership bug in `marshal.cc`, fixed; measured clean against PipeWire (a real sink-input owned by the runtime pid, 0 crashes/CRITICALs over repeated runs). The harness verdict: node `pass 62/62`, bun/deno `partial 61/62` — the one failure is `onended` not firing in a BARE script, the already-ledgered no-auto-pump property (`ended` rides a `Gst.Bus` watch on the GLib main context; with the context advancing it fires on bun and deno too). Deciding whether `@gjsify/webaudio` should drive the context itself (it cannot import node-gi — ADR 0005 forbids the hard dep) or whether bun/deno should gain node's auto-pump is a separate cut. No CI leg exercises this (needs a sound device); the harness is the reproducible check. Related test-harness fix already landed: `@gjsify/webaudio`'s `test.mts` awaited the spec directly instead of routing through `@gjsify/unit`'s `run()`, so a broken assertion still exited 0 — the same shape is worth checking on any package whose `test.mts` does not call `run()`.
- **`@gjsify/xmlhttprequest` — on DENO every XHR stalls at `readyState 3`, so an asset loader never completes.** Reproduced on the jelly-jumper showcase (`--app node`, `--runtime deno`): all 26 resource requests reach readyState 3 within 10 ms and then NOTHING — no readyState 4, no load/error events, for the whole run. **Bun runs the identical bundle to completion**, so this is deno-specific. Ruled out by measurement (do not re-investigate): GLib sources fire, microtasks drain inside the blocking `Adw.Application.run()`, `Gio.File.load_contents_async` completes, and the two primitives `readFileUrl()` is built from return correct bytes on deno. The stall is inside `send()`'s `Promise.resolve().then(doFetch)` chain and needs instrumentation INSIDE `@gjsify/xmlhttprequest` (its `__GJSIFY_DEBUG_XHR` logs go through `console.log`, which the `--app node` bundle routes somewhere the terminal does not see — fixing that visibility is step one).
- **struct gaps** — struct *construction* (`new Ns.Struct({…})`), array-of-struct-by-value element field reads, and GValue BLOB (byte-array) marshalling (surfaced by the sqlite consumer — a bound `Uint8Array` doesn't persist and a BLOB return comes back as a raw boxed handle).
- **`worker.terminate()` mid-native-call** — the `Error::New` `SIGABRT` funnel is CLOSED (every fallible chain checks the swallowed-failure residue; stress: 0 aborts / 200 terminates on both loop shapes, guarded by `test/worker-terminate.test.mjs`). RESIDUAL: a lower-rate SIGSEGV (12/200 ≈ 6%, identical pre-fix) when the terminate lands while the worker OS thread is inside a blocking GLib C call — the terminating isolate racing an OS thread in native code, with no napi frame; pre-existing, the textbook "terminating a worker mid-native-call is documented-hazardous in Node generally" case. Closing it would need Node/V8 to quiesce in-flight native calls before freeing the worker isolate.


### `logSignals` has no test

The one survivor of the twelve parked test sites `gjsify/todo-needs-anchor`
found on its first run. The other eleven are retired: two `on([])` gates became
`it.failing` (with their reason), four commented-out assertions went live and
three of them promptly failed — see below — two markers named nothing above a
complete statement and were deleted, and the worker-stress one was never a
deferral at all (its sentence says the test CLOSES a todo; `TODO` merely opened
a comment line, and an anchor had been bolted on to satisfy the rule).

**Why this one could not be converted.** `packages/gjs/utils/src/log.spec.ts`
holds a fully commented-out spec for `logSignals`, and `it.failing` is the wrong
tool for it: the spec deliberately produces an UNHANDLED REJECTION
(`createUncaughtException()` called without `await` — that is the event under
test), which is raised outside the callback's promise chain. `it.failing` cannot
catch it, and Node's default handler terminates the process, so reviving it
as-is would make the whole `@gjsify/utils` suite non-deterministic rather than
parking a failure.

What it needs is a test to WRITE, not a marker to convert: install a temporary
rejection handler, assert the signal fired, restore. Until then `describe(
'logSignals')` is an empty suite in the run output, which reads as coverage that
does not exist.

**What the retirement cost, recorded because it is the argument against parking
an assertion in the first place.** Three of the four revived assertions failed
immediately, each on a real defect now fixed at the source: `EventTarget`'s
listener map was TypeScript-`private` (a compile-time marker only, so at runtime
an ordinary ENUMERABLE own property that every subclass leaked into `for…in`,
`Object.keys` and `JSON.stringify`); `AbortSignal.reason` was a public class
field where the platform has a prototype getter, found by the same enumeration
spec one line after the first fix landed; and `AbortController` carried no
`Symbol.toStringTag`, so `String(controller)` said `[object Object]` while its
`AbortSignal` sibling had one all along. Four commented lines had been hiding
three shipped bugs.

