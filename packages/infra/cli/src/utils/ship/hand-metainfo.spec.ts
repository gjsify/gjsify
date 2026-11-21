// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@gjsify/unit';

import { checkHandMetainfo, resolveHandMetainfo } from './hand-metainfo.js';

const APP_ID = 'eu.example.Demo';

const file = (id: string, launchable: string, release = '1.2.3'): string =>
    `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${id}</id>
  <name>Demo</name>
  <name xml:lang="de">Beispiel</name>
  <launchable type="desktop-id">${launchable}</launchable>
  <releases><release version="${release}" date="2026-01-01"/></releases>
</component>
`;

const hand = (xml: string) => ({ path: 'data/x.metainfo.xml', xml, key: 'gjsify.ship.metainfo' as const });
const expectation = { appId: APP_ID, kind: 'app' as const, version: '1.2.3' };

export default async () => {
    await describe('hand-written metainfo', async () => {
        await it('reads ship.metainfo verbatim, relative to the project', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-hand-'));
            try {
                const xml = file(APP_ID, `${APP_ID}.desktop`);
                writeFileSync(join(dir, 'm.xml'), xml);
                const resolved = resolveHandMetainfo({ shipMetainfo: 'm.xml', projectDir: dir });
                expect(resolved?.xml).toBe(xml);
                expect(resolved?.key).toBe('gjsify.ship.metainfo');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('falls back to site.metainfo, and to rendering when neither is set', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-hand-'));
            try {
                writeFileSync(join(dir, 's.xml'), file(APP_ID, `${APP_ID}.desktop`));
                expect(resolveHandMetainfo({ siteMetainfo: 's.xml', projectDir: dir })?.key).toBe(
                    'gjsify.site.metainfo',
                );
                expect(resolveHandMetainfo({ projectDir: dir })).toBe(undefined);
                // A project that already declares releases keeps rendering under the fallback.
                expect(resolveHandMetainfo({ siteMetainfo: 's.xml', configReleases: [{}], projectDir: dir })).toBe(
                    undefined,
                );
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('refuses a missing file and a releases conflict', async () => {
            expect(() => resolveHandMetainfo({ shipMetainfo: 'nope.xml', projectDir: tmpdir() })).toThrow(
                'does not exist',
            );
            expect(() =>
                resolveHandMetainfo({ shipMetainfo: 'm.xml', configReleases: [{}], projectDir: tmpdir() }),
            ).toThrow('both describe the releases');
        });

        await it('accepts a matching file without warnings', async () => {
            expect(checkHandMetainfo(hand(file(APP_ID, `${APP_ID}.desktop`)), expectation).length).toBe(0);
        });

        await it('refuses an <id> that is not the appId', async () => {
            expect(() => checkHandMetainfo(hand(file('eu.example.Other', `${APP_ID}.desktop`)), expectation)).toThrow(
                'eu.example.Other',
            );
        });

        await it('refuses a launchable that is not <appId>.desktop', async () => {
            expect(() => checkHandMetainfo(hand(file(APP_ID, 'other.desktop')), expectation)).toThrow('other.desktop');
        });

        await it('warns, but does not refuse, when the package version has no <release>', async () => {
            const warnings = checkHandMetainfo(hand(file(APP_ID, `${APP_ID}.desktop`, '1.0.0')), expectation);
            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain('1.2.3');
        });
    });
};
