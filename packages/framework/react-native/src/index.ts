// `@gjsify/react-native` — the React Native view vocabulary, rendered onto GTK4.
//
// The package a consumer's bundler aliases `react-native` to. Its export surface
// therefore mirrors React Native's own, name for name: 92 of them, every one
// carrying a status in `support-table.ts` (ADR 0032 § 8). What is implemented is
// exported normally; what is not is exported as a value that refuses with the
// table's own sentence, so a reader gets a reason rather than a `MISSING_EXPORT`.
//
// The build-time half of that promise is the bundler gate, which knows the file and
// the line and refuses before anything runs. This module is the runtime backstop for
// what a gate cannot see.

export { AppRegistry, registerRootComponent } from './app-registry.js';
export type { ComponentProvider, RunApplicationOptions } from './app-registry.js';

export { EventEmitter } from './event-emitter.js';
export type { EventSubscription } from './event-emitter.js';

/**
 * React 19 batches every update on its own, so this is the identity call it already
 * is upstream — kept because application code and libraries still wrap in it, and an
 * absent export would refuse something that costs nothing to honour.
 */
export function unstable_batchedUpdates<T, R>(callback: (argument: T) => R, argument: T): R {
    return callback(argument);
}

// Everything this layer does not answer for yet. Generated from the support table
// (`scripts/generate-exports.mjs`), because a bundler needs static export names to
// resolve an import at all and a loop cannot produce them.
export * from './generated/unsupported-exports.js';

// The table itself is public: a consumer building their own tooling — a lint rule, a
// dashboard, a migration script — should read the same data the gate reads rather
// than scrape the README that was generated from it.
export {
    SUPPORT_TABLE,
    SUPPORTED_NAMES,
    explainUnsupported,
    isImportable,
    type SupportEntry,
    type SupportStatus,
    type SupportTier,
} from './support-table.js';

export { UnsupportedError } from './unsupported.js';
