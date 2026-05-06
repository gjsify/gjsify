// Yarn PnP resolver plugin for Rolldown / Rollup / Vite.
//
// Replaces the esbuild-only `@yarnpkg/esbuild-plugin-pnp` wrapper that
// previously lived in `@gjsify/resolve-npm/lib/pnp-relay.mjs`. Same relay
// semantics, Rollup-shaped hooks instead of esbuild's `setup(build)`.
//
// The plugin behaves like a no-op when not running under Yarn PnP (no
// `.pnp.cjs` ancestor of cwd, or `module.findPnpApi` unavailable).
//
// Rolldown does NOT have esbuild's "first onLoad wins" rule — the path
// rewriter that used to run inside this plugin's onLoad now lives as an
// independent `transform(code, id)` plugin. See
// `@gjsify/rolldown-plugin-gjsify/src/import-meta-url.ts`.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Plugin } from 'rolldown';

export interface PnpPluginOptions {
    /**
     * `import.meta.url` of the caller. Used to anchor relay-issuer resolution
     * on the caller's installation rather than this package's own location.
     * Defaults to this module's own URL.
     */
    issuerUrl?: string;
    /**
     * Packages whose `package.json` paths serve as fallback relay issuers
     * when a direct `pnpApi.resolveRequest` fails with `UNDECLARED_DEPENDENCY`.
     * Defaults to gjsify's polyfill meta-packages.
     */
    relayPackages?: string[];
}

/** PnP API exposed by Yarn at runtime. Subset we actually use. */
interface PnpApi {
    resolveRequest(specifier: string, issuer: string): string | null;
}

/** Walk up from dir until .pnp.cjs is found; return its directory or null. */
function findPnpRoot(dir: string): string | null {
    let current = dir;
    while (true) {
        if (existsSync(join(current, '.pnp.cjs'))) return current;
        const parent = dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

/** Try to load the runtime PnP API for the cwd's PnP installation. */
async function loadPnpApi(): Promise<PnpApi | null> {
    try {
        // `pnpapi` is a virtual CJS module Yarn injects when running under PnP.
        // `await import()` of a CJS module yields `{ default, "module.exports" }`,
        // not the exports object directly — unwrap `.default`.
        // @ts-expect-error pnpapi has no npm package
        const mod = await import('pnpapi');
        return (mod.default ?? mod) as PnpApi;
    } catch {
        return null;
    }
}

/**
 * Build the gjsify-flavoured PnP relay plugin for Rolldown.
 *
 * Returns null when not running under Yarn PnP. Callers can spread this into
 * a plugin array and Rolldown will skip the null entry.
 */
export async function pnpPlugin(opts: PnpPluginOptions = {}): Promise<Plugin | null> {
    const issuerUrl = opts.issuerUrl ?? import.meta.url;
    if (!findPnpRoot(process.cwd())) return null;

    const pnpApi = await loadPnpApi();
    if (pnpApi === null) return null;

    // Relay issuers — anchor resolution on whoever called us first, then fall
    // back to the polyfill meta-packages (which depend on every individual
    // polyfill, so transitive `@gjsify/*` lookups always reach them).
    const issuerPath = fileURLToPath(issuerUrl);
    const requireFromIssuer = createRequire(issuerPath);
    const relayPackages = opts.relayPackages ?? ['@gjsify/node-polyfills', '@gjsify/web-polyfills'];
    const relayIssuers: string[] = [];
    for (const pkg of relayPackages) {
        try {
            relayIssuers.push(requireFromIssuer.resolve(`${pkg}/package.json`));
        } catch {
            // not in dep tree — relay won't cover it
        }
    }

    return {
        name: 'gjsify-pnp',

        // Per-hook `order: 'pre'` runs us before Rolldown's default resolver
        // so we own resolution for every bare specifier under PnP. Rolldown
        // uses Rollup's per-hook ordering (not Vite's top-level `enforce`).
        resolveId: {
            order: 'pre' as const,
            async handler(source, importer) {
                // Skip relative / absolute paths — let Rolldown handle them.
                if (source.startsWith('.') || source.startsWith('/')) return null;
                if (!importer) return null;

                // Importer may be a file URL string or an absolute path.
                const importerPath = importer.startsWith('file://')
                    ? fileURLToPath(importer)
                    : importer;

                // Fast path: resolve from the importer's own context.
                try {
                    const resolved = pnpApi.resolveRequest(source, importerPath);
                    if (resolved !== null) return { id: resolved };
                    // Yarn returns null for built-ins (`fs`, `path`, …) —
                    // leave them external; Rolldown picks them up downstream.
                    return null;
                } catch (err) {
                    if (!isUndeclaredDependency(err)) throw err;

                    // Relay through caller's anchor first, then polyfill meta-packages.
                    try {
                        const resolved = pnpApi.resolveRequest(source, issuerPath);
                        if (resolved !== null) return { id: resolved };
                    } catch (relayErr) {
                        if (!isUndeclaredDependency(relayErr)) throw relayErr;
                    }
                    for (const relayIssuer of relayIssuers) {
                        try {
                            const resolved = pnpApi.resolveRequest(source, relayIssuer);
                            if (resolved !== null) return { id: resolved };
                        } catch (relayErr) {
                            if (!isUndeclaredDependency(relayErr)) throw relayErr;
                        }
                    }
                    // Fall through — bare aliases (e.g. `abort-controller`,
                    // `fetch/register/*`) are handled by the gjsify alias
                    // layer after this returns null; the re-resolved
                    // `@gjsify/*` path then comes back through this hook on
                    // the second try.
                    return null;
                }
            },
        },

        async load(id) {
            // Only handle paths that look like PnP-resolved zip-resident or
            // cache-resident files. For everything else, defer to the
            // default loader (returning null = pass-through).
            if (!id.includes('/.yarn/') && !id.includes('.zip/')) return null;

            try {
                // Yarn's PnP runtime patches Node's `fs` module so reads
                // against zip-resident virtual paths transparently work.
                // Rolldown's Rust core does NOT participate in that patch;
                // delegating to Node fs from here is what makes the read
                // succeed.
                const code = await readFile(id, 'utf8');
                return { code };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.error(`gjsify-pnp: failed to read ${id}: ${message}`);
            }
        },
    };
}

function isUndeclaredDependency(err: unknown): boolean {
    return typeof err === 'object'
        && err !== null
        && 'pnpCode' in err
        && (err as { pnpCode?: unknown }).pnpCode === 'UNDECLARED_DEPENDENCY';
}
