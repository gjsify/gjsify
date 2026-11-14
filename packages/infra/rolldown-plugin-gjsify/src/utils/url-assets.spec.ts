// SPDX-License-Identifier: MIT
// `new URL('./x.wasm', import.meta.url)` in a bundled dependency: which literals count as
// runtime assets, and that they land beside the bundle, where the module-resolve shim's
// no-node_modules fallback looks for them.

import { describe, expect, it } from '@gjsify/unit';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findUrlAssets, UrlAssets } from './url-assets.js';

function pkg(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-url-assets-'));
    for (const [name, text] of Object.entries(files)) {
        mkdirSync(join(root, name, '..'), { recursive: true });
        writeFileSync(join(root, name), text);
    }
    return root;
}

export default async () => {
    await describe('findUrlAssets', async () => {
        await it('detects a literal sibling wasm file', async () => {
            const root = pkg({ 'index.js': '', 'mtcute-simd.wasm': 'wasm' });
            const src = `const u = new URL("./mtcute-simd.wasm", import.meta.url);`;
            expect(findUrlAssets(src, join(root, 'index.js'))).toStrictEqual([
                { source: join(root, 'mtcute-simd.wasm'), dest: 'mtcute-simd.wasm' },
            ]);
        });
        await it('keeps a subdirectory in the destination, POSIX-separated', async () => {
            const root = pkg({ 'index.js': '', 'data/x.json': '{}' });
            const found = findUrlAssets(`new URL('./data/x.json', import.meta.url)`, join(root, 'index.js'));
            expect(found.map((a) => a.dest)).toStrictEqual(['data/x.json']);
        });
        await it('ignores JS modules', async () => {
            const root = pkg({ 'index.js': '', 'w.js': '' });
            expect(findUrlAssets(`new URL('./w.js', import.meta.url)`, join(root, 'index.js'))).toStrictEqual([]);
        });
        await it('ignores non-literal specifiers and other bases', async () => {
            const root = pkg({ 'index.js': '', 'a.wasm': '' });
            const path = join(root, 'index.js');
            expect(findUrlAssets(`new URL(name, import.meta.url)`, path)).toStrictEqual([]);
            expect(findUrlAssets('new URL(`./a.wasm`, import.meta.url)', path)).toStrictEqual([]);
            expect(findUrlAssets(`new URL('./a.wasm', base)`, path)).toStrictEqual([]);
        });
        await it('ignores missing files, remote URLs and paths leaving the package', async () => {
            const root = pkg({ 'index.js': '' });
            const path = join(root, 'index.js');
            expect(findUrlAssets(`new URL('./gone.wasm', import.meta.url)`, path)).toStrictEqual([]);
            expect(findUrlAssets(`new URL('https://x.test/a.wasm', import.meta.url)`, path)).toStrictEqual([]);
            expect(findUrlAssets(`new URL('../a.wasm', import.meta.url)`, path)).toStrictEqual([]);
        });
    });

    await describe('UrlAssets', async () => {
        await it('copies collected assets beside the bundle', async () => {
            const root = pkg({ 'index.js': '', 'm.wasm': 'bytes' });
            const out = mkdtempSync(join(tmpdir(), 'gjsify-url-assets-out-'));
            const assets = new UrlAssets();
            for (const a of findUrlAssets(`new URL('./m.wasm', import.meta.url)`, join(root, 'index.js')))
                assets.add(a);
            expect(assets.writeTo(out)).toStrictEqual(['m.wasm']);
            expect(existsSync(join(out, 'm.wasm'))).toBe(true);
            expect(readFileSync(join(out, 'm.wasm'), 'utf8')).toBe('bytes');
        });
        await it('reports a destination wanted from two sources and keeps the first', async () => {
            const assets = new UrlAssets();
            expect(assets.add({ source: '/a/m.wasm', dest: 'm.wasm' })).toBe(null);
            expect(assets.add({ source: '/a/m.wasm', dest: 'm.wasm' })).toBe(null);
            expect(typeof assets.add({ source: '/b/m.wasm', dest: 'm.wasm' })).toBe('string');
            expect(assets.entries()).toStrictEqual([{ source: '/a/m.wasm', dest: 'm.wasm' }]);
        });
    });
};
