// `@gjsify/adwaita-gobject-native` — real GObject behind the GObject subset (ADR 0105).
//
// Three exports, all taking `requireGi`:
//   • `useRealGObjectEngine(requireGi)` — THE opt-in an app calls. Builds the engine, proves real
//     GObject is reachable and hands it to the core's slot so the NativeScript port picks it up.
//     `./opt-in.ts` says where in the app it has to go and why it throws instead of falling back.
//   • `createRealGioEngine(requireGi)` — the engine itself, for a caller that owns its own
//     `createGObject(door, engine)` call (the conformance runs do); everything that DECIDES stays
//     `@gjsify/adwaita-core`'s.
//   • `createRealGioListStore(requireGi)` — the portable list model (ADR 0046) in a real
//     `Gio.ListStore`, so the value a `model` property holds can BE a `GListModel`.
//
// Plus `createSubsetSubject(engine)`, which takes no `requireGi`: the conformance SUBJECT — the
// subset with an engine behind it, as the vector driver takes it. Shipped rather than left in a
// spec file because two legs drive it now and a second copy of that door is how they would start
// measuring different things; `./vector-subject.ts` says which two.

export { useRealGObjectEngine } from './opt-in.js';
export { createRealGioEngine } from './engine.js';
export type { RequireGi } from './engine.js';
export { createRealGioListStore } from './list-store.js';
export type { RealGioListStore } from './list-store.js';
export { createSubsetSubject, SUBSET_SUBJECT_NAME } from './vector-subject.js';
