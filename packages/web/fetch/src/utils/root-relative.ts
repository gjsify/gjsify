// Root-relative URL → `file://` under the program directory.
//
// THE one copy of this rewrite. `@gjsify/fetch` and `@gjsify/xmlhttprequest`
// used to carry two hand-written spellings of it, and the copies drifting is
// exactly what broke: the fetch copy read `globalThis.imports.system` (GJS-only)
// while the XHR copy imported the `system` built-in, so on the node-gi reverse
// bridge every XHR-loaded asset resolved and every root-relative `fetch()` died
// with `ERR_INVALID_URL` (#869 — the excalibur-jelly-jumper showcase rendered an
// empty level because its Tiled map is the one asset fetched rather than XHR'd).
//
// This module is deliberately PURE — the program path is a PARAMETER, and the
// `system` built-in is read one module over (`root-relative-system.ts`). The
// split is load-bearing for cross-platform loadability: on `--app node` the
// bare `system` specifier is aliased to `@gjsify/node-gi/system` and kept
// EXTERNAL, so any module that imports it makes the emitted bundle hard-require
// the node-gi bridge at load. `@gjsify/fetch` is a cross-platform package whose
// node test bundle must load on plain Node — its spec therefore covers THIS
// pure function on gjs AND node, while the `system` read stays confined to the
// GJS-reachable wrapper.

/**
 * Rewrite a root-relative URL (starts with `/` but not `//`, e.g.
 * `/res/images/foo.png`) to a `file://` URL under the given program path's
 * directory, so a GJS/GTK app loads bundled assets with the same paths a
 * browser would resolve against its origin.
 *
 * Returns the input unchanged when it is not root-relative or when no usable
 * program path is given. The security implications (arbitrary file reads) are
 * acceptable for the current use cases — revisit if these packages ever handle
 * untrusted input.
 *
 * Deliberately no `GLib.path_get_dirname`: `@girs/glib-2.0` is emptied to `{}`
 * in a plain-Node bundle (only the gjs target and the reverse bridge resolve
 * it), so a GLib call here only ever "worked" behind a swallowing catch. The
 * program path is `/`-separated on every runtime this rewrite serves, making
 * dirname a string slice.
 *
 * @param url The URL to rewrite.
 * @param programPath The running program's path (`System.programPath ??
 *   System.programInvocationName` on gjs; `process.argv[1]` — the bundle
 *   itself — on the node-gi reverse bridge).
 */
export function rewriteRootRelativeUrl(url: string, programPath: string): string {
    if (!url.startsWith('/') || url.startsWith('//')) return url;
    const slash = programPath.lastIndexOf('/');
    if (slash <= 0) return url; // no usable program dir ('' or a bare name)
    return `file://${programPath.slice(0, slash)}${url}`;
}
