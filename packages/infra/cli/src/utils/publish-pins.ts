/**
 * The intra-repo pins a publish is about to ship, enumerated from the manifest
 * PAIR — the workspace's own `package.json` and the rewritten one that comes
 * back out of the tarball.
 *
 * Why the pair and not just the rewritten manifest: after
 * `rewriteWorkspaceDeps` (see `commands/pack.ts`) a sibling pin is an ordinary
 * `^0.51.1` and indistinguishable from a third-party dependency. The `workspace:`
 * prefix survives only in the SOURCE manifest, so which edges are this repo's
 * own is a fact that exists in one file and the version they will ship at exists
 * in the other.
 */

/** The blocks `rewriteWorkspaceDeps` rewrites and a consumer install resolves. */
export type DependencyBlock = 'dependencies' | 'optionalDependencies' | 'peerDependencies';

const BLOCKS: readonly DependencyBlock[] = ['dependencies', 'optionalDependencies', 'peerDependencies'];

/**
 * The one block whose unresolvable edge fails EVERY consumer install.
 *
 * Measured, npm 11.17.0, against the live registry, on an edge to a name that
 * did not exist: `optionalDependencies` installs clean (exit 0, silently),
 * `dependencies` is `npm error 404`, exit 1. Yarn refuses both (`YN0035`),
 * which is why an optional edge is still reported — just not fatal.
 */
export const REQUIRED_BLOCK: DependencyBlock = 'dependencies';

export interface WorkspacePin {
    name: string;
    /** The concrete range the tarball will carry, after the rewrite. */
    spec: string;
    block: DependencyBlock;
}

const depsOf = (pkg: Record<string, unknown>, block: DependencyBlock): Record<string, string> => {
    const value = pkg[block];
    return value && typeof value === 'object' ? (value as Record<string, string>) : {};
};

/**
 * Every edge that was a `workspace:` spec before the rewrite, with the version
 * it will ship at.
 *
 * A name appearing in two blocks yields two pins: `dependencies` and
 * `optionalDependencies` do not cost the same at install time, so collapsing
 * them would throw away the distinction the caller decides on.
 */
export function collectWorkspacePins(
    source: Record<string, unknown>,
    rewritten: Record<string, unknown>,
): WorkspacePin[] {
    const pins: WorkspacePin[] = [];
    for (const block of BLOCKS) {
        const before = depsOf(source, block);
        const after = depsOf(rewritten, block);
        for (const [name, spec] of Object.entries(before)) {
            if (typeof spec !== 'string' || !spec.startsWith('workspace:')) continue;
            pins.push({ name, spec: after[name] ?? spec, block });
        }
    }
    return pins;
}
