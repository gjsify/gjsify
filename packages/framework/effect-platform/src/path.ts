// SPDX-License-Identifier: MIT
//
// `effect/Path` over GLib.
//
// WHY NOT JUST USE `NodePath.layer`. It works on GJS, and this repo's integration
// suite holds it there. But four of these operations are GLib's own, and a GNOME app
// that already links GLib should not carry a second implementation of them:
//
//   sep          `GLib.DIR_SEPARATOR_S`, the platform's separator as GLib sees it
//   join         `g_build_filenamev`, which collapses repeated separators
//   resolve      `g_canonicalize_filename`, which is also how GIO reads a path
//   from/toFileUrl  `g_filename_{from,to}_uri`, the encoding GIO itself round-trips
//
// AND WHY THE REST IS NOT GLib'S, which is the part that had to be learned. GLib has
// `g_path_get_basename` and `g_path_get_dirname`, and they are NOT `path.posix`:
// they are filename helpers with their own answers, and `effect/Path` is specified
// as Node's. Measured against `node:path` over one corpus — `basename('')` is `.`
// where Node says `''`; `basename('/')` is `/`; `dirname('a/b/')` is `a/b` where
// Node says `a`. Every one of those is a plausible answer that silently differs, so
// `basename`, `dirname`, `extname`, `parse`, `format`, `relative` and `normalize` are
// written here against Node's rules, and
// `tests/integration/effect/src/path-differential.spec.ts` holds every operation
// against `node:path` so the next such difference is a red test rather than a
// surprise in a consumer.
//
// WHAT `g_canonicalize_filename` DOES AND DOES NOT DO. It removes `.`, resolves
// `..` textually and makes the result absolute against a base. It does NOT follow
// symbolic links, which is why `filesystem.ts` refuses to offer `realPath` rather
// than building it on this. `resolve` wants exactly the textual behaviour.

import GLib from 'gi://GLib?version=2.0';

import { Effect, Layer } from 'effect';
import { Path, TypeId } from 'effect/Path';
import { BadArgument } from 'effect/PlatformError';

const SEP = GLib.DIR_SEPARATOR_S;

const isAbsolute = (path: string): boolean => GLib.path_is_absolute(path);

/** `g_build_filenamev` on the non-empty segments; `''` for none, as Node does. */
const join = (...paths: ReadonlyArray<string>): string => {
    const parts = paths.filter((part) => part.length > 0);
    if (parts.length === 0) return '.';
    return normalize(GLib.build_filenamev(parts as string[]));
};

/** `.`/`..` removed and the result made absolute, without touching the disk. */
const resolve = (...segments: ReadonlyArray<string>): string => {
    let result = GLib.get_current_dir();
    for (const segment of segments) {
        if (segment.length === 0) continue;
        result = isAbsolute(segment) ? segment : GLib.build_filenamev([result, segment]);
    }
    // `g_canonicalize_filename` keeps a leading `//`, which POSIX leaves
    // implementation-defined and Node collapses. Node is the contract here.
    return GLib.canonicalize_filename(result, null).replace(/^\/\/+/, SEP);
};

/**
 * `.` and `..` resolved textually, written out rather than delegated.
 *
 * `g_canonicalize_filename` is the obvious delegate and it is the wrong one for a
 * RELATIVE path: it always returns an absolute result, so an earlier version
 * canonicalized against a marker directory and stripped the marker back off. That
 * works until the path climbs out of the marker — measured,
 * `canonicalize_filename('../x', '/marker')` is `/x`, so `normalize('../x')` came
 * back `/x` where Node says `../x`, and `join('..', 'x')` yielded an ABSOLUTE path
 * pointing somewhere else entirely. A leading `..` on a relative path has to
 * survive, and no depth of marker makes that true; the POSIX rule is short enough
 * to state directly.
 */
const normalize = (path: string): string => {
    if (path.length === 0) return '.';
    const absolute = isAbsolute(path);
    const trailing = path.length > 1 && path.endsWith(SEP);
    const out: Array<string> = [];
    for (const part of path.split(SEP)) {
        if (part === '' || part === '.') continue;
        if (part !== '..') {
            out.push(part);
            continue;
        }
        if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
        // A `..` above the root is dropped; one above a relative path is KEPT,
        // because `../x` names a real place and `/../x` does not.
        else if (!absolute) out.push('..');
    }
    const joined = out.join(SEP);
    if (absolute) return trailing && joined.length > 0 ? `${SEP}${joined}${SEP}` : `${SEP}${joined}`;
    if (joined.length === 0) return '.';
    return trailing ? `${joined}${SEP}` : joined;
};

/** The last segment, trailing separators ignored; `''` for a path that has none. */
const basename = (path: string, suffix?: string): string => {
    const trimmed = path.replace(/\/+$/, '');
    const base = trimmed.slice(trimmed.lastIndexOf(SEP) + 1);
    return suffix !== undefined && suffix !== base && base.endsWith(suffix)
        ? base.slice(0, base.length - suffix.length)
        : base;
};

/** Everything before the last segment; `.` when there is nothing before it. */
const dirname = (path: string): string => {
    if (path.length === 0) return '.';
    const absolute = isAbsolute(path);
    const trimmed = path.replace(/\/+$/, '');
    if (trimmed.length === 0) return SEP;
    const cut = trimmed.lastIndexOf(SEP);
    if (cut < 0) return '.';
    if (cut === 0) return SEP;
    return absolute || cut > 0 ? trimmed.slice(0, cut) : '.';
};

/**
 * The final `.` and everything after it.
 *
 * `''` when the name has no dot, when the dot is the first character (a dotfile),
 * and when the name is `.` or `..` — the last of which GLib-derived arithmetic gets
 * wrong, returning `.` for `..`.
 */
const extname = (path: string): string => {
    const base = basename(path);
    if (base === '.' || base === '..') return '';
    const dot = base.lastIndexOf('.');
    return dot <= 0 ? '' : base.slice(dot);
};

const parse = (path: string): Path.Parsed => {
    const root = isAbsolute(path) ? SEP : '';
    const base = basename(path);
    const ext = extname(path);
    // Node's `dir` is `''` for a bare name and for the empty path — NOT `.`, which
    // is what `dirname` answers for the same input. The two are different questions.
    const cut = path.replace(/\/+$/, '').lastIndexOf(SEP);
    const dir = base.length === 0 ? (root === SEP ? SEP : '') : cut <= 0 ? root : path.slice(0, cut);
    return {
        root,
        dir,
        base,
        ext,
        name: ext.length === 0 ? base : base.slice(0, base.length - ext.length),
    };
};

const format = (parsed: Partial<Path.Parsed>): string => {
    const base = parsed.base ?? `${parsed.name ?? ''}${parsed.ext ?? ''}`;
    const dir = parsed.dir ?? parsed.root ?? '';
    if (dir.length === 0) return base;
    // `dir` already ENDS in the separator when it IS the root, so joining with
    // another one would produce `//x`.
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
