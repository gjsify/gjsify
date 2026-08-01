// E2E test for the GJS-bundled CLI's cross-cwd npm-package resolution.
//
// Bug fixed: when `gjs -m <install>/dist/cli.gjs.mjs build …` is invoked
// from a directory OUTSIDE the workspace, the bundle's `loadNpmRolldown`
// used a bare `await import('rolldown')` that GJS's native ESM loader
// can't resolve (no node_modules walker). Even when rolldown was
// physically present (e.g. reachable from the bundle path's own
// node_modules), the load failed with `Module not found: rolldown`.
//
// Fix: `resolveNpmPackage` now tries multiple createRequire anchors —
// caller cwd → workspace root → bundle URL → parent-dir walk →
// `GJSIFY_NODE_PATH`. The bundle URL anchor in particular keeps the
// install-time node_modules reachable when the user invokes the
// bundle directly from an unrelated cwd.
//
// We exercise this from Node (the helper's logic is host-runtime-agnostic
// — Node's loader also resolves bare specifiers, but the helper's path
// is the same code that fires under GJS) by:
//   1. Building a tiny synthetic install root with a populated
//      node_modules tree under it.
//   2. Building a tiny tmp `cwd` directory with NO node_modules.
//   3. Loading `resolveNpmPackage` from the in-tree source via
//      esbuild/import-transpile to verify the multi-anchor logic
//      picks up the bundle-URL anchor.
//
// Heavy `gjs -m` invocation is left out — `gjsify foreach build` in the
// regular CI pipeline already exercises the GJS path end-to-end.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

describe('CLI bundle cross-cwd resolve', { timeout: 60_000 }, () => {
    let tmpDir;
    let cwdDir;
    let bundleRoot;
    let bundleFile;
    let resolveNpmPackage;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-cross-cwd-'));

        // (1) Empty cwd — no node_modules above it. Under the buggy
        // pre-fix logic, anchoring on cwd alone would miss every
        // candidate.
        cwdDir = join(tmpDir, 'sandbox');
        mkdirSync(cwdDir, { recursive: true });
        writeFileSync(
            join(cwdDir, 'package.json'),
            JSON.stringify({ name: 'sandbox', type: 'module' }, null, 2) + '\n',
        );

        // (2) Bundle root with a populated node_modules — this is the
        // shape the global gjsify-CLI install has (`<install>/dist/
        // cli.gjs.mjs` + `<install>/node_modules/rolldown/`). We use a
        // synthetic `fake-rolldown` so we don't reach for the real
        // rolldown crate that the CLI's own build process needs.
        bundleRoot = join(tmpDir, 'install');
        const pkgDir = join(bundleRoot, 'node_modules', 'fake-rolldown');
        mkdirSync(pkgDir, { recursive: true });
        writeFileSync(
            join(pkgDir, 'package.json'),
            JSON.stringify({ name: 'fake-rolldown', main: './index.js', type: 'module' }, null, 2) + '\n',
        );
        writeFileSync(join(pkgDir, 'index.js'), 'export const tag = "ok";\n');
        const distDir = join(bundleRoot, 'dist');
        mkdirSync(distDir, { recursive: true });
        bundleFile = join(distDir, 'cli.gjs.mjs');
        writeFileSync(bundleFile, '// fake bundle stand-in\n');

        // Load resolveNpmPackage from the in-tree source. We jump through
        // `tsx` because the .ts file isn't built ahead of this e2e test.
        // If tsx isn't available, transpile via a transient .mjs that
        // reuses the helper's logic. Easiest path: the helper is
        // currently published as `lib/utils/resolve-npm-package.js` after
        // `gjsify run build:gjsify` — fall back to the lib path when
        // the source path isn't compiled.
        const libPath = join(REPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'utils', 'resolve-npm-package.js');
        const mod = await import(libPath);
        resolveNpmPackage = mod.resolveNpmPackage;
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP && tmpDir) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('finds fake-rolldown via the bundle-URL anchor when cwd has no node_modules', () => {
        // Anchor at cwd (which has NO node_modules) but pass the bundle
        // URL — the helper should walk the bundle path's parent chain
        // and find `<install>/node_modules/fake-rolldown/index.js`.
        const bundleUrl = `file://${bundleFile}`;
        const resolved = resolveNpmPackage('fake-rolldown', { cwd: cwdDir, bundleUrl });
        assert.ok(resolved, 'fake-rolldown must resolve via the bundle-URL anchor');
        assert.match(resolved, /install\/node_modules\/fake-rolldown\/index\.js$/);
    });

    it('returns null when neither cwd nor bundleUrl reaches the package', () => {
        // No bundle URL, no env override — cwd has no node_modules and
        // no ancestor has the package.
        delete process.env.GJSIFY_NODE_PATH;
        const resolved = resolveNpmPackage('this-package-definitely-does-not-exist-xyzzy', { cwd: cwdDir });
        assert.equal(resolved, null);
    });

    it('GJSIFY_NODE_PATH overrides every other anchor', () => {
        // Stage a SECOND synthetic copy of `fake-rolldown` in a third
        // root; GJSIFY_NODE_PATH must beat both cwd and bundleUrl.
        const envRoot = join(tmpDir, 'env-root');
        const envPkgDir = join(envRoot, 'node_modules', 'fake-rolldown');
        mkdirSync(envPkgDir, { recursive: true });
        writeFileSync(
            join(envPkgDir, 'package.json'),
            JSON.stringify({ name: 'fake-rolldown', main: './index.js', type: 'module' }, null, 2) + '\n',
        );
        writeFileSync(join(envPkgDir, 'index.js'), 'export const tag = "env";\n');
        process.env.GJSIFY_NODE_PATH = envRoot;
        try {
            const bundleUrl = `file://${bundleFile}`;
            const resolved = resolveNpmPackage('fake-rolldown', { cwd: cwdDir, bundleUrl });
            assert.ok(resolved);
            assert.match(resolved, /env-root\/node_modules\/fake-rolldown\/index\.js$/);
        } finally {
            delete process.env.GJSIFY_NODE_PATH;
        }
    });
});
