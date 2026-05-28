// Ambient fallback for dotenv — its npm tarball ships its own types
// under lib/main.d.ts (referenced from package.json#types). This
// declaration is a safety net in case the types are unavailable on a
// fresh checkout before `yarn install`.
declare module 'dotenv';
