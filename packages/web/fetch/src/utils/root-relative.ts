// Root-relative URL → `file://` under the program directory.
//
// THE one copy of this rewrite. `@gjsify/fetch` and `@gjsify/xmlhttprequest`
// used to carry two hand-written spellings of it, and the copies drifting is
// exactly what broke: the fetch copy read `globalThis.imports.system` (GJS-only)
// while the XHR copy imported the `system` built-in, so on the node-gi reverse
// bridge every XHR-loaded asset resolved and every root-relative `fetch()` died
// with `ERR_INVALID_URL` (#869 — the excalibur-jelly-jumper showcase rendered an
// empty level because its Tiled map is the one asset fetched rather than XHR'd).

// The bare `system` built-in — external on the gjs target, aliased to
// `@gjsify/node-gi/system` on the node one (where `programPath` is
// `process.argv[1]`, the bundle itself — the right base).
import System from 'system';

/**
 * Rewrite a root-relative URL (starts with `/` but not `//`, e.g.
 * `/res/images/foo.png`) to a `file://` URL under the running program's
 * directory, so a GJS/GTK app loads bundled assets with the same paths a
 * browser would resolve against its origin.
 *
 * Returns the input unchanged when it is not root-relative or when no program
 * path is available. The security implications (arbitrary file reads) are
 * acceptable for the current use cases — revisit if these packages ever handle
 * untrusted input.
 *
 * Deliberately PURE — no `GLib.path_get_dirname`: `@girs/glib-2.0` is emptied
 * to `{}` in a plain-Node bundle (only the gjs target and the reverse bridge
 * resolve it), so a GLib call here only ever "worked" behind a swallowing
 * catch. The program path is `/`-separated on every runtime this rewrite
 * serves, making dirname a string slice.
 */
export function resolveRootRelativeUrl(url: string): string {
    if (!url.startsWith('/') || url.startsWith('//')) return url;
    const programPath = System.programPath ?? System.programInvocationName ?? '';
    const slash = programPath.lastIndexOf('/');
    if (slash <= 0) return url; // no usable program dir ('' or a bare name)
    return `file://${programPath.slice(0, slash)}${url}`;
}
