// Creating a link to a DIRECTORY, portably.
//
// WHY THIS FILE EXISTS. Windows cannot create a directory *symlink* without
// elevation or Developer Mode — the call fails with `EPERM` — but any user can
// create an NTFS **junction**, which is why npm, yarn and pnpm all use junctions
// for directory links. `commands/install.ts` learned that and encoded it, twice,
// as a local constant for its workspace links. Nothing shared it, so the next
// site to link a directory got it wrong: `dlx-cache.ts` linked with `'dir'` and
// every non-elevated Windows user hit
//
//     Could not resolve showcase "canvas2d-fireworks": EPERM: operation not
//     permitted, symlink '…\<prepare-dir>' -> '…\pkg.tmp-…'
//
// on a plain `npx @gjsify/cli@latest showcase …`. The knowledge existed in the
// repo and the bug shipped anyway, which is the argument for a single callable
// definition rather than a convention.
//
// THE TWO GOTCHAS, both load-bearing:
//
//  1. **A junction target must be ABSOLUTE.** Node normalises a `'junction'`
//     target with `path.resolve()` — against the process CWD, NOT against the
//     link's own directory. A relative target that looks right produces a
//     junction pointing somewhere else entirely, and only on Windows.
//  2. **POSIX targets should stay RELATIVE** where the caller wants a movable
//     tree: a relative symlink survives the whole tree being moved or mounted
//     elsewhere. So the target spelling is per-platform, not one string.
//
// Autodetection is NOT a substitute. Node picks `'file'` or `'dir'` when the
// type argument is omitted — never `'junction'` — so an omitted type is the
// failing case, not the safe default.

import { readlinkSync, statSync, symlinkSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

/**
 * The link type a directory link must use on this platform.
 *
 * `undefined` on POSIX is deliberate: Node's default is correct there, and
 * passing a type would be noise.
 */
export const DIR_LINK_TYPE: 'junction' | undefined = process.platform === 'win32' ? 'junction' : undefined;

/** True when directory links on this platform are NTFS junctions. */
export const dirLinksAreJunctions = (): boolean => DIR_LINK_TYPE === 'junction';

/**
 * Spell the `target` argument for a link at `linkPath` pointing at `absTarget`.
 *
 * Absolute on Windows because a junction demands it (gotcha 1 above); relative
 * on POSIX so the tree stays movable (gotcha 2).
 *
 * `linkType` is a PARAMETER, defaulting to the host's, for the same reason
 * `detect-native-packages.ts` takes `platform`/`arch`: the Windows branch is
 * then unit-testable from a Linux host, which is the only place anyone runs the
 * tests. A branch nobody can exercise is how the `'dir'` bug survived to a
 * release.
 *
 * BOTH paths must be in the SAME canonical space — either both canonical or
 * both spelled through the same symlinks. The POSIX target is relative to the
 * link's own directory, but the kernel resolves it from the link's REAL
 * directory, so mixing the two spaces yields a link that points nowhere. macOS
 * is where this actually happens: `os.tmpdir()` is `/var/folders/…` and `/var`
 * is a symlink to `/private/var`, so a `linkPath` built from `tmpdir()` and an
 * `absTarget` that has been through `realpathSync` disagree, and the relative
 * path between them walks out of the real tree. `realpathSync` whichever side
 * is not already canonical before calling this.
 *
 * @param linkPath  where the link itself will live
 * @param absTarget the directory it should point at, as an ABSOLUTE path
 * @param linkType  override the host's link type (tests only)
 */
export function dirLinkTarget(
    linkPath: string,
    absTarget: string,
    linkType: 'junction' | undefined = DIR_LINK_TYPE,
): string {
    return linkType === 'junction' ? resolve(absTarget) : relative(dirname(linkPath), absTarget);
}

/**
 * Link `linkPath` → `absTarget`, choosing symlink-vs-junction and the target
 * spelling for the host.
 *
 * `absTarget` must be absolute; passing a relative path is the mistake gotcha 1
 * describes, and it would only misbehave on Windows, so it is rejected here on
 * every platform rather than left to surface on the one host nobody tests on.
 */
export function linkDirSync(linkPath: string, absTarget: string): void {
    assertAbsolute(absTarget);
    symlinkSync(dirLinkTarget(linkPath, absTarget), linkPath, DIR_LINK_TYPE);
}

/** Promise-returning twin of {@link linkDirSync}. */
export async function linkDir(linkPath: string, absTarget: string): Promise<void> {
    assertAbsolute(absTarget);
    await symlink(dirLinkTarget(linkPath, absTarget), linkPath, DIR_LINK_TYPE);
}

/**
 * Recreate an EXISTING link at a new path, preserving what it points at.
 *
 * A different job from {@link linkDirSync}, and it cannot reuse it: the source
 * link's target is whatever it already is — frequently relative, deliberately so
 * — while a junction demands an absolute one. Copying the target verbatim is
 * therefore right on POSIX and wrong on Windows the moment the target is a
 * directory.
 *
 * So the target's KIND decides: a link to a directory becomes a junction with
 * the target resolved against the source link's own directory (the resolution
 * Node will not do for you — see gotcha 1 above); anything else stays a plain
 * file symlink, which Windows allows unprivileged.
 *
 * A dangling source link keeps the verbatim target: it points nowhere either
 * way, and guessing a kind for it would turn a faithful copy into a fabrication.
 *
 * Primitive fs ops only — this runs under the GJS facade as well as Node, which
 * is why there is no `fs.cp`/`opendir` here.
 */
export function replicateLinkSync(srcLink: string, dstLink: string): void {
    const rawTarget = readlinkSync(srcLink);
    if (!dirLinksAreJunctions()) {
        symlinkSync(rawTarget, dstLink);
        return;
    }
    const resolvedTarget = resolve(dirname(srcLink), rawTarget);
    let targetIsDir: boolean;
    try {
        targetIsDir = statSync(resolvedTarget).isDirectory();
    } catch {
        // Dangling — copy it as-is rather than inventing a kind for it.
        symlinkSync(rawTarget, dstLink);
        return;
    }
    if (targetIsDir) symlinkSync(resolvedTarget, dstLink, 'junction');
    else symlinkSync(rawTarget, dstLink, 'file');
}

function assertAbsolute(absTarget: string): void {
    if (resolve(absTarget) !== absTarget) {
        throw new TypeError(
            `linkDir: target must be an absolute path, got ${JSON.stringify(absTarget)}. ` +
                'Node resolves a Windows junction target against the process CWD rather than the ' +
                "link's own directory, so a relative target silently points somewhere else there.",
        );
    }
}
