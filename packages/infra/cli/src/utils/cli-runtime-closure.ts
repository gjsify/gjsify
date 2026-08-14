// Which workspace packages does the RUNNING CLI import at runtime?
//
// WHY THE SCHEDULER NEEDS THIS
//
// `gjsify foreach <script> -p` spawns children, and every child is another
// `gjsify` process: it BOOTS the CLI before it runs anything. So while a parallel
// sweep rebuilds the workspace, each child is reading the very `lib/` trees its
// siblings are writing. Measured on the macOS leg (run 31130155911,
// darwin-arm64), on the first full build that leg ever reached:
//
//     [gjsify foreach] start @gjsify/native-platform (49/160 done, 3 in flight)
//     [gjsify foreach] start @gjsify/npm-registry    (50/160 done, 3 in flight)
//     [@gjsify/native-platform] ERR_MODULE_NOT_FOUND
//       .../npm-registry/lib/esm/_virtual/_rolldown/runtime.js
//       imported from .../npm-registry/lib/esm/auth.js
//
// `auth.js` was on disk and its rolldown chunk was not — a torn write, not a
// corrupt build. `foreach` uses this set to build those packages BEFORE the
// parallel sweep starts, so nothing rewrites them while a child boots.
//
// WHY IT IS DERIVED AND NOT LISTED
//
// The four names a root script once carried by hand (`semver`, `npm-registry`,
// `tar`, `workspace`) were never the whole answer, and a hand-written list is the
// same defect one level up: it is right until an import changes. Two measured
// alternatives were rejected before this one:
//
//   * the MANIFEST closure of `@gjsify/cli` (transitive workspace `dependencies`)
//     selects 110 of the ~160 packages a full sweep builds — it counts the
//     umbrella polyfill metas the CLI declares for the alias layer and never
//     imports under Node. Serialising 110 packages is not a fix, it is the end of
//     parallelism;
//   * a regex over the sources reports 27, because `commands/storybook.ts` emits
//     GENERATED CODE containing `import { … } from '@gjsify/storybook';` inside a
//     template literal. A text scan cannot tell a program from a string, and that
//     one string drags the whole GTK storybook subtree into the prefix.
//
// So the graph is PARSED, from the entry the children actually boot, and the
// answer was checked against ground truth: a Node loader hook recording every
// `file:` URL `gjsify --version` loads reports exactly the ten packages this walk
// returns (see `cli-runtime-closure.spec.ts` for the shape the walk must keep).
//
// THE ONE THING A PARSE CANNOT SEE
//
// A COMPUTED dynamic import. `bundler-pick.ts` loads the bundler engine as
// `await import(target)` where `target` is a resolved file URL, and
// `rolldown-plugin-gjsify`'s `css-as-string.ts` does the same for lightningcss —
// deliberately, so tsc and rolldown do not resolve an optional peer at build
// time. Those are invisible to any static walk, and they are invisible to npm for
// the same reason, which is exactly why the convention is to declare them as
// optional PEER dependencies. So the peers of every package in the graph are
// added: one declaration closes both blind spots, and it stays a declaration the
// package owns rather than a list this file keeps.

import * as acorn from 'acorn';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import type { Workspace } from '@gjsify/workspace';
import { cliPackageDir } from './publish-headers.js';

/** Split `@gjsify/<name>[/<sub>]` into package name + `exports` key; `null` otherwise. */
function splitWorkspaceSpecifier(specifier: string): { name: string; subpath: string } | null {
    if (!specifier.startsWith('@gjsify/')) return null;
    const parts = specifier.split('/');
    if (parts.length < 2) return null;
    const rest = parts.slice(2).join('/');
    return { name: `${parts[0]}/${parts[1]}`, subpath: rest ? `./${rest}` : '.' };
}

/**
 * Literal module specifiers of `code`: static `import`/`export … from`, plus
 * `import('<literal>')`.
 *
 * acorn rather than a regex — see the header. `allowHashBang` because the CLI's
 * own entry is a bin (`#!/usr/bin/env node`), and a parse failure yields NO
 * specifiers, which under-selects rather than mis-selects.
 */
export function moduleSpecifiers(code: string): string[] {
    let ast: acorn.Program;
    try {
        ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
    } catch {
        return [];
    }
    const out: string[] = [];
    const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const child of node) visit(child);
            return;
        }
        const n = node as { type?: string; source?: { type?: string; value?: unknown } };
        if (
            (n.type === 'ImportDeclaration' ||
                n.type === 'ExportNamedDeclaration' ||
                n.type === 'ExportAllDeclaration' ||
                n.type === 'ImportExpression') &&
            n.source?.type === 'Literal' &&
            typeof n.source.value === 'string'
        ) {
            out.push(n.source.value);
        }
        for (const [key, value] of Object.entries(n)) {
            if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
            visit(value);
        }
    };
    visit(ast);
    return out;
}

/** The file a relative specifier names, probing the extensionless spellings Node accepts. */
function resolveRelative(fromFile: string, specifier: string): string | null {
    const base = resolvePath(dirname(fromFile), specifier);
    for (const candidate of [base, `${base}.js`, `${base}.mjs`, join(base, 'index.js')]) {
        try {
            if (statSync(candidate).isFile()) return candidate;
        } catch {
            /* not this spelling */
        }
    }
    return null;
}

