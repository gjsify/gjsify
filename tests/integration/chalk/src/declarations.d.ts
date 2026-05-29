// Ambient fallback for chalk — its npm tarball ships its own types under
// source/index.d.ts (referenced from package.json#types). This declaration
// is a safety net in case the types are unavailable on a fresh checkout
// before `yarn install`.
declare module 'chalk';
