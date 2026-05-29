// Ambient fallback for `debug` — its npm tarball ships its own types
// (`@types/debug` is the de-facto external type package). This safety
// net keeps tsc green on a fresh checkout before `yarn install`.
declare module 'debug';
