# Real GObject behind the subset: stages 1, 2 and half of 3 (2026-10-10)

[ADR 0105](../adr/0105-real-gobject-backs-the-nativescript-subset-on-android.md) proposes putting
**real GObject** behind adwaita-core's hand-written GObject subset, reached through node-gi, so
that one subset serves both a pure-JS host and a host with a real GI binding under it.
[Stage 0](2026-10-10-gobject-oracle-node-gi.md) measured node-gi against `GOBJECT_VECTORS` as an
ORACLE — real GObject answering the vectors directly, with no subset in between. This report is
the next three steps: the engine **seam** (stage 1), a real GObject **behind** the subset
(stage 2), and the `GListModel` half of stage 3.

**All three hold.** The same `GOBJECT_VECTORS` that pin the pure-JS subset now pass with a real
`GObject.Object` doing the storing and the signalling — 24 of 24 rows, refusals included — and
the portable `items-changed` vectors pass with a real `Gio.ListStore` underneath, 9 of 9. No
vector was weakened, no `it.failing` was added, and node-gi needed no fix: both divergences found
were the engine's to absorb, and both are recorded below because they are facts about GObject that
pure JS hides.

Measured on Fedora 44, `x86_64`: gjs 1.88.1, Node 24.19.0, GTK 4.22.5, GLib 2.88.3, node-gi built
in-tree with `node-gyp` (`NODE_GI_NATIVE=build`), Wayland session with a display, so the
template rows ran on every leg that has them.

## The result, per subject

Each subject is one implementation of `GObjectSubject` held to the same vectors by
`driveGObjectVectors`. An oracle skips the seven `holds: 'subset'` rows, which are REFUSALS the
subset owes and real GObject deliberately accepts; a subject with no `Widget` skips the four
widget rows. That is why the row counts differ, and the difference is the measurement, not noise.

- **Pure-JS subset** — `adwaita-core (test door)`, unchanged by this work: **24 of 24 pass**
  (`node test.node.mjs`: 2838 tests, 56691 assertions, 8 gjs-gated suites stood down).
- **Real GJS oracle** — `GJS (real gi://GObject)`: **17 of 17 pass**, template rows included
  (`gjs -m test.gjs.mjs`: 2913 tests, 56771 assertions, 75 tests from 8 gjs gates).
- **node-gi oracle** — `node-gi (real GObject on Node)`: **16 pass, 1 known-divergent**, the
  `$gtype.name` row from stage 0, still `it.failing` against
  [#2151](https://github.com/gjsify/gjsify/issues/2151).
- **The subset ON real GObject** — `adwaita-core on real GObject (node-gi engine)`, the new
  subject this work exists for: **24 of 24 pass**. It is not an oracle: it runs the seven refusal
  rows and the four widget rows too, because the refusals are still the subset's own and the
  widgets are still the subset's test door. This is the only subject that answers all 24.
- **The engine itself** — 3 of 3, the contract rows no vector covers (it names itself, it refuses
  an instance of a class it never registered, it never asks the core to notify).
- **The portable list model on a real store** — 9 of 9 `LIST_ITEMS_CHANGED_VECTORS` against a real
  `Gio.ListStore`, plus 3 rows for what the real store adds.

The new package's leg is **39 tests, 66 assertions, all green**.

## Stage 1: the seam

`packages/web/adwaita-core/src/engine.ts` declares `GObjectEngine` with ten members — `name`,
`register`, `getValue`, `setValue`, `addHandler`, `removeHandler`, `emit`, `notify`,
`stopEmission`, `bind` — and `gobject.ts` keeps `PURE_JS_ENGINE` as the default. The file imports
only types, so it adds nothing to any bundle by itself.

What the seam is NOT is the more useful half of the boundary. **The core keeps every decision**:
`registerClass` refusals, accessor generation, the dash/underscore/camel name triple, construct
order, signal arity, the error messages the vectors assert verbatim, and the whole handler-id
space — the core allocates ids for engine connections and door connections out of one dense
counter, and keeps foreign unlisten callbacks in its own `WeakMap`. The engine is a value store
and a signal bus, nothing more. That split is what let the real engine be ~500 lines instead of a
second subset, and it is why 24 of 24 rows pass rather than a subset of them.

One member carries a decision worth naming: `setValue` returns whether the CORE must notify. The
pure-JS engine returns `true` on a real change; the real-Gio engine always returns `false`,
because by the time it returns, `set_property` on the twin has already notified and the core
notifying again would double every `notify::`.

**Measured bundle cost** — the ADR's stage-1 measurement asked for "no bundle-size change in the
browser build", and that is not quite what happened. Bundling `src/index.ts` with
`--app browser` at the pre-branch commit and at the tip:

- raw: 179,771 → 180,533 bytes, **+762 bytes (+0.42 %)**
- gzipped: 53,610 → 53,847 bytes, **+237 bytes (+0.44 %)**

Not zero, and not erased: `PURE_JS_ENGINE` is a named object of ten methods where the same work
used to be inline, and the `engineOf` indirection survives bundling. A quarter of a kilobyte
compressed is a fair price, but the ADR's "no change" should read "no measurable change in
behaviour, ~0.2 KiB gzipped in size". (The package's *test* browser bundle is byte-identical
across the change — but that bundle never includes `gobject.ts`, so it measures nothing here. It
is recorded because it is the bundle one would reach for first.)

## Stage 2: a real GObject behind the subset

