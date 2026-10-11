# A real GObject behind the portable subset (`@gjsify/adwaita-gobject-native`)

The detail behind one row of
[`packages/nativescript-bridge/AGENTS.md`](../packages/nativescript-bridge/AGENTS.md). The decision
is [ADR 0105](adr/0105-real-gobject-backs-the-nativescript-subset-on-android.md) § 2;
the measurements are [stages 1–3](reports/2026-10-10-real-gio-stage3.md) and the
[stage-0 oracle](reports/2026-10-10-gobject-oracle-node-gi.md).

## Why its `node` slot is not `'none'`

Every other bridge in `packages/nativescript-bridge/` reaches the platform through NS V8 globals
(`java.*`, `NS*`), which exist on a device and nowhere else — so `node: 'none'` there is a fact
about the platform, not a style rule. This one reaches real GObject through `@gjsify/node-gi`, and
node-gi's whole point is that the SAME binding runs on Node on a Linux CI runner. So the engine is
`native` on NativeScript *and* `polyfill` on Node, and the Node slot is not a convenience: it is
the only leg that can MEASURE the thing. `@gjsify/adwaita-core`'s GObject conformance vectors run
against the subset with this engine underneath in `node-gi.yml`'s `gtk-host-node` job, beside the
stage-0 oracle that runs the same vectors against node-gi directly. Without it the claim "a real
GObject answers the subset's calls" would rest on a device nobody runs in CI. `gjs`/`browser` stay
`'none'` as usual: GJS has GObject already, a browser has none to reach.

## What the engine is

`createRealGioEngine(requireGi)` returns the `GObjectEngine` that `@gjsify/adwaita-core` takes
instead of its `PURE_JS_ENGINE`. One hidden `GObject.Object` TWIN per subset instance holds the
property values and the signals:

- `register()` builds a twin class whose GType chain mirrors the subset chain — the parent is
  found by walking the prototype through this engine's own `TWINS` map, and registration is
  parent-first. GTypeNames are made unique by a counter suffix, because a duplicate name THROWS
  and the vectors reuse class names within one process.
- every subset property is declared plain `READWRITE` on the twin, never `CONSTRUCT_ONLY`. The
  core already refuses the second write, so the only writer left is `defineConstructOnly`, which
  runs *after* the twin exists — declaring CONSTRUCT_ONLY would break the one legitimate write.
  The boundary stays the core's.
- `getValue`/`setValue` read and write the twin.
- handlers go through `signal_connect` REWRAPPED, so a JS handler is still called with the JS
  instance rather than the twin, and a `notify::` handler is handed the SUBSET's ParamSpec.
- `stopEmission` keeps the engine's own emission stack and calls real
  `g_signal_stop_emission_by_name` on a match.
- `bind` uses the twins' real `g_object_bind_property` whenever BOTH ends have a twin, and falls
  back to the core's `bindProperties` when either is an unregistered door widget.

**It is not a second subset.** `registerClass`'s refusals, accessor generation, construct order,
signal-arity checks and every error message stay in `adwaita-core`, so one corpus of vectors holds
both backends. The engine is a value store and a signal bus, nothing else.

## The one rule that had to move INTO the engine, measured

`g_object_set_property` notifies **unconditionally**. The "an equal write is not a change" rule
that GJS and node-gi appear to have lives in their GENERATED ACCESSORS, not in GObject. Probe:
accessor writes `x, x, y` give 1, 1, 2 notifies; the same writes through `set_property` give
1, 2, 3. So the engine keeps a per-instance touched-property set and skips a write equal to the
current value — EXCEPT the first, because the pure-JS subset's unset slot reads `undefined` and
its first write counts as a change even when it equals the ParamSpec default.

The sibling finding on the list side: `g_list_store_splice` emits `items-changed` unconditionally
too, so the portable model's "an equal model emits nothing" is kept only by not splicing at all.

## `requireGi` is INJECTED

No file but the test entry names `@gjsify/node-gi`. A static import in a type-checked file is
TS2307 off this leg, and a `gi://`-shaped dynamic load would set `dynamic_gi` in
`audit-runtimes.mjs`'s textual walk — which reads COMMENTS too — and mis-declare the package.

## How an app opts in (ADR 0105 stage 4)

The engine is **off by default on every target**, and turning it on is one call in APP code:

```ts
// app/engine-opt-in.ts
import requireGi from '@gjsify/node-gi/gi';
import { useRealGObjectEngine } from '@gjsify/adwaita-gobject-native';
useRealGObjectEngine(requireGi);

// app/app.ts
import './engine-opt-in.js'; // FIRST import — it must be EVALUATED before the line below
import { Application } from '@gjsify/adwaita-nativescript';
```

Three things make that one call enough, and each is a refusal rather than a convenience:

- **The slot.** `useRealGObjectEngine` hands the engine to `registerGObjectEngine` in
  `@gjsify/adwaita-core`, and `namespace/gobject.ts` builds its namespace with
  `createGObject(door, registeredEngine())`. The port cannot take the engine as an argument — by
  the time an app imports `@gjsify/adwaita-nativescript/gobject` that module body has already run
  — so the app leaves it somewhere the port reads. An empty slot is `PURE_JS_ENGINE`.
- **Why the app and not the port decides.** The engine needs `requireGi`, which needs
  `@gjsify/node-gi` plus `@gjsify/gi-runtime-android`'s payload: tier-3, Android-only. The port is
  tier 2 and installable in a browser. A port that reached for them itself would make every
  consumer an Android consumer.
- **Loud, never a fallback.** `useRealGObjectEngine` resolves `GObject` eagerly, so a missing AAR,
  a dropped ABI or unextracted typelibs throw at opt-in time, naming
  `@gjsify/gi-runtime-android` and keeping the dlopen message as `cause`. A try/catch that fell
  back to pure JS would turn a build problem into an app that works, differently, forever.
  Registering AFTER the port has read the slot throws too, with the import-order fix in the
  message — otherwise an app would believe it had real GObject and not have it.

Which engine is actually behind the subset is a runtime QUESTION with an answer:
`GObject.engineName` off `@gjsify/adwaita-nativescript/gobject` (or `gobjectEngineName()` from
`@gjsify/adwaita-core`) is `'real-gio'` after a successful opt-in and `'pure-js'` without one.
Asking freezes the slot, because an answer a later registration would invalidate is worse than
none. The refusals are held in `src/opt-in.spec.ts` (no GI stack needed) and
`adwaita-core/src/engine-slot.spec.ts`.
