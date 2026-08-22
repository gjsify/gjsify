// The CSS selector engine, as a leaf: it imports no node classes, no `@girs/*`
// and nothing platform-specific, so `@gjsify/dom-elements` can consume it
// without the edge ever reversing (ADR 0026 § Decision 2).
//
// The surface is the four query functions and the `Adapter` they read a tree
// through. A compile step is deliberately NOT among them: a compiled predicate
// owns a `:has()` memo that is correct for the duration of ONE query, and an
// exported compile step is an invitation to outlive a tree edit with it.

export type { Adapter } from './adapter.js';
export { quoteSelectorString } from './parse.js';
export { closestSelector, matchesSelector, selectAll, selectOne } from './query.js';
