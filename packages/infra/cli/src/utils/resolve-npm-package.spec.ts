// GJS's native ESM loader has no node_modules walker, so a bare `await
// import('rolldown')` from inside the bundled CLI throws `Module not found:
// rolldown` even when the package sits in a node_modules above the caller's cwd
// (still true on gjs 1.88.1). The helper tries createRequire anchors in priority
// order — cwd → workspace root → bundle URL → parent-dir walk → GJSIFY_NODE_PATH —
// and returns the first hit. Under Node it is not strictly required, but must
// still succeed when invoked.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveNpmPackage } from './resolve-npm-package.js';

/**
 * `mkdtempSync` under a CANONICALISED tmp root.
 *
 * On macOS `os.tmpdir()` is a per-user `/var/folders/…` and `/var` symlinks to
 * `/private/var`. `resolveNpmPackage` goes through `createRequire`, which
 * canonicalises, so it returns `/private/var/…` while a path built from `tmpdir()`
 * still spells it `/var/…` — every comparison below would fail on a Mac for a
 * reason unrelated to resolution. A no-op wherever `/tmp` is already real.
 */
function mkdtempReal(prefix: string): string {
    return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/**
 * A synthetic `<tmp>/node_modules/fake-pkg/` project, returning the tmp root plus
 * the absolute entry path so rows can compare resolved paths directly.
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
                // No node_modules, no bundleUrl, no env override — every anchor misses.
                delete process.env['GJSIFY_NODE_PATH'];
                const resolved = resolveNpmPackage('this-package-definitely-does-not-exist-xyzzy', { cwd: root });
                expect(resolved).toBe(null);
            } finally {
                teardown(root);
            }
        });

        await it('falls back to the bundleUrl anchor when cwd misses', () => {
            // The cross-cwd case: the CLI bundle lives next to a populated
            // node_modules but is invoked from an unrelated directory.
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
            // Two roots both carrying the package; the assertion is on which PATH
            // comes back, so GJSIFY_NODE_PATH must outrank cwd.
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
                // `createRequire.resolve` throws under every anchor; the helper must
                // swallow that and return null.
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
