# Why `set`+`notify` and `emit` were slow on the real-Gio engine (2026-10-15)

[The ADR 0110 gate report](2026-10-15-adr-0110-gates.md) measured the real-Gio engine of
`@gjsify/adwaita-gobject-native` against the pure-JS engine and found two rows far apart:
`set`+`notify` at **44.6x** and `emit` at **24.2x**. This report answers *where that time went*
and what removing the attributable part of it cost. It does not flip the ADR 0110 default and it
does not judge whether any number is acceptable; that is still ADR 0110 step 4.

Same host as the gate report: Intel i9-10900K, Fedora 44, Node v24.19.0, gjs 1.88.1, GLib 2.88.3,
gobject-introspection 1.86.0, `@gjsify/node-gi` against the system GI stack. Same bench body
(`packages/nativescript-bridge/gobject/src/bench.ts`), same subject (a registered class with two
properties and one signal), one process timing both engines.

## The profile first

`node --cpu-prof --cpu-prof-interval=200` over a driver that runs one bench row in isolation
(200 000 `set` ops, 400 000 `emit` ops), flattened to self-time per function. Alongside it, a
direct timing of each native primitive the engine can reach, so the N-API crossing could be priced
separately from the JS above it. `perf` is not installed on this machine, so the native side is
measured by its own entry points rather than sampled.

Native primitives, ns/op, no JS handler connected unless noted:

| primitive | ns/op | with a JS handler connected |
| --- | --- | --- |
| `hasProperty` | 140 | |
| `getProperty` | 445 | |
| `setProperty` (`g_object_set_property`) | 2 709 | 4 845 |
| `callMethod('set_property')` | 8 224 | 14 199 |
| `callMethod('notify')` | 2 034 | |
| `emitSignal` | 658 | 1 076 |
| `hasMethod` | 489 | |
| `getTypeName` | 94 | |

That table is the finding. A `set`+`notify` cost ~22 µs, and the N-API crossing plus the GValue
marshalling plus the callback back into JS — everything that is irreducibly "real GObject" — is
the 4.8 µs `setProperty` row. The rest was **resolution work redone on every call**:

- **`callMethod('set_property')` cost 3x what `setProperty` cost for the same GObject call.** Both
  end in `g_object_set_property`. The difference is the introspection layer in front of it:
  `gi_repository_find_by_gtype` on the instance's GType, then a walk of the type's methods and of
  every interface it implements, then the ffi call. All of it a pure function of (GType, name),
  recomputed per call.
- The engine-JS layer itself was a rounding error. The split of the `set` profile before any
  change: the materialised GI method thunk 45 %, `wrapParamSpec` 11 %, the proxy `get` trap 10 %,
  `findProtoDescriptor` 9 %, GC 3 %, `wrapReturn` 3 %, `findPropertySetter` 3 %. Of the engine's
  own `setValue`, under 1 %.
- The `emit` profile was the same shape: the emit shortcut 50 %, `findProtoDescriptor` 9 %,
  `instanceHasMethod` 8 %, the `get` trap 4 %.

So the cost was **not** where the ADR assumed. It was not the crossing and not the engine; it was
node-gi re-answering per call a question whose answer cannot change.

## What changed

Seven changes, in the order applied. Six are in `@gjsify/node-gi` — the root, where every consumer
pays the same cost — and one is in the engine. `set`+`notify` after each, median ns/op on the
real-Gio leg:

1. **A (GType, name) instance-method cache in `src/calls.cc`.** `CallMethod` and `HasMethod` now
   resolve through `ResolveInstanceMethodCached`, which holds the `GIFunctionInfo*` and lends it
   to callers. Only HITS are cached: a miss may be a typelib that is not loaded yet, so caching it
   would make a later `requireNamespace` invisible. `callMethod('set_property')` 8 224 → 6 973 ns,
   `hasMethod` 489 → 139 ns. Bench: **22 819 → 20 943**.
2. **A `wrapReturn` fast path.** A primitive return value was put through five N-API type-tag
   probes before being handed back; `null` and non-objects now return immediately.
3. **`toKebab` memoized.** A `Map` keyed on the input, instead of two regex rewrites per property
   access.
4. **Per-wrapper signal-API thunks.** `connect`/`connect_after`/`emit`/`disconnect` were a fresh
   closure per GET; each is now built once per wrapper. Bench after 2–4: **20 943 → 20 057**, emit
   3 328 → 2 894.
5. **`wrapParamSpec` moved to a shared prototype.** It built eleven closures and a twelve-slot
   object on *every* notify emission, because the engine hands the pspec to the handler whether or
   not the handler reads it. The accessors now live on one `paramSpecProto` and read the handle off
   `this` — which is also the gjs shape, where these members live on `GObject.ParamSpec.prototype`.
6. **`findPropertySetter` memoized per (prototype, property), including the negative answer.** The
   native store calls into JS on every write of a custom property, so a class declaring no accessor
   at all — the common case — paid three prototype-chain walks and two regex rewrites per
   assignment to learn nothing. gjs settles the same question once, at `registerClass` time.
7. **The engine assigns instead of calling `set_property`** (`engine.ts`, `setValue`). Both end in
   `g_object_set_property`; the introspected call is the expensive way to get there. A/B on the
   final tree, 11 repeats: `set_property` 12 169 ns against 7 113 ns assigned.

Plus a per-wrapper GI-method thunk cache, which stabilises `obj.m === obj.m` (the gjs shape, since
there the method lives on the prototype) and stops re-asking for the type name across the N-API
boundary inside a loop: bench 6 826 → 6 491, emit 2 793 → 2 441.

