// SPDX-License-Identifier: MIT
//
// `effect/Path` over GLib.
//
// WHY NOT JUST USE `NodePath.layer`. It works on GJS, and this repo's integration
// suite holds it there. But four of these operations are GLib's own, and a GNOME
// app that already links GLib should not be carrying a second implementation of
// them:
//
//   sep          `GLib.DIR_SEPARATOR_S`, the platform's separator as GLib sees it
//   join         `g_build_filenamev`, which collapses repeated separators
//   resolve      `g_canonicalize_filename`, which is also how GIO reads a path
//   from/toFileUrl  `g_filename_{from,to}_uri`, the encoding GIO itself round-trips
//
// The rest is string work with no GLib counterpart, written out below. That split
// is the honest shape of the thing: GLib is a filename library, not a path library.
//
// WHAT `g_canonicalize_filename` DOES AND DOES NOT DO. It removes `.`, resolves
// `..` textually and makes the result absolute against a base. It does NOT follow
// symbolic links, which is why `filesystem.ts` refuses to offer `realPath` rather
// than building it on this. `normalize` and `resolve` want exactly the textual
// behaviour, so here it is the right function and there it was the wrong one.

import GLib from 'gi://GLib?version=2.0';

import { Effect, Layer } from 'effect';
import { Path, TypeId } from 'effect/Path';
import { BadArgument } from 'effect/PlatformError';

const SEP = GLib.DIR_SEPARATOR_S;

const isAbsolute = (path: string): boolean => GLib.path_is_absolute(path);

/** `g_build_filenamev` on the non-empty segments; `''` for none, as Node does. */
const join = (...paths: ReadonlyArray<string>): string => {
    const parts = paths.filter((part) => part.length > 0);
    if (parts.length === 0) return '';
    return normalize(GLib.build_filenamev(parts as string[]));
};

/** `.`/`..` removed and the result made absolute, without touching the disk. */
const resolve = (...segments: ReadonlyArray<string>): string => {
    let result = GLib.get_current_dir();
    for (const segment of segments) {
        if (segment.length === 0) continue;
        result = isAbsolute(segment) ? segment : GLib.build_filenamev([result, segment]);
    }
    return GLib.canonicalize_filename(result, null);
};

/**
 * Node keeps a relative path relative; `g_canonicalize_filename` always returns an
 * absolute one. So a relative input is canonicalized against a marker directory
 * that cannot occur in a real path, and the marker is then stripped back off.
 */
const RELATIVE_BASE = '/effect-gio-relative';

const normalize = (path: string): string => {
    if (path.length === 0) return '.';
    if (isAbsolute(path)) return GLib.canonicalize_filename(path, null);
    const canonical = GLib.canonicalize_filename(path, RELATIVE_BASE);
    if (canonical === RELATIVE_BASE) return '.';
    return canonical.startsWith(`${RELATIVE_BASE}${SEP}`)
        ? canonical.slice(RELATIVE_BASE.length + SEP.length)
        : canonical;
};

const basename = (path: string, suffix?: string): string => {
    const base = GLib.path_get_basename(path);
    return suffix !== undefined && suffix !== base && base.endsWith(suffix)
        ? base.slice(0, base.length - suffix.length)
        : base;
};

const dirname = (path: string): string => GLib.path_get_dirname(path);

/** The final `.` and everything after it, `''` when the name has none or starts with one. */
const extname = (path: string): string => {
    const base = basename(path);
    const dot = base.lastIndexOf('.');
    return dot <= 0 ? '' : base.slice(dot);
};

const parse = (path: string): Path.Parsed => {
    const base = basename(path);
    const ext = extname(path);
    return {
        root: isAbsolute(path) ? SEP : '',
        dir: dirname(path),
        base,
        ext,
        name: ext.length === 0 ? base : base.slice(0, base.length - ext.length),
    };
};

const format = (parsed: Partial<Path.Parsed>): string => {
    const base = parsed.base ?? `${parsed.name ?? ''}${parsed.ext ?? ''}`;
    const dir = parsed.dir ?? parsed.root ?? '';
    if (dir.length === 0) return base;
    return dir === parsed.root ? `${dir}${base}` : `${dir}${SEP}${base}`;
};

const relative = (from: string, to: string): string => {
    const fromParts = resolve(from).split(SEP).filter(Boolean);
    const toParts = resolve(to).split(SEP).filter(Boolean);
    let shared = 0;
    while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) shared++;
    const up = Array<string>(fromParts.length - shared).fill('..');
    return [...up, ...toParts.slice(shared)].join(SEP);
};

const fromFileUrl = (url: URL): Effect.Effect<string, BadArgument> =>
    Effect.try({
        // `g_filename_from_uri` returns `[filename, hostname]` and raises on a
        // non-`file:` scheme, which is the same refusal Node's `fileURLToPath`
        // makes and the one `@effect/platform`'s own Path test asserts.
        try: () => GLib.filename_from_uri(url.href)[0],
        catch: (cause) => new BadArgument({ module: 'Path', method: 'fromFileUrl', cause }),
    });

const toFileUrl = (path: string): Effect.Effect<URL, BadArgument> =>
    Effect.try({
        try: () => new URL(GLib.filename_to_uri(resolve(path), null)),
        catch: (cause) => new BadArgument({ module: 'Path', method: 'toFileUrl', cause }),
    });

/** Provide the GLib-backed `Path` to a program. */
export const layer: Layer.Layer<Path> = Layer.succeed(Path)({
    [TypeId]: TypeId,
    sep: SEP,
    basename,
    dirname,
    extname,
    format,
    fromFileUrl,
    isAbsolute,
    join,
    normalize,
    parse,
    relative,
    resolve,
    toFileUrl,
    // POSIX has no namespaced form; GLib offers none either. Node's own POSIX
    // implementation is the identity here, so this agrees with it rather than
    // pretending the concept exists.
    toNamespacedPath: (path: string) => path,
});
