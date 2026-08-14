// Which flavour `node:path` resolves to, and that BOTH still behave.
//
// The defect these pin (#1146): the package exported `posix` unconditionally, so on a
// win32 host every divergence was silent rather than wrong-looking —
// `dirname('C:\\app\\x.js')` answered `'.'`, a valid path, and the caller wrote into
// the CWD instead of failing.
//
// The win32 half is driven DIRECTLY, from whatever host runs this. Waiting for a win32
// runner to exercise win32 semantics is how they stayed unexercised: `windows-suites.yml`
// runs on `main` and the nightly, not on PRs, and no GJS-on-Windows host exists yet at
// all. A flavour reachable by name is a flavour a Linux runner can hold to its contract.

import { describe, expect, it } from '@gjsify/unit';
import { hostOs } from '@gjsify/utils/core';

import path, { posix, win32 } from 'node:path';
import { selectFlavour } from './flavour.js';
// The SAME instances the selector returns. `node:path` is a mapped specifier, so its
// re-exported namespaces are not object-identical to the local modules under the
// bundler — comparing across the two measures the module graph, not the decision.
import * as localPosix from './posix.js';
import * as localWin32 from './win32.js';

export default async () => {
    await describe('node:path host selection', async () => {
        await it('maps each host to its flavour, checkable from any host', () => {
            // THE HALF A LINUX RUNNER CAN ACTUALLY HOLD. On a POSIX host "selected per
            // host" and "posix hardcoded" produce identical values, so no runtime
            // observation below distinguishes them — and no GJS-on-Windows host exists
            // yet to notice. Taking the OS as an argument is what makes the decision
            // itself assertable here; `index.ts` has exactly one call into it.
            expect(selectFlavour('win32')).toBe(localWin32);
            expect(selectFlavour('linux')).toBe(localPosix);
            expect(selectFlavour('darwin')).toBe(localPosix);
            // A browser answers `undefined`, and must land on posix rather than nothing.
            expect(selectFlavour(undefined)).toBe(localPosix);
        });

        await it('resolves to the flavour matching this host', () => {
            // Across the two graphs, so this compares VALUES: the separator and a
            // couple of answers only one flavour can give. Function identity would be
            // measuring the bundler again.
            const expected = selectFlavour(hostOs());
            expect(path.sep).toBe(expected.sep);
            expect(path.delimiter).toBe(expected.delimiter);
            expect(path.isAbsolute('C:\\app')).toBe(expected.isAbsolute('C:\\app'));
            expect(path.dirname('C:\\app\\x.js')).toBe(expected.dirname('C:\\app\\x.js'));
        });

        await it('keeps both flavours reachable by name, as Node does', () => {
            expect(typeof posix.dirname).toBe('function');
            expect(typeof win32.dirname).toBe('function');
            expect(posix.sep).toBe('/');
            expect(win32.sep).toBe('\\');
            expect(posix.delimiter).toBe(':');
            expect(win32.delimiter).toBe(';');
        });

        await it('exposes the same names on both, so selection cannot lose one', () => {
            // The selection destructures a fixed list off whichever module won. A name
            // present on one flavour and missing on the other would be `undefined` at
            // the top level on exactly one host — the shape of the original bug.
            const names = Object.keys(posix).sort();
            expect(Object.keys(win32).sort()).toStrictEqual(names);
            for (const name of names) {
                expect((path as unknown as Record<string, unknown>)[name] !== undefined).toBe(true);
            }
        });
    });

    await describe('win32 semantics, driven from any host', async () => {
        await it('reads a drive-letter path as absolute and splits it', () => {
            // Each of these answered wrongly through the top-level export before the
            // host selection existed, and every answer was a legal path.
            expect(win32.isAbsolute('C:\\app')).toBe(true);
            expect(win32.dirname('C:\\app\\dist\\main.js')).toBe('C:\\app\\dist');
            expect(win32.basename('C:\\app\\x.xml')).toBe('x.xml');
            expect(win32.basename('C:\\app\\x.xml', '.xml')).toBe('x');
            expect(win32.extname('C:\\app\\x.xml')).toBe('.xml');
        });

        await it('joins and normalises with backslashes', () => {
            expect(win32.join('C:\\app', 'res')).toBe('C:\\app\\res');
            expect(win32.normalize('C:\\app\\..\\res\\')).toBe('C:\\res\\');
            expect(win32.join('a', 'b', '..', 'c')).toBe('a\\c');
        });

        await it('handles UNC paths, which have no POSIX counterpart', () => {
            expect(win32.isAbsolute('\\\\server\\share\\file')).toBe(true);
            expect(win32.toNamespacedPath('C:\\app')).toBe('\\\\?\\C:\\app');
        });

        await it('round-trips parse and format', () => {
            const parsed = win32.parse('C:\\app\\dist\\main.js');
            expect(parsed.root).toBe('C:\\');
            expect(parsed.dir).toBe('C:\\app\\dist');
            expect(parsed.base).toBe('main.js');
            expect(parsed.ext).toBe('.js');
            expect(parsed.name).toBe('main');
            expect(win32.format(parsed)).toBe('C:\\app\\dist\\main.js');
        });
    });

    await describe('posix semantics, driven from any host', async () => {
        await it('treats a drive letter as an ordinary relative name', () => {
            // The mirror of the win32 block: the same strings, the answers POSIX owes.
            // Kept explicit because this is what the top-level export USED to give on
            // every host, so a regression that reverts the selection shows up as the
            // host-selection test failing and these still passing.
            expect(posix.isAbsolute('C:\\app')).toBe(false);
            expect(posix.dirname('C:\\app\\dist\\main.js')).toBe('.');
            expect(posix.basename('C:\\app\\x.xml')).toBe('C:\\app\\x.xml');
        });

        await it('joins and normalises with forward slashes', () => {
            expect(posix.join('/app', 'res')).toBe('/app/res');
            expect(posix.normalize('/app/../res/')).toBe('/res/');
            expect(posix.dirname('/app/dist/main.js')).toBe('/app/dist');
        });
    });
};
