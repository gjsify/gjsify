// SPDX-License-Identifier: MIT
// Getting the GTK closure at ship time, and only then.
//
// FOUR CLAIMS, each the one a regression would break silently:
//
//   1. Nothing is fetched when something already provides a closure. A fetch is
//      100 MB; fetching "to be safe" would also override what the author chose.
//   2. When nothing does, the EXACT version of the running CLI is fetched. Addon and
//      closure are a matched pair, so a range or a nearest-version fallback is a
//      guess about GTK ABI that nothing downstream can check.
//   3. A fetch that fails — offline, an unpublished dev version — is a result with
//      the reason in it, never a throw: a ship run with no closure is PARTIAL by
//      design (`stageAppRuntime`), and the cause must reach the person verbatim.
//   4. The fetched directory is wired into the staging step AND is the LAST
//      candidate: an installed package, `GJSIFY_GTK_RUNTIME` and node-gi's own
//      sibling layout all keep winning, so projects that still install the package
//      ship exactly as before.
//
// No registry is touched: `ensure` is injected, which is also what makes claim 2
// testable as a string.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireGtkRuntime } from './gtk-runtime-acquire.js';
import { resolveGtkRuntime } from './app-runtime.js';

function scratch(tag: string): string {
    return mkdtempSync(join(tmpdir(), `gjsify-gtk-acquire-${tag}-`));
}

function put(root: string, rel: string): void {
    const path = join(root, ...rel.split('/'));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, 'x');
}

/** A package directory holding a complete darwin `gtk/` closure. */
function packageWithClosure(): string {
    const dir = scratch('pkg');
    put(dir, 'gtk/lib/libgtk-4.1.dylib');
    put(dir, 'gtk/girepository-1.0/Gtk-4.0.typelib');
    return dir;
}

/** A project that has nothing of gjsify installed. */
function bareProject(): string {
    return scratch('bare');
}

export default async () => {
    await describe('acquireGtkRuntime', async () => {
        await it('fetches nothing when GJSIFY_GTK_RUNTIME already names a closure', async () => {
            const bundle = packageWithClosure();
            const fetched: string[] = [];
            const result = await acquireGtkRuntime({
                target: 'darwin-arm64',
                version: '0.64.4',
                discovery: { cwd: bareProject(), env: { GJSIFY_GTK_RUNTIME: join(bundle, 'gtk') } },
                ensure: async (spec) => {
                    fetched.push(spec);
                    return bundle;
                },
            });
            expect(result.kind).toBe('present');
            expect(fetched.length).toBe(0);
        });

        await it('fetches nothing under GJSIFY_GTK_RUNTIME_FETCH=0, and says so', async () => {
            const fetched: string[] = [];
            const result = await acquireGtkRuntime({
                target: 'win32-x64',
                version: '0.64.4',
                discovery: { cwd: bareProject(), env: { GJSIFY_GTK_RUNTIME_FETCH: '0' } },
                ensure: async (spec) => {
                    fetched.push(spec);
                    return packageWithClosure();
                },
            });
            expect(result.kind).toBe('failed');
            expect(result.kind === 'failed' ? result.reason : '').toContain('GJSIFY_GTK_RUNTIME_FETCH=0');
            expect(fetched.length).toBe(0);
        });

        await it('fetches the EXACT cli version of the target package when nothing provides one', async () => {
            const pkg = packageWithClosure();
            const fetched: string[] = [];
            const result = await acquireGtkRuntime({
                target: 'darwin-x64',
                version: '0.64.4',
                discovery: { cwd: bareProject(), env: {} },
                ensure: async (spec) => {
                    fetched.push(spec);
                    return pkg;
                },
            });
            expect(fetched).toStrictEqual(['@gjsify/gtk-runtime-darwin-x64@0.64.4']);
            expect(result).toStrictEqual({ kind: 'fetched', dir: pkg });
        });

        await it('says what it is doing before a 100 MB download, not after', async () => {
            const lines: string[] = [];
            await acquireGtkRuntime({
                target: 'darwin-arm64',
                version: '0.64.4',
                discovery: { cwd: bareProject(), env: {} },
                ensure: async () => packageWithClosure(),
                log: (message) => lines.push(message),
            });
            expect(lines.length).toBe(1);
            expect(lines[0]).toContain('@gjsify/gtk-runtime-darwin-arm64@0.64.4');
            expect(lines[0]).toContain('100 MB');
        });

        await it('reports a failed fetch with its cause instead of throwing', async () => {
            const result = await acquireGtkRuntime({
                target: 'darwin-arm64',
                version: '0.64.4-next.1',
                discovery: { cwd: bareProject(), env: {} },
                ensure: async () => {
                    throw new Error('404 Not Found - @gjsify/gtk-runtime-darwin-arm64@0.64.4-next.1');
                },
            });
            expect(result.kind).toBe('failed');
            expect(result.kind === 'failed' && result.reason).toContain('404 Not Found');
        });

        await it('does not call a package a closure when it holds no gtk/ directory', async () => {
            const empty = scratch('empty');
            const result = await acquireGtkRuntime({
                target: 'darwin-arm64',
                version: '0.64.4',
                discovery: { cwd: bareProject(), env: {} },
                ensure: async () => empty,
            });
            expect(result.kind).toBe('failed');
            expect(result.kind === 'failed' && result.reason).toContain('no complete gtk/ closure');
        });

        await it('probes win32 by its own native subdirectory, not by lib/', async () => {
            const dir = scratch('win');
            put(dir, 'gtk/bin/gtk-4-1.dll');
            put(dir, 'gtk/girepository-1.0/Gtk-4.0.typelib');
            const result = await acquireGtkRuntime({
                target: 'win32-x64',
                version: '0.64.4',
                discovery: { cwd: bareProject(), env: {} },
                ensure: async () => dir,
            });
            expect(result.kind).toBe('fetched');
        });
    });

    await describe('resolveGtkRuntime with a fetched directory', async () => {
        await it('uses it when nothing else resolves, and names it as fetched', async () => {
            const pkg = packageWithClosure();
            const found = resolveGtkRuntime('darwin-arm64', {
                cwd: bareProject(),
                env: {},
                fetchedGtkRuntimeDir: pkg,
            });
            expect(found?.source).toContain('fetched for this ship run');
            expect(found?.dir).toBe(join(pkg, 'gtk'));
        });

        await it('is the LAST candidate: the explicit override still wins', async () => {
            const fetchedPkg = packageWithClosure();
            const chosen = packageWithClosure();
            const found = resolveGtkRuntime('darwin-arm64', {
                cwd: bareProject(),
                env: { GJSIFY_GTK_RUNTIME: join(chosen, 'gtk') },
                fetchedGtkRuntimeDir: fetchedPkg,
            });
            expect(found?.source).toBe('GJSIFY_GTK_RUNTIME');
            expect(found?.dir).toBe(join(chosen, 'gtk'));
        });

        await it('is ignored when the fetched package is incomplete', async () => {
            const found = resolveGtkRuntime('darwin-arm64', {
                cwd: bareProject(),
                env: {},
                fetchedGtkRuntimeDir: scratch('incomplete'),
            });
            expect(found).toBe(null);
        });
    });
};
