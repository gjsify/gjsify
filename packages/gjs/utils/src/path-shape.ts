// Where does a path separate, and how does it become a `file://` URL — asked in ONE
// place, because the obvious hand-rolled answer is wrong on win32 and CANNOT fail on
// Linux.
//
// THE INCIDENT (#1143)
//
// `@gjsify/fetch`'s root-relative rewrite found the program directory with
// `programPath.lastIndexOf('/')` under a comment asserting "the program path is
// `/`-separated on every runtime this serves". On win32 it is `C:\…\dist\main.js`,
// so the index is -1, the guard written for "no program dir" swallowed it, and
// `fetch('/res/tilemaps/level1.tmx')` reached the `Request` constructor unrewritten:
// `Invalid URL`, then a SIGSEGV on bun and 0xC0000005 on deno. Three more live copies
// of the same slice were found alongside it (`@gjsify/sqlite`'s DB_DIR/DB_NAME split,
// `@gjsify/fs`'s per-component NAME_MAX check, the CLI's gettext basename), plus
// `@gjsify/url`'s `pathToFileURL`, which tested absoluteness with `filepath[0] !== '/'`.
//
// THE DESIGN RULE, and the reason this module takes no `process.platform`
//
// Every decision here is made from the SHAPE OF THE PATH PASSED IN, never from the host.
// A gate is a claim about a host — one made from `process.platform` can only be checked
// by running on that host, and CI is Linux-only (ADR 0018 § 5), which is precisely how
// four copies of this bug lived undisturbed. Shape-decided, the win32 behaviour is
// checkable from a Linux runner, and `path-shape.spec.ts` checks it there.
//
// Deliberately not `node:path`'s `win32`/`posix` halves, which own exactly this
// algebra: this module is in the `/core` half (see `core.ts`), which must be
// well-defined where `node:` specifiers do not resolve — the same constraint that makes
// `host-os.ts` read a guarded `globalThis` instead of importing `node:process`. What is
// re-implemented is kept to the primitive the call sites actually share (WHERE does it
// separate), not the normalising `dirname`/`basename` semantics, so each caller keeps
// its own established handling of the no-separator and root cases.

/**
 * A drive-letter absolute path (`C:\x`, `c:/x`) or a UNC path (`\\server\share\x`).
 *
 * Deliberately NOT "contains a backslash": `\` is a legal character in a POSIX
 * filename, so `/tmp/we\ird` is a POSIX path and must keep being treated as one. A
 * drive-letter or UNC prefix is the positive evidence; nothing else is.
 */
export function isWindowsPath(path: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

/**
 * Index of the last path separator, or `-1` when the path has none.
 *
 * `\` counts only in a Windows-shaped path (see {@link isWindowsPath}). Returns an
 * INDEX rather than a dirname on purpose — the four call sites this replaced each had
 * their own established answer for "no separator" (`''`, `'.'`, return-the-input) and a
 * shared `dirname` would have changed three of them while fixing the separator.
 */
export function lastPathSeparatorIndex(path: string): number {
    const slash = path.lastIndexOf('/');
    if (!isWindowsPath(path)) return slash;
    return Math.max(slash, path.lastIndexOf('\\'));
}

/**
 * The path's components, in order, including empty ones — `split` on the separators
 * this path actually uses, for callers that must inspect each component (`NAME_MAX`).
 */
export function splitPathComponents(path: string): string[] {
    return isWindowsPath(path) ? path.split(/[\\/]/) : path.split('/');
}

/**
 * An ABSOLUTE path → the `file://` href naming it, percent-encoded.
 *
 * ```
 * /opt/app/dist        → file:///opt/app/dist
 * C:\app\dist          → file:///C:/app/dist
 * \\server\share\app   → file://server/share/app
 * ```
 *
 * The Windows forms are the WHATWG ones: a drive letter is part of the PATH behind an
 * empty host (three slashes), while a UNC server is the URL's HOST. `new URL()` accepts
 * `file://C:/x` and normalises it to `file:///C:/x` by the spec's drive-letter quirk,
 * but relying on that would leave `\` unconverted, so both are spelled out here.
 *
 * @param options.windows force the win32 reading of a path whose shape does not say
 *   (a relative path, or `/foo` on a win32 host) — the same escape hatch Node added to
 *   `pathToFileURL` in v22 (`refs/node/lib/internal/url.js`).
 */
export function pathToFileUrlHref(path: string, options?: { windows?: boolean }): string {
    const windows = options?.windows ?? isWindowsPath(path);
    const slashed = windows ? path.replace(/\\/g, '/') : path;

    if (windows && slashed.startsWith('//')) {
        // UNC: `//server/share/x` — the server is the URL's HOST and is not
        // path-encoded, so it is split off before the rest is.
        const hostEnd = slashed.indexOf('/', 2);
        const host = hostEnd === -1 ? slashed.slice(2) : slashed.slice(2, hostEnd);
        const rest = hostEnd === -1 ? '' : slashed.slice(hostEnd);
        return `file://${host}${encodePathForFileUrl(rest)}`;
    }

    // Three slashes total in every case: a drive path (`C:/app`) brings none of its own
    // and needs the empty host spelled out, while a path already rooted at `/` — POSIX,
    // or the driveless-but-rooted win32 form `\app\dist` — supplies the third itself.
    // Prepending unconditionally is how `file:////app/dist` gets built.
    const prefix = slashed.startsWith('/') ? 'file://' : 'file:///';
    return `${prefix}${encodePathForFileUrl(slashed)}`;
}

/**
 * Percent-encode a path for use as a URL path.
 *
 * An allowlist and not `encodeURI`, which leaves `#` and `?` intact — in a path those
 * are DATA, and letting them through hands the caller a URL whose fragment or query is
 * a piece of the filename.
 *
 * Iterated by CODE POINT, and encoded from UTF-8 bytes rather than with
 * `encodeURIComponent`: fed one half of a surrogate pair that function raises
 * `URIError: URI malformed`, so the index-based loop this replaced threw on every path
 * containing a non-BMP character (an emoji, a CJK extension ideograph) instead of
 * encoding it.
 */
export function encodePathForFileUrl(path: string): string {
    let result = '';
    for (const ch of path) {
        result += UNRESERVED_IN_FILE_PATH.test(ch) ? ch : percentEncode(ch);
    }
    return result;
}

/**
 * Measured against Node's `pathToFileURL` character by character over printable ASCII,
 * not derived from a spec table: `~` and `\` ARE percent-encoded there (`%7E`, `%5C`)
 * though a reading of the WHATWG path set suggests otherwise, and `.` is kept. Do not
 * "tidy" `~` back in — the divergence it removes is a real one.
 */
const UNRESERVED_IN_FILE_PATH = /^[A-Za-z0-9!$&'()*+,\-./:;=@_]$/;

function percentEncode(ch: string): string {
    let out = '';
    for (const byte of new TextEncoder().encode(ch)) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
    return out;
}
