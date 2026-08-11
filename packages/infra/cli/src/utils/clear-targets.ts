// Target resolution for `gjsify clear` — the safety-critical half, kept pure.
//
// A recursive delete driven by strings from every workspace's package.json is a footgun, so
// the "which paths does this actually delete" decision lives here with the directory read
// INJECTED. That makes every rule below unit-testable without a real filesystem, which is the
// point: the tests that matter are the ones for paths that must be REFUSED, and creating a
// fixture outside the cwd to prove that is exactly what a test must not do.
//
// See `commands/clear.ts` for why the command exists at all.

import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Everything {@link resolveClearTargets} needs from the outside world. */
export interface ClearContext {
    /** The package directory every target must stay inside. */
    cwd: string;
    /** Directory listing, for wildcard expansion. Throws when absent — treated as "nothing to clear". */
    readdir: (dir: string) => string[];
}

/**
 * Does this path segment carry a shell wildcard?
 *
 * `*` and `?` only — what `rm -rf *.log` used. Deliberately NOT a glob engine: a `clear` script
 * names build output, and `**` or character classes would let a line delete more than its
 * author can see at a glance.
 */
export function hasWildcard(segment: string): boolean {
    return segment.includes('*') || segment.includes('?');
}

/** Compile one wildcard segment to an anchored regex, escaping every other metachar. */
export function segmentToRegExp(segment: string): RegExp {
    const body = segment
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/\\\\]*')
        .replace(/\?/g, '[^/\\\\]');
    return new RegExp(`^${body}$`);
}

/**
 * Reject a target that is not strictly inside `cwd`.
 *
 * A hard error, never a skip: a typo that would otherwise delete a sibling package — or
 * `$HOME` — must not depend on anyone reading a warning mid-`foreach` across every workspace.
 */
function assertInsideCwd(absolute: string, original: string, cwd: string): void {
    const rel = relative(cwd, absolute);
    if (rel === '') {
        throw new Error(`gjsify clear: refusing to delete the working directory itself ("${original}").`);
    }
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new Error(
            `gjsify clear: "${original}" resolves to ${absolute}, outside the working directory ${cwd}. ` +
                'Only paths inside the package may be cleared.',
        );
    }
}

/**
 * Expand and validate every target, resolving wildcards against `readdir`.
 *
 * ALL targets are resolved before the caller deletes any — a typo in the fourth path must not
 * be discovered after the first three are gone. A wildcard is honoured in the LAST segment
 * only, matched against a single directory read: shell semantics without recursive traversal.
 * A pattern matching nothing yields no targets, which is `rm -rf --force`'s behaviour and why a
 * package that was never built clears cleanly.
 */
export function resolveClearTargets(paths: readonly string[], ctx: ClearContext): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const target of paths) {
        for (const absolute of expandTarget(target, ctx)) {
            assertInsideCwd(absolute, target, ctx.cwd);
            if (seen.has(absolute)) continue;
            seen.add(absolute);
            out.push(absolute);
        }
    }
    return out;
}

function expandTarget(target: string, ctx: ClearContext): string[] {
    const leaf = basename(target);
    const parent = dirname(target);
    // Checked BEFORE the no-wildcard shortcut: `*/dist` has a wildcard-free basename, and
    // treating it as a literal path would silently delete nothing instead of telling the
    // author the shape is unsupported.
    if (hasWildcard(parent)) {
        throw new Error(`gjsify clear: a wildcard is only supported in the last path segment — got "${target}".`);
    }
    if (!hasWildcard(leaf)) return [resolve(ctx.cwd, target)];
    // The parent is validated too: `../*.log` is only refused if the containing DIRECTORY is
    // checked against cwd before expansion — the matches themselves are all inside it.
    const dir = resolve(ctx.cwd, parent);
    assertInsideCwdOrSelf(dir, target, ctx.cwd);
    const re = segmentToRegExp(leaf);
    let names: string[];
    try {
        names = ctx.readdir(dir);
    } catch {
        // Absent or unreadable containing directory — nothing to clear, like `rm -rf` on a
        // missing path. A permission problem on an EXISTING target still surfaces from the delete.
        return [];
    }
    return names
        .filter((name) => re.test(name))
        .sort()
        .map((name) => join(dir, name));
}

/**
 * Like {@link assertInsideCwd} but tolerates `cwd` itself — a wildcard's PARENT
 * legitimately is the package root (`*.log`), while a wildcard's MATCH can never
 * be (it always has a name appended).
 */
function assertInsideCwdOrSelf(absolute: string, original: string, cwd: string): void {
    if (relative(cwd, absolute) === '') return;
    assertInsideCwd(absolute, original, cwd);
}
