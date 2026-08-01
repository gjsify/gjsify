// Regression coverage for the multi-anchor `resolveNpmPackage` helper.
//
// The helper's reason for existing: GJS's native ESM loader has no
// node_modules walker, so a bare `await import('rolldown')` from inside
// the bundled CLI throws `Module not found: rolldown` even when the
// package is physically present in a node_modules above the caller's
// cwd. The helper tries multiple createRequire anchors in priority
// order — cwd → workspace root → bundle URL → parent-dir walk →
// GJSIFY_NODE_PATH — and returns the first hit. Under Node, where the
// native loader resolves bare specifiers natively, the helper is not
// strictly required but is still expected to succeed when invoked.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveNpmPackage } from './resolve-npm-package.js';

/**
 * `mkdtempSync` under a CANONICALISED tmp root.
 *
 * On macOS `os.tmpdir()` is a per-user `/var/folders/…`, and `/var` is a
 * symlink to `/private/var`. `resolveNpmPackage` resolves through
 * `createRequire`, which canonicalises, so it returns `/private/var/…` while a
 * path this fixture builds from `tmpdir()` still spells it `/var/…`. Every
 * comparison below would then fail on a Mac for a reason that has nothing to do
 * with resolution. Canonicalising the root once keeps the two sides
 * apples-to-apples, and is a no-op wherever `/tmp` is already a real directory.
 */
function mkdtempReal(prefix: string): string {
    return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/**
 * Set up a tiny synthetic project layout under a unique tmp dir:
 *   <tmp>/                              ← anchor: cwd
 *     package.json
 *     node_modules/
 *       fake-pkg/
 *         package.json
 *         index.js
 *
 * Returns the tmp root + the absolute path of `fake-pkg`'s entry file
 * so tests can compare resolved paths directly.
 */
function setupFixture(): { root: string; entry: string } {
    const root = mkdtempReal('gjsify-resolve-npm-');
    const pkgDir = join(root, 'node_modules', 'fake-pkg');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'host', type: 'module' }));
    writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'fake-pkg', type: 'module', main: './index.js' }),
    );
    writeFileSync(join(pkgDir, 'index.js'), 'export default 42;\n');
    const entry = join(pkgDir, 'index.js');
    return { root, entry };
}

function teardown(root: string): void {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}

export default async () => {
    await describe('resolveNpmPackage', async () => {
        await it('resolves from the caller cwd', () => {
            const { root, entry } = setupFixture();
            try {
                const resolved = resolveNpmPackage('fake-pkg', { cwd: root });
                expect(resolved).toBe(entry);
            } finally {
                teardown(root);
            }
        });

        await it('returns null when no anchor has the package', () => {
            const root = mkdtempReal('gjsify-resolve-empty-');
            try {
                // Force an isolated cwd with no node_modules, no bundleUrl,
                // no env override — every anchor must miss.
                delete process.env['GJSIFY_NODE_PATH'];
                const resolved = resolveNpmPackage('this-package-definitely-does-not-exist-xyzzy', { cwd: root });
                expect(resolved).toBe(null);
            } finally {
                teardown(root);
            }
        });

        await it('falls back to the bundleUrl anchor when cwd misses', () => {
            // Two separate tmp roots: one for cwd (empty), one for the
            // bundle URL (has the package). This is the cross-cwd case
            // from the task — the CLI bundle lives next to a populated
            // node_modules, but is invoked from an unrelated directory.
            const emptyCwd = mkdtempReal('gjsify-resolve-empty-');
            const { root: bundleRoot, entry } = setupFixture();
            try {
                delete process.env['GJSIFY_NODE_PATH'];
                const bundleFile = join(bundleRoot, 'cli.gjs.mjs');
                writeFileSync(bundleFile, '// fake bundle\n');
                const bundleUrl = `file://${bundleFile}`;
                const resolved = resolveNpmPackage('fake-pkg', { cwd: emptyCwd, bundleUrl });
                expect(resolved).toBe(entry);
            } finally {
                teardown(emptyCwd);
                teardown(bundleRoot);
            }
        });

        await it('respects GJSIFY_NODE_PATH override over cwd', () => {
            // Two roots, both with the package — but with DIFFERENT
            // entry-file contents. GJSIFY_NODE_PATH must win.
            const cwdRoot = setupFixture();
            const envRoot = setupFixture();
            try {
                process.env['GJSIFY_NODE_PATH'] = envRoot.root;
                const resolved = resolveNpmPackage('fake-pkg', { cwd: cwdRoot.root });
                expect(resolved).toBe(envRoot.entry);
            } finally {
                delete process.env['GJSIFY_NODE_PATH'];
                teardown(cwdRoot.root);
                teardown(envRoot.root);
            }
        });

        await it('walks parent dirs as a last resort', () => {
            // Layout:
            //   <root>/                  ← anchor: deep cwd
            //     node_modules/fake-pkg/
            //     nested/a/b/c/          ← actual cwd, no local node_modules
            const root = mkdtempReal('gjsify-resolve-nested-');
            const pkgDir = join(root, 'node_modules', 'fake-pkg');
            const deepCwd = join(root, 'nested', 'a', 'b', 'c');
            mkdirSync(pkgDir, { recursive: true });
            mkdirSync(deepCwd, { recursive: true });
            writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'fake-pkg', main: './index.js' }));
            writeFileSync(join(pkgDir, 'index.js'), 'export default 42;\n');
            try {
                delete process.env['GJSIFY_NODE_PATH'];
                const resolved = resolveNpmPackage('fake-pkg', { cwd: deepCwd });
                expect(resolved).toBe(join(pkgDir, 'index.js'));
            } finally {
                teardown(root);
            }
        });

        await it('returns null gracefully on a malformed specifier', () => {
            const { root } = setupFixture();
            try {
                // Empty specifier — createRequire.resolve throws under
                // every anchor; helper must swallow and return null.
                const resolved = resolveNpmPackage('', { cwd: root });
                expect(resolved).toBe(null);
            } finally {
                teardown(root);
            }
        });
    });
};

// Use the imports so type-only static-analysis pulls them through.
void symlinkSync;
