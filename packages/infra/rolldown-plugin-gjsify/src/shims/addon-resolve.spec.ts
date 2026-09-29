// SPDX-License-Identifier: MIT
// The RUN-TIME half of ADR 0084, which the `napi-node-addon.spec.ts` table-shape
// assertions cannot reach: that spec checks what the build EMITS, this one checks
// what the emitted resolver RETURNS on the host it actually runs on. The gap was
// not academic — a direct import of a `.node` outside `node_modules` produced a
// table the resolver split into a package named `` and then threw on, and 60
// table-shape tests stayed green through it.

import { describe, expect, it } from '@gjsify/unit';

import { __gjsifyAddonResolve } from './addon-resolve.js';
import { hostAddonKeys } from '../utils/addon-platform.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The key the resolver will ask for on THIS host — the table has to answer it. */
const HOST_KEY = hostAddonKeys(process.platform, process.arch, process.env.LIBC)[0];

/**
 * A tree the resolver can anchor on: a bundle file beside a `node_modules` that
 * holds `pkgName` with `subpath` inside it. Returns the root to assert against.
 */
function fixture(pkgName: string, subpath: string, opts?: { exportsMap?: unknown }): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-addon-resolve-'));
    const pkgRoot = join(root, 'node_modules', pkgName);
    mkdirSync(join(pkgRoot, subpath.split('/').slice(0, -1).join('/') || '.'), { recursive: true });
    writeFileSync(join(pkgRoot, subpath), '');
    writeFileSync(
        join(pkgRoot, 'package.json'),
        JSON.stringify(
            opts?.exportsMap === undefined
                ? { name: pkgName, main: 'index.js' }
                : { name: pkgName, main: 'index.js', exports: opts.exportsMap },
        ),
    );
    // The anchor must be a FILE: `createRequire` walks up from its directory.
    writeFileSync(join(root, 'bundle.mjs'), '');
    return root;
}

/**
 * Run `fn` with the bundle-URL banner the shim anchors on, then restore it.
 * The banner is `import.meta.url` (see `BUNDLE_URL_BANNER`), so it is a URL and
 * not a path: the resolver feeds it to `fileURLToPath` for its `addons/` message.
 */
function anchored<T>(bundleFile: string, fn: () => T): T {
    const host = globalThis as unknown as { __gjsifyBundleUrl?: string };
    const before = host.__gjsifyBundleUrl;
    host.__gjsifyBundleUrl = pathToFileURL(bundleFile).href;
    try {
        return fn();
    } finally {
        if (before === undefined) delete host.__gjsifyBundleUrl;
        else host.__gjsifyBundleUrl = before;
    }
}

function cleanup(root: string): void {
    rmSync(root, { recursive: true, force: true });
}