## Result

Clean A/B, same worktree, addon and engine bundle rebuilt for each leg, 20 000 ops x 21 repeats,
median ns/op (min–max over repeats):

| row | pure-JS before / after | real-Gio before | real-Gio after | ratio before → after |
| --- | --- | --- | --- | --- |
| `construct` | 302 / 347 | 263 | 264 | 0.87x → 0.76x |
| `construct+first-read` | 1 652 / 2 055 | 9 760 | 8 702 | 5.91x → 4.24x |
| `set+notify` | 458 / 454 | **21 237** | **6 540** | **46.4x → 14.4x** |
| `emit` | 132 / 130 | **3 153** | **2 505** | **23.9x → 19.3x** |

`set`+`notify` is **3.25x faster** and `emit` **1.26x faster**. The pure-JS leg is unchanged
within noise, as it must be — nothing here touches it.

## Confirmed on the emulator

Measured 2026-10-15 on the `x86_64` AVD `NsGi_API_36` (API 36), inside the NativeScript probe APK,
with a `libnode_gi.so` **cross-compiled from this tree** for both ABIs and packed into a locally
built `gi-runtime-android.aar`. That is the point of the leg: the gate report's emulator numbers
came from the published `@gjsify/node-gi` 0.64.0 AAR, which predates #2220 and #2226, so "before"
and "after" here are the same emulator and the same bench body with a different native library.

Device options are `{ iterations: 4000, repeats: 7, warmups: 2 }` — smaller than the host run
because the runner allows 180 s to reach the END marker. Two independent runs, median ns/op:

| row | pure-JS | real-Gio before (0.64.0 AAR) | real-Gio after (run 1 / run 2) | ratio after |
| --- | --- | --- | --- | --- |
| `construct` | 653 / 490 | ~equal | 310 / 281 | 0.48x / 0.57x |
| `construct+first-read` | 3 521 / 2 810 | 16 225 | 16 394 / 15 032 | 4.66x / 5.35x |
| `set+notify` | 535 / 510 | **59 729** | **13 924 / 12 714** | **26.1x / 24.9x** |
| `emit` | 255 / 191 | 9 782 | **4 384 / 4 134** | 17.2x / 21.7x |

`set`+`notify` on the emulator is **4.3–4.7x faster** than with the published AAR, and the ratio
against the pure-JS engine fell from 99.4x to ~25x. `emit` is **2.2–2.4x faster** (9 782 → ~4.3 µs).
The host gain therefore carries to the device, and somewhat more strongly than on the host — the
crossings the seven changes removed are relatively more expensive on an emulated CPU.

`construct+first-read` is unchanged in absolute terms (~15–16 µs, against 16 225 before); its ratio
moved only because the pure-JS leg is slower in these shorter runs. `construct` comes out BELOW 1x,
i.e. the real engine looks faster: the row does not reach the engine at all (the subset's properties
are plain READWRITE, so the twin is built on first use), and with 4 000 ops the pure-JS leg — which
runs first — still carries warm-up the second leg does not. The two are near-identical, which is
what the bench header predicts; the ordering inside one process is noise at this iteration count.

Absolute numbers are an emulated `x86_64` CPU on a loaded workstation and are not comparable to the
host table above. Spreads were wide on the pure-JS rows (`construct+first-read` min 825, max 4 422)
and tight on the real-Gio rows. An arm64 device is still unmeasured.

## What is left, and why

`set`+`notify` is 6.5 µs against the pure-JS engine's 0.45 µs, and most of what remains is not
removable the same way:

- **~4.8 µs is the `setProperty` primitive with a handler connected** — the N-API crossing, the
  GValue typed from the ParamSpec, `g_object_set_property`, GObject's own notify emission, and the
  marshal back into the JS handler. That is what calling real GObject from JS costs. Reducing it
  means doing less GObject, not doing it faster.
- **The engine emits `notify` through GObject and keeps its own emission stack** beside it, because
  `g_signal_stop_emission` CRITICALs instead of answering when there is no emission in progress —
  the one case the core needs told apart. The duplicate bookkeeping is a correctness requirement,
  not an oversight.
- **`findProtoDescriptor` is still ~9 % of both rows.** It walks a JS prototype chain per GET and
  could be memoized per (prototype, name), but a prototype is mutable in a way a GType is not, so
  that cache needs an invalidation story the other six do not. Left alone deliberately.
- **`emit` moved least** (1.26x) because it was already closest to its floor: `emitSignal` with a
  handler is 1 076 ns of the 2 505, and the rest is the proxy GET and the argument marshalling.

## Behaviour

Unchanged, and checked rather than argued:

- `GOBJECT_VECTORS` green on both legs — the oracle (vectors against real GObject directly, 19
  tests) and the engine (the same vectors against the subset with the real engine as its store, 84
  tests / 114 assertions). The notify-counting vectors are the ones that matter for change 7: the
  `[1, 1, 2]` vector in `conformance/gobject.ts` pins "notifies once per change, not on an equal
  value" *through the engine's write path*, which is exactly what swapping `set_property` for an
  assignment could have broken.
- node-gi's full suite green: 891 tests, 853 pass, 0 fail, 38 skipped.
- The gjs-oracle conformance programs all green across all four runtimes.
- Nine new tests in `test/resolution-caches.test.mjs`, each driving two keys through one cache and
  asking the second to answer for itself — the failure mode every one of these caches shares is
  answering for the wrong key.
