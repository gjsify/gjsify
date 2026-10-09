// `--focus <workspace…>` for `gjsify install` and `gjsify flatpak sources`
// (ADR 0102): act on the named workspaces, the workspaces they depend on, and the
// external packages those need — as if they were the only members of the monorepo.
//
// THE MANIFEST HALF lives here; the LOCKFILE HALF (`reachableInstallPaths`) lives in
// `install-backend-native.ts` beside `computeOptionalFlags`, because it reads the same
// graph through the same private helpers. `gjsify-lock.json` records package → package
// edges but no workspace → package edges, so the seeds of the walk come from the
// manifests (on disk wherever either command runs) and the lockfile only continues it.
//
// ONE classifier decides what a dependency IS, and `workspaceInstallLocked` uses the
// same one for the full install. The closure and the install cannot disagree about
// whether `@scope/foo: ^1.0.0` is a workspace edge or a registry package, and that
// agreement is what lets `flatpak sources --focus` fill exactly the cache the focused
// install later reads. `@gjsify/workspace`'s `buildDependencyGraph` is deliberately not
// used: it decides by "does the member's version satisfy the range", this installer by
// NAME (a name-matched member is always symlinked — install.ts, `localWorkspace`).

import type { Workspace } from '@gjsify/workspace';

/** The three blocks `gjsify install` reads from a member; same list as install.ts. */
export const DEPENDENCY_BLOCKS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

/** Protocols that opt a dependency out of both the workspace link and the registry. */
const EXPLICIT_PROTOCOL = /^(link|file|portal|git\+|https?):/;

export type DependencyClass =
    | { kind: 'workspace'; target: Workspace }
    /** `workspace:` against a name that is not a member: a typo or a missing package. */
    | { kind: 'missing-workspace' }
    /** `link:`/`file:`/`portal:`/`git+`/`http(s):` — neither linked nor fetched. */
    | { kind: 'ignored' }
    | { kind: 'external' };

/**
 * What a `name: spec` entry of a member's manifest is. A name that matches a member is
 * the member whatever the spec form (`workspace:`, `^1.2.3`, a dist-tag) — only an
 * explicit out-of-workspace protocol opts out — because routing it to the registry would
 * unpack a published tarball over the member's own source tree.
 */
export function classifyDependency(
    depName: string,
    spec: string,
    byName: ReadonlyMap<string, Workspace>,
): DependencyClass {
    const target = byName.get(depName);
    if (target && !EXPLICIT_PROTOCOL.test(spec)) return { kind: 'workspace', target };
    if (spec.startsWith('workspace:')) return { kind: 'missing-workspace' };
    if (EXPLICIT_PROTOCOL.test(spec)) return { kind: 'ignored' };
    return { kind: 'external' };
}

export interface FocusPlan {
    /** The closure, in discovery order: the named workspaces and everything they depend on. */
    workspaces: Workspace[];
    /** `"<name>@<range>"` of every external dependency the closure's manifests declare. */
    specs: string[];
}

/** At most this many known names are listed in the unknown-name error. */
const KNOWN_NAMES_SHOWN = 20;

/**
 * Resolve `--focus` names to the workspace closure and its external specs.
 *
 * Throws naming every unknown workspace — a typo must not become an install of
 * nothing. Names are exact package names, the spelling the rest of the CLI uses; the
 * root is a member like any other (Yarn's `workspaces focus` rule) and is in the
 * closure only when named or depended on. A root without a `name` cannot be named.
 *
 * @param command label for error messages, e.g. `gjsify install`.
 */
export function planFocus(workspaces: readonly Workspace[], focus: readonly string[], command: string): FocusPlan {
    const byName = new Map(workspaces.map((w) => [w.name, w] as const));
    const unknown = [...new Set(focus)].filter((name) => !byName.has(name));
    if (unknown.length > 0) {
        const known = [...byName.keys()].sort();
        const shown = known.slice(0, KNOWN_NAMES_SHOWN).join(', ');
        const more = known.length > KNOWN_NAMES_SHOWN ? `, … (${known.length - KNOWN_NAMES_SHOWN} more)` : '';
        throw new Error(
            `${command}: --focus names unknown workspace(s): ${unknown.join(', ')}. ` +
                `Pass a package name from a workspace's package.json. Known workspaces: ${shown}${more}.`,
        );
    }

    // A Set grows while iterated, so each pass visits what the previous one added.
    const closure = new Set<Workspace>(focus.map((name) => byName.get(name) as Workspace));
    const specs = new Set<string>();
    for (const ws of closure) {
        for (const block of DEPENDENCY_BLOCKS) {
            for (const [depName, spec] of Object.entries(ws.manifest[block] ?? {})) {
                if (typeof spec !== 'string') continue;
                const cls = classifyDependency(depName, spec, byName);
                if (cls.kind === 'workspace') closure.add(cls.target);
                else if (cls.kind === 'external') specs.add(`${depName}@${spec}`);
            }
        }
    }
    return {
        workspaces: workspaces.filter((w) => closure.has(w)),
        specs: [...specs],
    };
}
