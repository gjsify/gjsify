// How was THIS gjsify installed?
//
// `self-update` re-runs the `gjsify install -g` pipeline, which writes into the
// user-global XDG prefix. That is correct for an install that came from
// `install.mjs` or `gjsify install -g`, and WRONG for one a package manager owns:
// it would lay a second copy into `~/.local` that shadows — or is shadowed by —
// the one apt/dnf/flatpak is tracking, and the package manager would then be
// managing a file the user no longer runs. The next `apt upgrade` reverts or
// diverges, silently, and "I updated it and nothing changed" is the report.
//
// Before `gjsify ship` there was only one non-XDG case worth naming (`npm -g`),
// and the command warned and continued. Now that gjsify ships as `.deb`, `.rpm`
// and Flatpak, continuing is the defect. So the question gets a real answer, and
// the answer carries the command the user should run instead.
//
// Everything here is derived from where the RUNNING code sits, never from a
// build-time constant: one tarball is unpacked by all of these routes, so a flag
// baked at build time would describe the builder rather than the installation.

import { isAbsolute, resolve, sep } from 'node:path';

/** Where the running CLI came from. */
export type InstallProvenanceKind =
    /** `install.mjs` or `gjsify install -g` — the layout `self-update` manages. */
    | 'xdg-global'
    /** Inside a Flatpak sandbox. */
    | 'flatpak'
    /** A distro package (`.deb`/`.rpm`) staged under a system prefix. */
    | 'system-package'
    /** `npm install -g` (or yarn/pnpm global) — a `node_modules` tree elsewhere. */
    | 'npm-global'
    /** A checkout, a container image, an unpacked tarball — anything else. */
    | 'unknown';

export interface InstallProvenance {
    kind: InstallProvenanceKind;
    /** What the decision was made ON, so a wrong verdict is debuggable. */
    evidence: string;
    /** How the user should update, when it is not `self-update`'s job. */
    updateWith?: string;
    /** True when `self-update` must refuse rather than write the XDG prefix. */
    managedElsewhere: boolean;
}

/** System prefixes a distro package stages into. POSIX only — win32 handled separately. */
const SYSTEM_PREFIXES = ['/usr/', '/opt/', '/snap/'];

/** Inside a Flatpak the whole app tree lives under this prefix. */
const FLATPAK_PREFIX = '/app/';

/** Does `child` sit inside `parent`? Both must be absolute and already resolved. */
function isInside(child: string, parent: string): boolean {
    if (!isAbsolute(child) || !isAbsolute(parent)) return false;
    const p = parent.endsWith(sep) ? parent : parent + sep;
    return child === parent || child.startsWith(p);
}

export interface ProvenanceInput {
    /** Absolute path of the running CLI's own package directory. */
    selfDir: string;
    /** `defaultGlobalLayout().prefix` — the layout `self-update` owns. */
    xdgPrefix: string;
    env?: Record<string, string | undefined>;
    platform?: NodeJS.Platform;
}

/**
 * Classify an installation from its path and environment.
 *
 * ORDER MATTERS and is not alphabetical:
 *
 *  1. **Flatpak first.** Its `/app` prefix would also satisfy no other test, but
 *     `FLATPAK_ID` is the unambiguous signal and is present even when the tree is
 *     mounted somewhere unusual.
 *  2. **XDG before system.** The XDG prefix is under `$HOME`, so it can never be
 *     `/usr` — but a user whose `$HOME` is `/opt/someuser` exists, and asking the
 *     narrow question first means that user is not told to run `dnf`.
 *  3. **System before npm.** A `.deb` stages a `node_modules`-shaped tree under
 *     `/usr/lib`, so the npm test alone would claim it.
 */
export function classifyInstall(input: ProvenanceInput): InstallProvenance {
    const env = input.env ?? process.env;
    const platform = input.platform ?? process.platform;
    const selfDir = resolve(input.selfDir);

    if (env.FLATPAK_ID || isInside(selfDir, FLATPAK_PREFIX)) {
        const id = env.FLATPAK_ID ?? 'io.github.gjsify.Cli';
        return {
            kind: 'flatpak',
            evidence: env.FLATPAK_ID ? `FLATPAK_ID=${env.FLATPAK_ID}` : `running from ${FLATPAK_PREFIX}`,
            updateWith: `flatpak update ${id}`,
            managedElsewhere: true,
        };
    }

    if (isInside(selfDir, resolve(input.xdgPrefix))) {
        return {
            kind: 'xdg-global',
            evidence: `running from the user-global prefix ${input.xdgPrefix}`,
            managedElsewhere: false,
        };
    }

    if (platform !== 'win32' && SYSTEM_PREFIXES.some((p) => isInside(selfDir, p))) {
        return {
            kind: 'system-package',
            evidence: `running from the system prefix ${selfDir}`,
            // Not `apt` or `dnf` specifically: the same path serves both, and
            // guessing wrong sends the user to a package manager that does not
            // know this file. The release assets are named because they are the
            // one answer that is true on every distribution.
            updateWith:
                'your distribution package manager (`apt upgrade` / `dnf upgrade` / …), or install the newer package from ' +
                'https://github.com/gjsify/gjsify/releases/latest',
            managedElsewhere: true,
        };
    }

    if (selfDir.split(sep).includes('node_modules')) {
        return {
            kind: 'npm-global',
            evidence: `running from a node_modules tree at ${selfDir}`,
            updateWith: 'npm install -g @gjsify/cli@latest (or switch to the Node-free bootstrap)',
            managedElsewhere: true,
        };
    }

    return {
        kind: 'unknown',
        evidence: `running from ${selfDir}, which matches no known install layout`,
        managedElsewhere: false,
    };
}
