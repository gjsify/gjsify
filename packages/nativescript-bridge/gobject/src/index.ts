// `@gjsify/adwaita-gobject-native` — real GObject behind the GObject subset (ADR 0105).
//
// One export: the engine factory. `createGObject(door, createRealGioEngine(requireGi))` is the
// whole opt-in; everything else about the subset stays `@gjsify/adwaita-core`'s.

export { createRealGioEngine } from './engine.js';
export type { RequireGi } from './engine.js';
