// PnP relay for @gjsify/* polyfills.
//
// Yarn PnP throws `UNDECLARED_DEPENDENCY` when esbuild's resolver asks for a
// package that exists in the install graph but isn't a direct dep of the
// importer. For external consumers of @gjsify/cli (e.g. ts-for-gir) this means
// every transitive `@gjsify/<polyfill>` reached via the rewriter would have to
// be declared as a direct devDep — defeating the point of having
// `@gjsify/{node,web}-polyfills` as meta-packages.
//
// `getPnpPlugin()` returns a Plugin that catches `UNDECLARED_DEPENDENCY` errors
// and re-resolves them through two relay issuers:
//   1. The caller's own location (covers `@gjsify/*` that are direct deps of
//      cli's own deps — fast first-try)
//   2. @gjsify/{node,web}-polyfills' package.json paths (covers everything
//      else, since those meta-packages depend on every individual polyfill)
//
// The plugin also accepts a `transformContents` factory: given the
// `PluginBuild` it returns a per-build transformer that runs after the file
// is read. esbuild stops at the first matching onLoad, so the rewriter MUST
// run from inside this onLoad — not be registered as a separate onLoad
// afterwards (that's the F5 bug).

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

/** Walk up from dir until .pnp.cjs is found; return its directory or null. */
function findPnpRoot(dir) {
    let current = dir;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (existsSync(join(current, '.pnp.cjs'))) return current;
        const parent = dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

/**
 * @typedef {(args: { path: string, namespace?: string }, contents: string) =>
 *   Promise<{contents: string, loader?: string, resolveDir?: string} | undefined>
 *   | {contents: string, loader?: string, resolveDir?: string} | undefined} TransformContents
 *
 * @typedef {object} GetPnpPluginOptions
 * @property {(build: import('esbuild').PluginBuild) => TransformContents} [transformContentsFactory]
 *   Optional: called once per esbuild `setup(build)` invocation. Returns the
 *   actual per-file transformer that runs after the file is read but before
 *   returning to esbuild. The factory pattern gives the transformer access to
 *   `build.initialOptions` (e.g. for computing bundle-relative paths) which
 *   isn't available at plugin-construction time.
 *
 * @property {string} [issuerUrl]
 *   `import.meta.url` of the caller. Used to anchor relay issuer resolution
 *   on the caller's installation rather than `@gjsify/resolve-npm`'s.
 *   Defaults to this module's own URL.
 */

/**
 * Build the gjsify-flavoured PnP plugin.
 *
 * Returns null when not running under Yarn PnP (no `.pnp.cjs` ancestor of cwd
 * or `@yarnpkg/esbuild-plugin-pnp` not installed).
 *
 * @param {GetPnpPluginOptions} [opts]
 * @returns {Promise<import('esbuild').Plugin | null>}
 */
export async function getPnpPlugin(opts = {}) {
    const { transformContentsFactory, issuerUrl = import.meta.url } = opts;
    if (!findPnpRoot(process.cwd())) return null;

    let pnpPlugin;
    try {
        ({ pnpPlugin } = await import('@yarnpkg/esbuild-plugin-pnp'));
    } catch {
        return null;
    }

    // Anchor relay-issuer resolution on whoever called us. For external
    // consumers this is @gjsify/cli's own file path; node-polyfills + web-polyfills
    // are direct deps of @gjsify/cli, so requireFromIssuer.resolve() reaches them.
    const issuerPath = fileURLToPath(issuerUrl);
    const requireFromIssuer = createRequire(issuerPath);
    const relayIssuers = [];
    for (const pkg of ['@gjsify/node-polyfills', '@gjsify/web-polyfills']) {
        try {
            relayIssuers.push(requireFromIssuer.resolve(`${pkg}/package.json`));
        } catch {
            // polyfills package not in dep tree — relay won't cover it
        }
    }

    // pnpapi is a virtual CJS module injected by Yarn PnP. `await import()` of a
    // CJS module yields the ESM namespace `{ default, "module.exports" }`, NOT
    // the exports object — so unconditional `.resolveRequest` access is
    // `undefined`. Unwrap `.default` (the CJS exports) before use.
    let pnpApi = null;
    try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error pnpapi has no npm package
        const mod = await import('pnpapi');
        pnpApi = mod.default ?? mod;
    } catch {
        // Not in a PnP runtime (shouldn't happen since findPnpRoot passed).
    }

    return {
        name: '@gjsify/pnp-relay',
        async setup(build) {
            const transformContents = transformContentsFactory
                ? transformContentsFactory(build)
                : null;

            const inner = pnpPlugin({
                onResolve: async (args, { resolvedPath, error, watchFiles }) => {
                    if (resolvedPath !== null) {
                        return { namespace: 'pnp', path: resolvedPath, watchFiles };
                    }
                    if (error?.pnpCode === 'UNDECLARED_DEPENDENCY') {
                        if (pnpApi !== null) {
                            // Fast first-try: caller's own context.
                            try {
                                const rp = pnpApi.resolveRequest(args.path, issuerPath);
                                if (rp !== null) return { namespace: 'pnp', path: rp, watchFiles };
                            } catch { /* fall through to relay */ }
                            // Two-hop relay: resolve from {node,web}-polyfills context.
                            for (const relayIssuer of relayIssuers) {
                                try {
                                    const rp = pnpApi.resolveRequest(args.path, relayIssuer);
                                    if (rp !== null) return { namespace: 'pnp', path: rp, watchFiles };
                                } catch { /* try next issuer */ }
                            }
                        }
                        // Fall through — bare aliases (`abort-controller`, `fetch/register/*`)
                        // are handled by the gjsify alias plugin after this returns null;
                        // the re-resolved `@gjsify/*` path then comes back through this hook.
                        return null;
                    }
                    return {
                        external: true,
                        errors: error ? [{ text: error.message }] : [],
                        watchFiles,
                    };
                },
                onLoad: async (args) => {
                    // @yarnpkg/esbuild-plugin-pnp invokes the user-provided onLoad
                    // with just `args` (same shape as esbuild's standard onLoad —
                    // not the (args, ctx) tuple of its onResolve). args.path is
                    // already a resolved fs path; we only need to read it.
                    let contents;
                    try {
                        contents = await readFile(args.path, 'utf8');
                    } catch (readErr) {
                        return {
                            errors: [{ text: `gjsify pnp-relay: failed to read ${args.path}: ${readErr.message}` }],
                        };
                    }

                    if (transformContents) {
                        const transformed = await transformContents(
                            { path: args.path, namespace: 'pnp' },
                            contents,
                        );
                        if (transformed !== undefined) {
                            return transformed;
                        }
                    }

                    // `loader: 'default'` lets esbuild infer from the path extension.
                    return {
                        contents,
                        loader: 'default',
                        resolveDir: dirname(args.path),
                    };
                },
            });
            await inner.setup(build);
        },
    };
}