/**
 * The file a workspace package's `<subpath>` resolves to, read from its own
 * manifest. `subpath` is `'.'` for a bare package specifier.
 *
 * The `exports` conditions are walked in the order the CHILD's runtime resolves
 * them; `main`/`module` is the pre-`exports` fallback. Deliberately NOT
 * `import.meta.resolve`: that answers only for the runtime doing the asking, and
 * this walk must give the same answer from Node and from GJS, from a spec with a
 * fixture tree as from a real install. Resolving the SUBPATH rather than the
 * package root matters — `@gjsify/rolldown-plugin-gjsify/runtime` is a leaf, and
 * substituting the root barrel for it would drag in everything the barrel
 * re-exports and nothing imports.
 */
function workspaceEntry(ws: Workspace, subpath: string): string | null {
    const manifest = ws.manifest as { exports?: unknown; main?: unknown; module?: unknown };
    const pick = (node: unknown): string | null => {
        if (typeof node === 'string') return node;
        if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
        const record = node as Record<string, unknown>;
        for (const condition of ['node', 'import', 'default', 'gjs']) {
            if (condition in record) {
                const picked = pick(record[condition]);
                if (picked) return picked;
            }
        }
        return null;
    };
    let target: string | null = null;
    if (typeof manifest.exports === 'string') target = subpath === '.' ? manifest.exports : null;
    else if (manifest.exports && typeof manifest.exports === 'object') {
        target = pick((manifest.exports as Record<string, unknown>)[subpath]);
    }
    if (!target && subpath === '.') {
        target = typeof manifest.module === 'string' ? manifest.module : null;
        target ??= typeof manifest.main === 'string' ? manifest.main : null;
    }
    if (!target) return null;
    const file = resolvePath(ws.location, target);
    return existsSync(file) ? file : null;
}

/** `peerDependencies` of `manifest` that name a workspace package. */
function workspacePeers(manifest: { peerDependencies?: Record<string, string> }, byName: Map<string, Workspace>): string[] {
    return Object.keys(manifest.peerDependencies ?? {}).filter((name) => byName.has(name));
}

/** The fields of the CLI's own manifest this walk reads. */
interface CliManifest {
    bin?: string | Record<string, string>;
    main?: string;
    peerDependencies?: Record<string, string>;
}

export interface CliRuntimeClosureOptions {
    /**
     * File to start the walk from. Defaults to the running CLI's Node entry
     * (`bin.gjsify`), which is what a spawned child loads.
     */
    entry?: string | null;
    /** The CLI's own manifest, for its optional peers. Read from disk by default. */
    cliManifest?: { peerDependencies?: Record<string, string> } | null;
}

/**
 * Workspace packages the running CLI imports, so a parallel sweep can build them
 * first instead of underneath itself.
 *
 * Empty is the correct answer in three real situations and none of them is an
 * error: a consumer project (its `@gjsify/*` deps are not workspaces, so nothing
 * the sweep builds can tear), a relocated bundle with no reachable manifest, and
 * a CLI whose entry has not been built.
 */
export function cliRuntimeClosure(workspaces: readonly Workspace[], options: CliRuntimeClosureOptions = {}): Set<string> {
    const byName = new Map(workspaces.map((ws) => [ws.name, ws]));
    const found = new Set<string>();

    let entry = options.entry;
    let cliManifest = options.cliManifest;
    if (entry === undefined || cliManifest === undefined) {
        const packageDir = cliPackageDir();
        let manifest: CliManifest | null = null;
        if (packageDir) {
            try {
                manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as CliManifest;
            } catch {
                /* unreadable — the closure degrades to empty, which is a no-op prefix */
            }
        }
        cliManifest ??= manifest;
        if (entry === undefined) {
            // The npm `bin` entry, NOT `gjsify.bin`: the GJS bundle is self-contained,
            // so walking it would report nothing, while a GJS child still loads the
            // engine facades through the peers below. The `lib/` graph is a superset
            // of what either entry reaches, and one code path beats two.
            const bin = manifest?.bin;
            const relative = typeof bin === 'string' ? bin : (bin?.['gjsify'] ?? manifest?.main);
            entry = packageDir && relative ? resolvePath(packageDir, relative) : null;
        }
    }

    for (const peer of workspacePeers(cliManifest ?? {}, byName)) found.add(peer);
    if (!entry || !existsSync(entry)) return found;

    const seen = new Set<string>();
    const queue: string[] = [entry];
    while (queue.length > 0) {
        const file = queue.shift()!;
        if (seen.has(file)) continue;
        seen.add(file);
        let code: string;
        try {
            code = readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        for (const specifier of moduleSpecifiers(code)) {
            if (specifier.startsWith('.')) {
                const next = resolveRelative(file, specifier);
                if (next) queue.push(next);
                continue;
            }
            const split = splitWorkspaceSpecifier(specifier);
            const ws = split ? byName.get(split.name) : undefined;
            if (!split || !ws) continue;
            found.add(split.name);
            for (const peer of workspacePeers(ws.manifest, byName)) found.add(peer);
            // Queued per SUBPATH, not per package: `seen` dedupes files, so a
            // package imported through two subpaths is walked through both. A
            // package-level visited set would stop at whichever subpath came
            // first and miss what the other one reaches.
            const next = workspaceEntry(ws, split.subpath);
            if (next) queue.push(next);
        }
    }
    return found;
}
