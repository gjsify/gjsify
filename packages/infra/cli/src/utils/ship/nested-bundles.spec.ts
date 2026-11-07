// SPDX-License-Identifier: MIT
// Staging and signing-path derivation for nested bundles and helper executables
// (ADR 0024 amendment, "nested bundles and helper executables"; the beifahrer
// ADR this answers: 0026 § 6).

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LAYOUTS } from './layout.js';
import { signedSubordinatesFor, stageSubordinates } from './nested-bundles.js';

const IDENTITY = { binaryName: 'ship-demo', name: 'Ship Demo' };

function scratch(): string {
    return mkdtempSync(join(tmpdir(), 'gjsify-nested-bundles-'));
}

export default async () => {
    await describe('stageSubordinates', async () => {
        await it('is empty given nothing to stage', () => {
            expect(
                stageSubordinates({
                    layout: LAYOUTS.darwin,
                    identity: IDENTITY,
                    nestedBundles: [],
                    helperExecutables: [],
                }),
            ).toStrictEqual({ files: [], nestedBundles: [], helperExecutables: [] });
        });

        await it('stages a nested bundle TREE-PRESERVING under Contents/PlugIns, and a helper flat under Contents/Helpers', () => {
            const dir = scratch();
            try {
                mkdirSync(join(dir, 'Ext.appex', 'Contents', 'MacOS'), { recursive: true });
                // No chmod: the bundle executable is 0o755 by position, the same on a
                // host whose filesystem has no POSIX bits (win32) as on this one.
                writeFileSync(join(dir, 'Ext.appex', 'Contents', 'MacOS', 'Ext'), 'macho');
                writeFileSync(join(dir, 'Ext.appex', 'Contents', 'Info.plist'), 'plist');
                writeFileSync(join(dir, 'helper-bin'), 'swift');

                const result = stageSubordinates({
                    layout: LAYOUTS.darwin,
                    identity: IDENTITY,
                    nestedBundles: [{ source: join(dir, 'Ext.appex'), name: 'Ext.appex', entitlements: ['a'] }],
                    helperExecutables: [{ source: join(dir, 'helper-bin'), name: 'helper', entitlements: [] }],
                });

                const paths = result.files.map((f) => f.path).sort();
                expect(paths).toStrictEqual([
                    'Ship Demo.app/Contents/Helpers/helper',
                    'Ship Demo.app/Contents/PlugIns/Ext.appex/Contents/Info.plist',
                    'Ship Demo.app/Contents/PlugIns/Ext.appex/Contents/MacOS/Ext',
                ]);
                // The Mach-O under the bundle is executable; the plist is not.
                const macho = result.files.find((f) => f.path.endsWith('/MacOS/Ext'));
                expect(macho?.mode).toBe(0o755);
                const plist = result.files.find((f) => f.path.endsWith('Info.plist'));
                expect(plist?.mode).toBe(0o644);
                const helper = result.files.find((f) => f.path.endsWith('/Helpers/helper'));
                expect(helper?.mode).toBe(0o755);

                expect(result.nestedBundles).toStrictEqual([
                    { path: 'Ship Demo.app/Contents/PlugIns/Ext.appex', entitlements: ['a'] },
                ]);
                expect(result.helperExecutables).toStrictEqual([
                    { path: 'Ship Demo.app/Contents/Helpers/helper', entitlements: [] },
                ]);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('refuses a nested bundle on a layout with no `plugins` slot', () => {
            expect(() =>
                stageSubordinates({
                    layout: LAYOUTS.linux,
                    identity: IDENTITY,
                    nestedBundles: [{ source: '/tmp/x', name: 'x', entitlements: [] }],
                    helperExecutables: [],
                }),
            ).toThrow(/no `Contents\/PlugIns` equivalent/);
        });

        await it('refuses a helper executable on a layout with no `helpers` slot', () => {
            expect(() =>
                stageSubordinates({
                    layout: LAYOUTS.windows,
                    identity: IDENTITY,
                    nestedBundles: [],
                    helperExecutables: [{ source: '/tmp/x', name: 'x', entitlements: [] }],
                }),
            ).toThrow(/no `Contents\/Helpers` equivalent/);
        });
    });

    await describe('signedSubordinatesFor', async () => {
        await it('derives the SAME stage-relative paths stageSubordinates placed the bytes at', () => {
            const facts = {
                nestedBundles: [{ name: 'Ext.appex', entitlements: ['a'] }],
                helperExecutables: [{ name: 'helper', entitlements: [] }],
            };
            expect(signedSubordinatesFor(LAYOUTS.darwin, IDENTITY, facts)).toStrictEqual({
                nestedBundles: [{ path: 'Ship Demo.app/Contents/PlugIns/Ext.appex', entitlements: ['a'] }],
                helperExecutables: [{ path: 'Ship Demo.app/Contents/Helpers/helper', entitlements: [] }],
            });
        });

        await it('is empty given no facts', () => {
            expect(
                signedSubordinatesFor(LAYOUTS.darwin, IDENTITY, { nestedBundles: [], helperExecutables: [] }),
            ).toStrictEqual({ nestedBundles: [], helperExecutables: [] });
        });
    });
};
