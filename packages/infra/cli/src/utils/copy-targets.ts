// Target resolution for `gjsify copy` — the deciding half, kept pure.
//
// Same split as `clear-targets.ts`, for the same reason: the paths come from
// package.json files rather than from a human at a prompt, so "which file lands
// where" must be testable without a filesystem — including the cases that must
// be REFUSED, which cannot be proven by writing outside the working directory.
//
// See `commands/copy.ts` for why the command exists at all.

import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { hasWildcard, segmentToRegExp } from './clear-targets.js';

/** Everything {@link planCopy} needs from the outside world. */
export interface CopyContext {
    /** The package directory every DESTINATION must stay inside. */
    cwd: string;
    /** Directory listing, for wildcard expansion. Throws when absent — treated as "no matches". */
    readdir: (dir: string) => string[];
}

/** One resolved source → destination pair. Both absolute. */
export interface CopyOperation {
    from: string;
    to: string;
}

/**
 * Is the destination a DIRECTORY to copy into, rather than the target path?
 *
 * Decided from the ARGUMENTS ALONE — never from what is on disk. `cp` decides it
 * by stat'ing the destination, which is why `cp -r src/assets dist/res` copies
 * the directory to `dist/res` the first time and to `dist/res/assets` the
 * second: the same script means two different things depending on whether it has
 * run before. Four of the scripts this command replaces carry exactly that shape,
 * so they were already non-idempotent on Linux. A build step must not be.
 *
 * The rule, in full:
 *   - a trailing `/` (or `\`) on the destination — the explicit spelling;
 *   - more than one source;
 *   - any source carrying a wildcard.
 *
 * The last two are what keep the two platforms in agreement. A POSIX shell
 * expands `src/public/*` before gjsify is started (many sources); `cmd.exe` does
 * not expand anything and passes the pattern through (one source, a wildcard).
 * Both land in directory mode, so the same script means the same thing on both.
 */
export function isDirectoryDestination(sources: readonly string[], dest: string): boolean {
    if (dest.endsWith('/') || dest.endsWith('\\')) return true;
    if (sources.length > 1) return true;
    return sources.some((s) => hasWildcard(s));
}

/**
 * Reject a destination that is not inside `cwd`.
 *
 * A hard error, never a skip — the same posture as `clear`, for the mirrored
 * reason: `clear` must not DELETE outside the package, `copy` must not WRITE
 * outside it. `allowSelf` covers `gjsify copy ../shared/x.wasm ./`, where the
 * package root legitimately IS the destination directory.
 *
 * SOURCES are deliberately NOT checked. Three of the scripts this replaces read
 * from a sibling package (`../../../packages/infra/lightningcss-wasm/…`), which
 * is the normal shape for staging a workspace artifact, and reading is not the
 * dangerous direction.
 */
function assertWritableDestination(absolute: string, original: string, cwd: string, allowSelf: boolean): void {
    const rel = relative(cwd, absolute);
    if (rel === '') {
        if (allowSelf) return;
        throw new Error(
            `gjsify copy: "${original}" is the working directory itself. ` +
                'Name a file, or add a trailing "/" to copy INTO the directory.',
        );
    }
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new Error(
            `gjsify copy: "${original}" resolves to ${absolute}, outside the working directory ${cwd}. ` +
                'Only paths inside the package may be written.',
        );
    }
}

/**
 * Expand one source argument. A wildcard is honoured in the LAST segment only,
 * against a single directory read — the same restricted grammar `clear` uses,
 * and for the same reason: a build script names files, and `**` there would copy
 * more than its author can see at a glance.
 *
 * A pattern matching nothing yields NO operations. A literal path that does not
 * exist yields one operation, which then fails loudly in the copy itself — the
 * asymmetry is deliberate and mirrors the shell: `cp missing.html dist/` is an
 * error, `cp *.html dist/` on an empty directory is not.
 */
function expandSource(source: string, ctx: CopyContext): string[] {
    const leaf = basename(source);
    const parent = dirname(source);
    if (hasWildcard(parent)) {
        throw new Error(`gjsify copy: a wildcard is only supported in the last path segment — got "${source}".`);
    }
    if (!hasWildcard(leaf)) return [resolve(ctx.cwd, source)];
    const dir = resolve(ctx.cwd, parent);
    const re = segmentToRegExp(leaf);
    let names: string[];
    try {
        names = ctx.readdir(dir);
    } catch {
        return [];
    }
    return names
        .filter((name) => re.test(name))
        .sort()
        .map((name) => join(dir, name));
}

/**
 * Resolve `gjsify copy <sources…> <destination>` into the exact list of copies.
 *
 * ALL operations are planned before the caller performs any of them, so a bad
 * argument in position four cannot be discovered after three files have already
 * been written.
 */
export function planCopy(args: readonly string[], ctx: CopyContext): CopyOperation[] {
    if (args.length < 2) {
        throw new Error(
            'gjsify copy: needs at least one source and a destination. Usage: gjsify copy <sources…> <dest>',
        );
    }
    const sources = args.slice(0, -1);
    const dest = args[args.length - 1]!;
    if (dest === '') {
        throw new Error('gjsify copy: the destination is empty.');
    }

    const intoDirectory = isDirectoryDestination(sources, dest);
    const absDest = resolve(ctx.cwd, dest);
    assertWritableDestination(absDest, dest, ctx.cwd, intoDirectory);

    const expanded: string[] = [];
    for (const source of sources) {
        if (source === '') throw new Error('gjsify copy: a source path is empty.');
        expanded.push(...expandSource(source, ctx));
    }

    if (!intoDirectory && expanded.length !== 1) {
        // Only reachable when a single wildcard-free source expanded to something
        // other than one path, which cannot happen — but leaving it unstated would
        // make a future change to `expandSource` silently copy the wrong file.
        throw new Error(`gjsify copy: "${dest}" names a single destination, but ${expanded.length} sources resolved.`);
    }

    const ops: CopyOperation[] = [];
    const seenDest = new Set<string>();
    for (const from of expanded) {
        const to = intoDirectory ? join(absDest, basename(from)) : absDest;
        if (from === to) {
            throw new Error(`gjsify copy: "${from}" is its own destination.`);
        }
        if (seenDest.has(to)) {
            // Two sources with the same basename copied into one directory: the
            // second silently overwrites the first, and which one wins depends on
            // argument order. Name it instead.
            throw new Error(`gjsify copy: two sources would both be written to ${to}.`);
        }
        seenDest.add(to);
        ops.push({ from, to });
    }
    return ops;
}
