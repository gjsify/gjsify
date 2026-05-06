// Public re-exports for `@gjsify/rolldown-plugin-gjsify`.
//
// The orchestrator (`gjsifyPlugin`) and platform-specific factories
// (`gjsifyForGjs`, `gjsifyForNode`, `gjsifyForBrowser`) land in a follow-up
// commit on this branch. This file currently exports the bundler-agnostic
// type and utility surface so consumers can already depend on us.

export * from './types/index.js';
export * from './utils/index.js';
export * from '@gjsify/resolve-npm';
