// npm registry client for the gjsify install backend.
// Cross-platform (Node + GJS) - uses globalThis.fetch + SubtleCrypto only.
// Reference: refs/npm-cli/workspaces/libnpmfetch + refs/bun/src/install/npm.zig.
//
// Barrel — re-exports only. Implementation lives in the sibling modules:
//   types.ts      shared shapes (NpmrcConfig, Packument*, FetchOptions)
//   errors.ts     PackageNotFoundError / IntegrityError / RegistryTimeoutError
//   npmrc.ts      DEFAULT_REGISTRY, registryFor, parseNpmrc
//   auth.ts       buildHeaders, resolveAuthForUrl
//   retry.ts      fetchWithRetry (backoff + per-request timeout)
//   integrity.ts  verifyIntegrity (SRI)
//   packument.ts  packumentUrl, assertPackument, fetchPackument(Conditional)
//   tarball.ts    fetchTarball
//   whoami.ts     whoami

export type { FetchOptions, NpmrcConfig, Packument, PackumentDist, PackumentVersion } from './types.js';
export { IntegrityError, PackageNotFoundError, RegistryTimeoutError } from './errors.js';
export { DEFAULT_REGISTRY, parseNpmrc, registryFor } from './npmrc.js';
export { buildHeaders, resolveAuthForUrl } from './auth.js';
export { fetchWithRetry } from './retry.js';
export { verifyIntegrity } from './integrity.js';
export {
    assertPackument,
    type ConditionalPackument,
    fetchPackument,
    fetchPackumentConditional,
    packumentUrl,
} from './packument.js';
export { fetchTarball } from './tarball.js';
export { whoami, type WhoamiResult } from './whoami.js';