export default async () => {
    await describe('__gjsifyAddonResolve', async () => {
        await it('joins the recorded subpath onto the package root it resolves at run time', () => {
            const root = fixture('typedoc', 'prebuilds/x.node');
            try {
                const got = anchored(join(root, 'bundle.mjs'), () =>
                    __gjsifyAddonResolve({ [HOST_KEY]: 'typedoc/prebuilds/x.node' }),
                );
                expect(got).toBe(join(root, 'node_modules', 'typedoc', 'prebuilds', 'x.node'));
            } finally {
                cleanup(root);
            }
        });

        await it('returns an ABSOLUTE entry unchanged — a local .node has no package identity', () => {
            // The regression: `packageSpecFor` records the path itself when the file
            // is under no `node_modules`. Split as a specifier it named a package
            // `` and the resolver threw naming neither the file nor the remedy.
            const abs = join(tmpdir(), 'gjsify-local-addon', 'build', 'mine.node');
            expect(anchored(join(tmpdir(), 'bundle.mjs'), () => __gjsifyAddonResolve({ '*': abs }))).toBe(abs);
        });

        await it('REFUSES a subpath that leaves the package root', () => {
            // Not reachable from a table this plugin writes — `relative()` cannot
            // produce `..`. It guards the one function that picks the file to dlopen.
            const root = fixture('typedoc', 'index.js');
            try {
                expect(() =>
                    anchored(join(root, 'bundle.mjs'), () =>
                        __gjsifyAddonResolve({ [HOST_KEY]: 'typedoc/../../elsewhere/x.node' }),
                    ),
                ).toThrow(/leaves the package root/);
            } finally {
                cleanup(root);
            }
        });

        await it('names the host AND the platforms the table knows when none matches', () => {
            const root = fixture('typedoc', 'x.node');
            try {
                expect(() =>
                    anchored(join(root, 'bundle.mjs'), () => __gjsifyAddonResolve({ 'plan9-mips': 'typedoc/x.node' })),
                ).toThrow(new RegExp(`${process.platform}-${process.arch}`));
                expect(() =>
                    anchored(join(root, 'bundle.mjs'), () => __gjsifyAddonResolve({ 'plan9-mips': 'typedoc/x.node' })),
                ).toThrow(/plan9-mips/);
            } finally {
                cleanup(root);
            }
        });

        await it('reports the package and both remedies when it is not installed', () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-addon-missing-'));
            try {
                writeFileSync(join(root, 'bundle.mjs'), '');
                expect(() =>
                    anchored(join(root, 'bundle.mjs'), () =>
                        __gjsifyAddonResolve({ [HOST_KEY]: 'never-installed/x.node' }),
                    ),
                ).toThrow(/never-installed/);
            } finally {
                cleanup(root);
            }
        });

        await it('refuses rather than guessing when the banner did not run', () => {
            const host = globalThis as unknown as { __gjsifyBundleUrl?: string };
            const before = host.__gjsifyBundleUrl;
            delete host.__gjsifyBundleUrl;
            try {
                expect(() => __gjsifyAddonResolve({ [HOST_KEY]: 'typedoc/x.node' })).toThrow(
                    /__gjsifyBundleUrl is not set/,
                );
            } finally {
                if (before !== undefined) host.__gjsifyBundleUrl = before;
            }
        });

        await it('finds the ROOT of a workspace-linked package whose exports hide package.json', () => {
            // A linked package resolves to its real path, which carries no
            // `node_modules/<pkg>/` segment; answering `dirname(main)` named `dist/`
            // and the addon was reported missing at a path that never existed.
            const root = mkdtempSync(join(tmpdir(), 'gjsify-addon-linked-'));
            try {
                const pkgRoot = join(root, 'packages', 'linked-addon');
                mkdirSync(join(pkgRoot, 'dist'), { recursive: true });
                mkdirSync(join(pkgRoot, 'prebuilds'), { recursive: true });
                writeFileSync(join(pkgRoot, 'dist', 'index.js'), '');
                writeFileSync(join(pkgRoot, 'prebuilds', 'x.node'), '');
                writeFileSync(
                    join(pkgRoot, 'package.json'),
                    JSON.stringify({
                        name: 'linked-addon',
                        main: 'dist/index.js',
                        exports: { '.': './dist/index.js' },
                    }),
                );
                // The bundle reaches it the way a workspace consumer does: through a
                // node_modules LINK, which `createRequire` resolves to the real path.
                const appRoot = join(root, 'app');
                mkdirSync(join(appRoot, 'node_modules'), { recursive: true });
                const bundle = join(appRoot, 'bundle.mjs');
                writeFileSync(bundle, '');
                symlinkSync(pkgRoot, join(appRoot, 'node_modules', 'linked-addon'));
                const got = anchored(bundle, () =>
                    __gjsifyAddonResolve({ [HOST_KEY]: 'linked-addon/prebuilds/x.node' }),
                );
                expect(got).toBe(join(pkgRoot, 'prebuilds', 'x.node'));
            } finally {
                cleanup(root);
            }
        });
    });
};
