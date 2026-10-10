// `@gjsify/adwaita-gobject-native` — real GObject behind the GObject subset (ADR 0105).
//
// Two exports, both factories, both taking `requireGi`:
//   • `createGObject(door, createRealGioEngine(requireGi))` — the whole opt-in for the GObject
//     subset; everything that DECIDES stays `@gjsify/adwaita-core`'s.
//   • `createRealGioListStore(requireGi)` — the portable list model (ADR 0046) in a real
//     `Gio.ListStore`, so the value a `model` property holds can BE a `GListModel`.

export { createRealGioEngine } from './engine.js';
export type { RequireGi } from './engine.js';
export { createRealGioListStore } from './list-store.js';
export type { RealGioListStore } from './list-store.js';
