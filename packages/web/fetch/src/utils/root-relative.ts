// Root-relative URL → `file://` under the program directory. THE one copy: `@gjsify/fetch`
// and `@gjsify/xmlhttprequest` used to carry two spellings, and they drifted — the fetch
// copy read `globalThis.imports.system` (GJS-only) while the XHR copy imported the `system`
// built-in, so on the node-gi reverse bridge XHR-loaded assets resolved and every
// root-relative `fetch()` died with `ERR_INVALID_URL` (#869).
//
// Deliberately PURE — the program path is a PARAMETER and the `system` built-in is read one
// module over (`root-relative-system.ts`). The split is load-bearing: on `--app node` the
// bare `system` specifier is aliased to `@gjsify/node-gi/system` and kept EXTERNAL, so any
// module importing it makes the bundle hard-require the bridge at load, and this package's
// node test bundle must load on plain Node.

// `/core` and not the `@gjsify/utils` root: the root reaches Gio/GLib, which would undo the
// plain-Node loadability this module's split exists to protect.
import { lastPathSeparatorIndex, pathToFileUrlHref } from '@gjsify/utils/core';

/**
 * Rewrite a root-relative URL (starts with `/` but not `//`) to a `file://` URL under the
 * program path's directory, so a GJS/GTK app loads bundled assets with the same paths a
 * browser resolves against its origin. Returns the input unchanged when it is not
 * root-relative or no usable program path is given.
 *
 * The security implications (arbitrary file reads) are acceptable for the current use
 * cases — revisit if these packages ever handle untrusted input.
 *
 * Deliberately no `GLib.path_get_dirname`: `@girs/glib-2.0` is emptied to `{}` in a
 * plain-Node bundle, so a GLib call here only ever "worked" behind a swallowing catch.
 * The separator question goes to `@gjsify/utils/core` instead, which answers it from the
 * SHAPE of the path — this function's own `lastIndexOf('/')` returned -1 for
 * `C:\…\dist\main.js`, the `slash <= 0` guard read that as "no program dir", and every
 * root-relative `fetch()` on win32 died as `Invalid URL` in the `Request` constructor
 * (#1143).
 *
 * The base and the URL are CONCATENATED rather than resolved through `new URL(url, base)`:
 * resolving a root-relative path against `file:///C:/app/dist` drops the program directory
 * and keeps only the root — and the runtimes do not agree on what the root is. Measured:
 * Node keeps the drive (`file:///C:/res/…`), GJS/SpiderMonkey does not (`file:///res/…`).
 * So resolution is both wrong for this purpose and host-dependent.
 *
 * @param programPath `System.programPath ?? System.programInvocationName` on gjs;
 *   `process.argv[1]` — the bundle itself — on the node-gi reverse bridge.
 */
export function rewriteRootRelativeUrl(url: string, programPath: string): string {
    if (!url.startsWith('/') || url.startsWith('//')) return url;
    const separator = lastPathSeparatorIndex(programPath);
    if (separator <= 0) return url; // no usable program dir ('' or a bare name)
    // Only the DIRECTORY is percent-encoded. `url` is already a URL and carries its own
    // `?query` and `#fragment` semantics — encoding it would turn a cache-busting
    // `/res/x.png?v=2` into a request for a file literally called `x.png?v=2`.
    return `${pathToFileUrlHref(programPath.slice(0, separator))}${url}`;
}
