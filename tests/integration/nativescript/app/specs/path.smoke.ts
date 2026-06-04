// SPDX-License-Identifier: MIT
// Smoke spec for @gjsify/path (nativescript:'polyfill' slot) on NS V8.
// Behaviour cross-checked against refs/node/test/parallel/test-path-*.js.
// Imports only the portable package under test + the on-device reporter —
// never @gjsify/unit (keeps gi:// / process.exit out of the NS bundle).
import * as path from '@gjsify/path';
import { describe, it, expect } from '../reporter.js';

export default async function pathSmoke(): Promise<void> {
    await describe('@gjsify/path', async () => {
        await it('posix join', () => {
            expect(path.posix.join('/foo', 'bar', 'baz/asdf', 'quux', '..')).toBe('/foo/bar/baz/asdf');
        });
        await it('posix resolve', () => {
            expect(path.posix.resolve('/foo/bar', './baz')).toBe('/foo/bar/baz');
        });
        await it('posix normalize', () => {
            expect(path.posix.normalize('/foo/bar//baz/asdf/quux/..')).toBe('/foo/bar/baz/asdf');
        });
        await it('basename strips a known extension', () => {
            expect(path.basename('/foo/bar/baz.html', '.html')).toBe('baz');
        });
        await it('extname of a multi-dotted name', () => {
            expect(path.extname('index.coffee.md')).toBe('.md');
        });
        await it('parse round-trips dir + base', () => {
            const p = path.posix.parse('/home/user/dir/file.txt');
            expect(p.root).toBe('/');
            expect(p.dir).toBe('/home/user/dir');
            expect(p.base).toBe('file.txt');
            expect(p.ext).toBe('.txt');
            expect(p.name).toBe('file');
        });
        await it('sep + delimiter are posix', () => {
            expect(path.posix.sep).toBe('/');
            expect(path.posix.delimiter).toBe(':');
        });
    });
}
