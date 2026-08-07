// Workspace discovery shared by the e2e harness.
//
// `pack.mjs` decides here what it packs; `helpers.mjs` decides here what a
// Yarn-PnP project will have to reach the registry for. Those two answers are
// complements of each other, so they must come from ONE definition — a second
// copy of `isForeignPlatformPackage()` that drifts turns a deliberate omission
// into an unexplained "No candidates found" at install time.
//
// Node builtins only: `pack.mjs` runs before anything in this repo is built.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const MONOREPO_ROOT = resolve(__dirname, '..', '..');
export const HOST_TARGET = `${process.platform}-${process.arch}`;

/**
 * Every workspace package, as `{ name, location, pkg }`.
 *
 * Inline workspace walk — minimal-glob form (trailing `*` only) matches
 * every pattern this monorepo's root pkg.workspaces uses.
 */
export function discoverWorkspaces() {
    const rootPkg = JSON.parse(readFileSync(join(MONOREPO_ROOT, 'package.json'), 'utf8'));
    const patterns = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : (rootPkg.workspaces?.packages ?? []);
    const out = [];
    for (const pattern of patterns) {
        const dirs = pattern.endsWith('/*')
            ? readdirSync(join(MONOREPO_ROOT, pattern.slice(0, -2)), { withFileTypes: true })
                  .filter((d) => d.isDirectory())
                  .map((d) => join(MONOREPO_ROOT, pattern.slice(0, -2), d.name))
            : [join(MONOREPO_ROOT, pattern)];
        for (const dir of dirs) {
            const pkgPath = join(dir, 'package.json');
            if (!existsSync(pkgPath)) continue;
            try {
                const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
                if (!pkg.name) continue;
                out.push({ name: pkg.name, location: relative(MONOREPO_ROOT, dir), pkg });
            } catch {
                /* unreadable — skip */
            }
        }
    }
    return out;
}

/**
 * A per-target platform package (ADR 0017) for a target that is NOT this host's.
 *
 * A consumer never installs more than one of them — that IS the split: the
 * bridge lists every target as an `optionalDependencies` entry, each child
 * declares `os`/`cpu`, and the package manager takes the one that fits and
 * silently skips the rest. A temp tree simulating an external consumer is
 * therefore MORE faithful without the other five, not less.
 *
 * It is also the difference between a suite that finishes and one that does not.
 * `createTestEnvironment()` packs the whole workspace and 34 e2e suites call it,
 * so the split added 58 tarballs carrying ~98 MB of committed binaries to every
 * one of them. Measured in CI: 127 packages / 199 s on `main`, 185 / 258 s with
 * the split — which pushed `cli-only-pnp` past its parent's timeout ("test did
 * not finish before its parent and was cancelled"). Filtering to the host target
 * keeps the prebuilds `dlx-native-prebuilds` and `napi-transparent-app-gjs`
 * actually resolve at run time, and drops only bytes no install in the tree
 * could have used.
 *
 * @param {Record<string, any>} pkg a parsed package.json
 */
export function isForeignPlatformPackage(pkg) {
    const g = pkg.gjsify;
    if (!g || typeof g !== 'object') return false;
    if (typeof g.prebuilds !== 'string') return false;
    if (!Array.isArray(g.platforms) || g.platforms.length !== 1) return false;
    // `os`/`cpu` are what make the package skippable for a real consumer, so
    // they are what identify it here — the same signature
    // `isPlatformPackageManifest()` uses, inlined because this module
    // deliberately imports nothing outside node builtins.
    if (!Array.isArray(pkg.os) || !Array.isArray(pkg.cpu)) return false;
    return g.platforms[0] !== HOST_TARGET;
}

/**
 * The workspaces `pack.mjs` turns into tarballs.
 *
 * Skip templates (consumed via scaffolding, not installed as deps) and private
 * packages. Examples stay in because @gjsify/cli depends on @gjsify/example-*
 * showcases.
 */
export function packableWorkspaces() {
    return discoverWorkspaces().filter((w) => {
        if (w.name.startsWith('@gjsify/template-')) return false;
        if (isForeignPlatformPackage(w.pkg)) return false;
        return !w.pkg.private;
    });
}

/**
 * The `@gjsify/*` packages a tree built from those tarballs still has to fetch
 * from **npm**: declared as a runtime / optional / peer dependency by something
 * that IS packed, but not packed itself.
 *
 * Derived rather than listed. Today the answer is exactly the foreign-target
 * platform packages, but stating it that way would be stating a coincidence: any
 * future omission from `packableWorkspaces()` — a package turned private, a new
 * exclusion — lands a consumer in the same registry dependency without touching
 * anything that names it. `devDependencies` are left out on purpose; a
 * dependency's dev deps are not installed into a consumer's tree.
 *
 * @returns {{name: string, version: string}[]} sorted by name
 */
export function registryOnlyDependencies() {
    const all = discoverWorkspaces();
    const byName = new Map(all.map((w) => [w.name, w]));
    const packed = new Set(packableWorkspaces().map((w) => w.name));

    const needed = new Map();
    for (const w of all) {
        if (!packed.has(w.name)) continue;
        for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
            for (const name of Object.keys(w.pkg[field] ?? {})) {
                if (!name.startsWith('@gjsify/') || packed.has(name) || needed.has(name)) continue;
                // Only workspace members carry a version this release moves. A
                // genuinely external @gjsify dependency resolves from npm at a
                // published range and is unaffected by the release window.
                const target = byName.get(name);
                if (target?.pkg.version) needed.set(name, { name, version: target.pkg.version });
            }
        }
    }

    return [...needed.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
