// Ambient fallback for packages without bundled types.
// @types/streamx is the primary source; this covers the case where it is
// not yet installed (e.g. fresh checkout before `yarn install`).
declare module 'streamx'