`packages/nativescript-bridge/gobject/` — `@gjsify/adwaita-gobject-native`, tier 3,
`nativescriptPlatforms: ["android"]` — holds `createRealGioEngine(requireGi)`. For every class the
core registers, the engine registers a **twin** GObject class and keeps one twin instance per
subset instance. Properties live in the twin's GObject property store; signals are real GObject
signals; `notify::` comes from GObject's own emission.

How the twin is built:

- every subset property is declared plain `F.READWRITE`, including the ones the subset marks
  CONSTRUCT_ONLY — the core already refuses the writes, so a CONSTRUCT_ONLY twin would only add a
  second, differently-worded refusal.
- the twin's GType chain mirrors the subset's chain through the engine's own `TWINS` map, so a
  subclass's twin derives from its parent's twin and `type_ensure`/`$gtype` rows hold.
- GType names are suffixed `<sanitised>_RealGio<n>`, because GType names are process-global and
  the vectors register the same class name more than once per process.
- `bind` uses real `bind_property` when both sides have twins, and falls back to the core's
  `bindProperties` otherwise.

**Divergence 1, and the one real finding of stage 2.** The vectors require that writing a property
the value it already has notifies nothing. Real GObject does not provide that rule:
`g_object_set_property` notifies unconditionally. The rule lives in the **generated accessor** —
in GJS and in node-gi alike — which compares before it writes. Probe: with a node-gi accessor,
`x, x, y` yields 1, 1, 2 notifications; the same writes through `set_property` yield 1, 2, 3. So
the engine owns the comparison, in a per-instance `TOUCHED` map (skip the write when the slot has
been touched and the twin already reads that value), which mirrors what `PURE_JS_ENGINE`'s
unset-slot semantics do for free. node-gi is correct here and was not changed.

**Known divergence, no vector covers it:** a binding that writes the target twin bypasses a
class-defined JS setter. Real GJS behaves the same way — `g_object_set` does not route through a
JS accessor — so the oracle agrees with the engine and there is nothing to fix. Recorded so the
next reader does not file it.

### Where the real-engine subject lives, and why it is a deviation

ADR 0105 § 7 puts the conformance subject in the new tier-3 package. The stage-0 ORACLE subject
stays in `packages/web/adwaita-core` next to the GJS leg it mirrors; only the real-ENGINE subject
moved into the new package. The reason is the dependency direction: the engine subject must import
the engine, the engine is tier 3, and tier 2 may not depend on tier 3. Keeping both subjects in
one place would either drag tier 3 into adwaita-core's dependencies or duplicate the engine. The
split is the smaller cost, and `check-adwaita-conformance-drivers.mjs` still sees both.

## Stage 3, the half that was shipped: `GListModel`

`createRealGioListStore(requireGi)` puts a real `Gio.ListStore` behind the portable list model, so
`LIST_ITEMS_CHANGED_VECTORS` — which until now only ever ran against plain data — run against
GLib's own store. The item GType is registered **per store** (`AdwPortableListItem_RealGio<n>`),
again because GType names are process-global.

**Divergence 2, measured:** `g_list_store_splice` emits `items-changed` **unconditionally** —
`splice(3, 0, [])` really does emit `(3, 0, 0)`. The portable model's contract says an equal model
emits NOTHING, and the only way to keep that on a real store is to not splice at all. So
`listItemsChanged`'s `null` return is load-bearing in a way pure JS hid completely: in pure JS the
no-op is invisible, on a real store it is a signal that would make a renderer discard live views
for no change. That is now pinned by a row of its own ("a zero splice is NOT free").

node-gi returns the **same JS wrapper** for an item across `get_item` calls, so the vectors'
identity-counted survivors work unchanged — `get_item(0) === the object spliced in`.

## Not done, and not measured

- **Settings and `Gio.File`**, the literal content of ADR 0105 stage 3, are not here. The ADR's
  measurement is "the ADR 0099 and 0100 vectors on device", and those vectors do not exist:
  `@gjsify/app-settings` (ADR 0099) and `@gjsify/file-chooser` (ADR 0100) are **Accepted but never
  implemented**. There is no pure-JS subset to put real Gio behind, and no vectors to hold it to.
  Backing them would mean writing the subset first, which is ADR 0099/0100 work, not this.
- **Nothing ran on Android.** No physical device and no emulator leg was used, so every number
  here is `x86_64` Linux under Node or GJS. The ADR's stage-2 measurement asks for the vectors
  "on device" and for per-instance construction cost against the pure-JS engine; neither was
  measured. The NativeScript harness gap stage 0 recorded is still the blocker.
- **The device opt-in is deliberately not flipped.** `packages/nativescript-bridge/adwaita/`
  still builds its GObject namespace with the pure-JS engine. The reason is at the call site, in a
  comment rather than a TODO: `createGObject(door)` is evaluated at module load, so a throwing
  `requireGi` on NativeScript's V8 would kill app startup, and wrapping it in a try/catch fallback
  would make "is this app backed by real GObject?" unanswerable at runtime. The flip belongs with
  the stage-4 packaging work that makes `requireGi` reliably available.
- **No performance number of any kind.** Twin allocation, `set_property` round-trips and signal
  emission through napi all cost more than a JS object field, and none of it was timed.
- The engine's `vfunc`, `Implements` and `Requires` paths are not exercised beyond the refusals —
  the subset refuses them, so there is nothing behind the refusal to measure.

## Where this runs

`.github/workflows/node-gi.yml`, job `gtk-host-node`: the new package is built, `@gjsify/node-gi`
is symlinked like the other legs, and the engine and list-store suites run as two steps **without**
`xvfb` — they are GObject-only and have no display-gated rows. `audit-runtimes.mjs --check` now
reports 6 wired `test:gjs-on-node` legs.
