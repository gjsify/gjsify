// Creating a link to a DIRECTORY, portably.
//
// Windows cannot create a directory *symlink* without elevation or Developer Mode
// (`EPERM`), but any user can create an NTFS **junction**, which is why npm, yarn
// and pnpm all use junctions for directory links. Encoded as a local constant and
// shared nowhere, the next site got it wrong: `dlx-cache.ts` linked with `'dir'` and
// every non-elevated Windows user hit `EPERM: operation not permitted, symlink` on a
// plain `npx @gjsify/cli@latest showcase …`. Hence one callable definition rather
// than a convention.
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
// Autodetection is no substitute on Windows: with the type argument omitted Node
// picks `'file'` or `'dir'`, never `'junction'`.

import { readlinkSync, statSync, symlinkSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

/**
 * Which kind of directory link this platform uses.
 *
 * The POSIX case is spelled with a NAME rather than `undefined` so both branches
 * stay explicitly requestable: `dirLinkTarget` takes this as a DEFAULTED
 * parameter, and a defaulted parameter cannot receive `undefined` — passing it IS
 * how you ask for the host's kind. Spelled `undefined`, each branch was
 * unexercisable off its own platform while the suite read as if it covered both.
 */
export type DirLinkKind = 'junction' | 'symlink';

/** The link kind directory links use on this platform. */
export const DIR_LINK_KIND: DirLinkKind = process.platform === 'win32' ? 'junction' : 'symlink';

/**
 * The link type a directory link must pass to `fs.symlink` — `undefined` on POSIX,
 * where Node's default is correct. Derived from {@link DIR_LINK_KIND} so the
 * platform decision has exactly one source.
 */
export const DIR_LINK_TYPE: 'junction' | undefined = DIR_LINK_KIND === 'junction' ? 'junction' : undefined;

/** True when directory links on this platform are NTFS junctions. */
export const dirLinksAreJunctions = (): boolean => DIR_LINK_KIND === 'junction';

/**
 * Spell the `target` argument for a link at `linkPath` pointing at `absTarget`.
 *
 * Absolute on Windows because a junction demands it (gotcha 1 above); relative
 * on POSIX so the tree stays movable (gotcha 2).
 *
 * `linkKind` is a PARAMETER, defaulting to the host's, for the same reason
 * `detect-native-packages.ts` takes `platform`/`arch`: the Windows branch is then
 * unit-testable from a Linux host, the only place anyone runs the tests.
 *
 * BOTH paths must be in the SAME canonical space. The POSIX target is relative to
 * the link's own directory, but the kernel resolves it from the link's REAL
 * directory, so mixing the two yields a link pointing nowhere. macOS is where this
 * bites: `os.tmpdir()` is `/var/folders/…` and `/var` is a symlink to
 * `/private/var`, so a `linkPath` from `tmpdir()` and an `absTarget` that went
 * through `realpathSync` disagree and the relative path between them walks out of
 * the real tree. `realpathSync` whichever side is not already canonical.
 *
 * @param absTarget the directory it should point at, as an ABSOLUTE path
 * @param linkKind  override the host's link kind (tests only)
 */
export function dirLinkTarget(linkPath: string, absTarget: string, linkKind: DirLinkKind = DIR_LINK_KIND): string {
    return linkKind === 'junction' ? resolve(absTarget) : relative(dirname(linkPath), absTarget);
}

/**
 * Link `linkPath` → `absTarget`, choosing symlink-vs-junction and the target
 * spelling for the host. A relative `absTarget` is gotcha 1 and would only misbehave
 * on Windows, so it is rejected on every platform rather than left to surface on the
 * one host nobody tests on.
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
 * Cannot reuse {@link linkDirSync}: the source link's target is whatever it
 * already is — frequently relative, deliberately so — while a junction demands an
 * absolute one, so copying verbatim is right on POSIX and wrong on Windows the
 * moment the target is a directory. The target's KIND therefore decides: a link to
 * a directory becomes a junction with the target resolved against the source
 * link's own directory (gotcha 1); anything else stays a plain file symlink, which
 * Windows allows unprivileged. A dangling source link keeps the verbatim target —
 * guessing a kind for it would turn a faithful copy into a fabrication.
 *
 * Primitive fs ops only: this runs under the GJS facade as well as Node, hence no
 * `fs.cp`/`opendir`.
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
