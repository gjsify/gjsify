// @gjsify/adwaita-app — readAppDevHooks tests.
// Runs on GJS + Node (pure logic, explicit env — no platform imports).

import { describe, expect, it } from '@gjsify/unit';
import { readAppDevHooks } from './dev-hooks.js';

export default async () => {
    await describe('readAppDevHooks', async () => {
        await it('reads VIEW / FILE / DEBUG under the given prefix', () => {
            const hooks = readAppDevHooks({
                prefix: 'BH_APP',
                env: { BH_APP_VIEW: 'konten', BH_APP_FILE: '/tmp/x.json', BH_APP_DEBUG: '1' },
            });
            expect(hooks.view).toBe('konten');
            expect(hooks.file).toBe('/tmp/x.json');
            expect(hooks.debug).toBe(true);
        });

        await it('treats missing / empty values as unset', () => {
            const hooks = readAppDevHooks({ prefix: 'ER_APP', env: { ER_APP_VIEW: '' } });
            expect(hooks.view).toBeUndefined();
            expect(hooks.file).toBeUndefined();
            expect(hooks.debug).toBe(false);
        });

        await it('honours the prefix (no cross-talk between apps)', () => {
            const hooks = readAppDevHooks({ prefix: 'ER_APP', env: { BH_APP_VIEW: 'konten' } });
            expect(hooks.view).toBeUndefined();
        });

        await it('parses falsey DEBUG spellings as false', () => {
            for (const value of ['0', 'false', 'no', 'FALSE', 'No']) {
                expect(readAppDevHooks({ prefix: 'P', env: { P_DEBUG: value } }).debug).toBe(false);
            }
        });

        await it('parses truthy DEBUG spellings as true', () => {
            for (const value of ['1', 'true', 'yes', 'on']) {
                expect(readAppDevHooks({ prefix: 'P', env: { P_DEBUG: value } }).debug).toBe(true);
            }
        });
    });
};
