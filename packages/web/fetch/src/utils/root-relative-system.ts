// The GJS-host binding of the shared root-relative rewrite: reads the running
// program's path from the `system` built-in and delegates to the PURE
// `rewriteRootRelativeUrl` (utils/root-relative.ts — the #869 single copy).
//
// This wrapper is a SEPARATE module on purpose. The bare `system` built-in is
// external on the gjs target and aliased to `@gjsify/node-gi/system` (kept
// external) on `--app node`, so whichever module imports it drags a hard
// node-gi requirement into the emitted bundle. Keeping the import here confines
// that to the GJS-reachable path (fetch's own Soup-backed impl + XHR), while
// the pure half stays testable — and loadable — on plain Node.

// The bare `system` built-in — NOT `globalThis.imports.system`: the probe shape
// is `undefined` on the node-gi reverse bridge unless the globals shim happens
// to be injected, which is exactly how #869's silent `ERR_INVALID_URL` hid.
import System from 'system';

import { rewriteRootRelativeUrl } from './root-relative.js';

/**
 * Rewrite a root-relative URL to `file://` under the running program's
 * directory (see `rewriteRootRelativeUrl` for the contract). Reads the program
 * path from the `system` built-in — `programPath` on gjs, with
 * `programInvocationName` as the fallback (on the node bridge that is
 * `process.argv[1]`, the bundle itself — the right base).
 */
export function resolveRootRelativeUrl(url: string): string {
    return rewriteRootRelativeUrl(url, System.programPath ?? System.programInvocationName ?? '');
}
