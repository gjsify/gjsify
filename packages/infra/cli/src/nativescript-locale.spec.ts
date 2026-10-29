// SPDX-License-Identifier: MIT
// The `.mo` tree `--app nativescript` stages: one asset per POSIX locale directory, named
// `<domain>.mo`, so `bindtextdomain(domain, <filesDir>/app/locale)` finds it on Android.
//
// Tested from @gjsify/cli's harness because the plugin package has no `test:node` script.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectLocaleAssets } from '@gjsify/rolldown-plugin-gjsify';

const withPo = async (names: string[], fn: (dir: string) => Promise<void>): Promise<void> => {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-ns-locale-'));
    try {
        for (const name of names) writeFileSync(join(dir, `${name}.po`), '');
        await fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
};

const fakeMsgfmt = async (poFile: string): Promise<Uint8Array> => new TextEncoder().encode(poFile);

export default async () => {
    await describe('--app nativescript: locale assets', async () => {
        await it('emits locale/<lang>/LC_MESSAGES/<domain>.mo per catalog, sorted', async () => {
            await withPo(['fr', 'de'], async (poDirectory) => {
                const assets = await collectLocaleAssets({ poDirectory, domain: 'org.example.App' }, fakeMsgfmt);
                expect(assets.map((a) => a.fileName).join()).toBe(
                    'locale/de/LC_MESSAGES/org.example.App.mo,locale/fr/LC_MESSAGES/org.example.App.mo',
                );
            });
        });

        await it('installs a script-tagged catalog under the names glibc probes', async () => {
            await withPo(['zh_Hans'], async (poDirectory) => {
                const assets = await collectLocaleAssets({ poDirectory, domain: 'd' }, fakeMsgfmt);
                const names = assets.map((a) => a.fileName);
                expect(names).toContain('locale/zh_CN/LC_MESSAGES/d.mo');
                expect(names.length > 1).toBe(true);
            });
        });

        await it('names a missing PO directory instead of emitting nothing', async () => {
            let message = '';
            try {
                await collectLocaleAssets({ poDirectory: '/nonexistent/po', domain: 'd' }, fakeMsgfmt);
            } catch (e) {
                message = String(e);
            }
            expect(message).toContain('does not exist');
        });
    });
};
