// @gjsify/adwaita-app — resolveLocaleDir tests.
// Runs on GJS + Node (pure logic, explicit env — no platform imports).

import { describe, expect, it } from '@gjsify/unit';
import { SYSTEM_LOCALE_DIR, resolveLocaleDir } from './locale-dir.js';

export default async () => {
    await describe('resolveLocaleDir', async () => {
        await it('prefers an explicit directory over the environment', () => {
            const dir = resolveLocaleDir({
                localeDir: '/build/dist/locale',
                env: { GJSIFY_LOCALE_DIR: '/usr/share/locale' },
                fallbackDir: '/ignored',
            });
            expect(dir).toBe('/build/dist/locale');
        });

        await it('reads GJSIFY_LOCALE_DIR when no directory is passed', () => {
            expect(resolveLocaleDir({ env: { GJSIFY_LOCALE_DIR: '/app/share/locale' } })).toBe('/app/share/locale');
        });

        await it('falls back to the caller directory, then to the system one', () => {
            expect(resolveLocaleDir({ fallbackDir: '/opt/x/share/locale' })).toBe('/opt/x/share/locale');
            expect(resolveLocaleDir()).toBe(SYSTEM_LOCALE_DIR);
            expect(resolveLocaleDir({ env: {} })).toBe(SYSTEM_LOCALE_DIR);
        });

        // The launcher exports the variable only when it staged catalogues, but a wrapper script
        // that sets it unconditionally passes ''. `bindtextdomain(domain, '')` binds to the CURRENT
        // DIRECTORY, and a lookup there fails exactly like an app with no translation at all.
        await it('treats an empty or blank value as unset', () => {
            expect(resolveLocaleDir({ env: { GJSIFY_LOCALE_DIR: '' } })).toBe(SYSTEM_LOCALE_DIR);
            expect(resolveLocaleDir({ env: { GJSIFY_LOCALE_DIR: '   ' } })).toBe(SYSTEM_LOCALE_DIR);
            expect(resolveLocaleDir({ localeDir: '', env: { GJSIFY_LOCALE_DIR: '/from/env' } })).toBe('/from/env');
            expect(resolveLocaleDir({ localeDir: '', fallbackDir: '' })).toBe(SYSTEM_LOCALE_DIR);
        });

        await it('trims surrounding whitespace off a real value', () => {
            expect(resolveLocaleDir({ env: { GJSIFY_LOCALE_DIR: '  /app/share/locale\n' } })).toBe('/app/share/locale');
        });
    });
};
