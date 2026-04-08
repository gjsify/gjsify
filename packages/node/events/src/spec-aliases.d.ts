// Ambient declaration for `import 'abort-controller'` used as a side-effect
// import in event-emitter.spec.ts (registers AbortController globals on GJS,
// no-op on Node.js). This file is a script (no top-level export) so the
// `declare module` creates a new ambient module rather than augmenting an
// existing one.

declare module 'abort-controller';
