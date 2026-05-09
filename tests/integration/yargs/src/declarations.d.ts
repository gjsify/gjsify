// Ambient fallback for packages without bundled types in this workspace.
// @types/yargs is the primary source; this guards against a fresh checkout
// before `yarn install` resolves the type packages.
declare module 'yargs';
declare module 'yargs/yargs';
declare module 'yargs/helpers';
