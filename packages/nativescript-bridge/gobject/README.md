# @gjsify/adwaita-gobject-native

Real GObject behind `@gjsify/adwaita-core`'s GObject subset (ADR 0105): a `GObjectEngine` whose
property store, `notify`, signal bus, emission-stopping and `bind_property` are a live GObject,
reached through `@gjsify/node-gi` (ADR 0104).

```ts
import { createGObject } from '@gjsify/adwaita-core';
import { createRealGioEngine } from '@gjsify/adwaita-gobject-native';

const GObject = createGObject(door, createRealGioEngine(requireGi));
```

`requireGi` is `@gjsify/node-gi/gi`'s loader — injected, not imported, so this package names the
bridge nowhere: a static import of a non-workspace member fails `build:types` on every job that
has not linked it, and a dynamic `gi://` load would mis-declare the package's runtime triplet in
`scripts/audit-runtimes.mjs`. GJS's own `imports.gi` answers the same calls.

## What the engine does and does not own

The engine is a value store and a signal bus, nothing else. `registerClass`'s refusals, the
accessor rule, the construct order and every error message stay in `@gjsify/adwaita-core` — so a
class the subset refuses is refused here identically, and the vectors of `GOBJECT_VECTORS` that
decide a refusal hold unchanged. What the engine can change is only what a read, a write and an
emission DO.

- A registered subset class gets a real GType; each instance gets one real instance of it, its
  **twin**, held beside the instance and keyed by it. The twins mirror the subset's own class
  chain. A handler is always called with the INSTANCE, never with the twin, and a `notify::`
  handler gets the SUBSET's `ParamSpec`.
- The twin declares every property `READWRITE`, including the construct-only ones: after the twin
  exists, the only writer left is the engine itself, from the core's `defineConstructOnly`.
  Construct-only is still enforced — by the core, on the same vector.
- `setValue` tells the core it owes no `notify`: `g_object_set_property` already emitted one to
  the handlers connected to the twin.
- GType names are suffixed per registration (`<name>_RealGio<n>`). A GType name is process-global
  and a duplicate throws, while the vectors register the same class names on every subject.
- `bind` makes a real `GBinding` when both sides have twins, and falls back to the core's portable
  `bindProperties` when either side is a door widget the engine never registered.

## What is measured

`src/engine.node-gi.spec.ts` drives all 24 rows of `@gjsify/adwaita-core/conformance`'s
`GOBJECT_VECTORS` against `createGObject(door, createRealGioEngine(requireGi))` under Node:

```sh
gjsify workspace @gjsify/adwaita-gobject-native run test:gjs-on-node
```

Unlike the oracle leg in `adwaita-core` (`isOracle: true`, which skips the seven `holds: 'subset'`
rows because real GObject accepts what the subset refuses), this subject IS the subset, so the
refusals run too — they are the one claim an engine swap could silently break. The four
`widget: true` rows run as well: the door is the same two-fake-widget door `gobject.spec.ts` uses,
so no display is involved.

## Runtimes

`nativescript: 'native'` is the target — this is where real GObject reaches Android. The `node`
slot is `'polyfill'` rather than `'none'`, which is an exception to the convention in
[AGENTS.md](../AGENTS.md): node-gi makes the engine measurable on Linux CI, and a leg that cannot
run is a claim nobody checks.
