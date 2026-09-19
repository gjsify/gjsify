// @gjsify/adwaita-app — resolveLocaleDir tests.
// Runs on GJS + Node (pure logic, explicit env — no platform imports).

import { describe, expect, it } from '@gjsify/unit';
import { SYSTEM_LOCALE_DIR, resolveLocaleDir, systemLocaleDir } from './locale-dir.js';

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

        // `/usr/share/locale` does not exist on Windows and DOES exist on macOS, where it holds
        // Apple's locale data and never an app's catalogues — so the old unconditional fallback
        // bound a real directory that could not resolve one msgid. Nothing is the true answer.
        await it('gives darwin and win32 no system directory at all', () => {
            expect(resolveLocaleDir({ platform: 'darwin' })).toBe(undefined);
            expect(resolveLocaleDir({ platform: 'win32' })).toBe(undefined);
            expect(systemLocaleDir('darwin')).toBe(undefined);
            expect(systemLocaleDir('win32')).toBe(undefined);
        });

        // The steps ABOVE the system one are what a shipped app actually reaches, on every OS:
        // its launcher exports `GJSIFY_LOCALE_DIR` whenever it staged catalogues. Dropping the
        // system default must not have dropped those, or the `.app` loses its translations.
        await it('still answers darwin and win32 from the bundle', () => {
            const env = { GJSIFY_LOCALE_DIR: '/Applications/Hello.app/Contents/Resources/share/locale' };
            expect(resolveLocaleDir({ platform: 'darwin', env })).toBe(env.GJSIFY_LOCALE_DIR);
            expect(resolveLocaleDir({ platform: 'win32', fallbackDir: 'C:\\Hello\\share\\locale' })).toBe(
                'C:\\Hello\\share\\locale',
            );
        });

        // Linux is untouched, and so is every platform this project did not measure — including
        // the `undefined` a `--globals none` GJS bundle has instead of a `process.platform`.
        await it('leaves linux and every unmeasured platform as they were', () => {
            expect(resolveLocaleDir({ platform: 'linux' })).toBe(SYSTEM_LOCALE_DIR);
            expect(resolveLocaleDir({ platform: 'freebsd' })).toBe(SYSTEM_LOCALE_DIR);
            expect(systemLocaleDir(undefined)).toBe(SYSTEM_LOCALE_DIR);
            expect(systemLocaleDir()).toBe(SYSTEM_LOCALE_DIR);
        });
    });
};
