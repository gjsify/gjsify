// @gjsify/adwaita-app — locale-env tests.
// Runs on GJS + Node (pure logic, explicit platform and environment).

import { describe, expect, it } from '@gjsify/unit';
import { localeEnvToSet, posixLocale } from './locale-env.js';

export default async () => {
    await describe('posixLocale', async () => {
        await it('maps BCP 47 tags to ll_CC', () => {
            expect(posixLocale('de-DE')).toBe('de_DE');
            expect(posixLocale('en-us')).toBe('en_US');
            expect(posixLocale('de')).toBe('de');
        });

        await it('drops script and extension subtags', () => {
            expect(posixLocale('zh-Hant-TW')).toBe('zh_TW');
            expect(posixLocale('de-DE-u-ca-gregory')).toBe('de_DE');
        });

        await it('normalises POSIX names and refuses C', () => {
            expect(posixLocale('de_DE.UTF-8')).toBe('de_DE');
            expect(posixLocale('fr_CA@euro')).toBe('fr_CA');
            expect(posixLocale('C')).toBe(undefined);
            expect(posixLocale('POSIX')).toBe(undefined);
            expect(posixLocale('')).toBe(undefined);
            expect(posixLocale(undefined)).toBe(undefined);
        });
    });

    await describe('localeEnvToSet', async () => {
        await it('derives LANG on win32 when no variable is set', () => {
            expect(localeEnvToSet({ platform: 'win32', env: {}, userLocales: ['de-DE'] })).toBe('de_DE');
        });

        await it('counts an empty value as unset', () => {
            expect(localeEnvToSet({ platform: 'win32', env: { LANG: '', LC_ALL: ' ' }, userLocales: ['de-DE'] })).toBe(
                'de_DE',
            );
        });

        await it('changes nothing when any of the four variables is set', () => {
            for (const name of ['LANGUAGE', 'LC_ALL', 'LC_MESSAGES', 'LANG']) {
                expect(localeEnvToSet({ platform: 'win32', env: { [name]: 'en_US' }, userLocales: ['de-DE'] })).toBe(
                    undefined,
                );
            }
        });

        await it('is a no-op off win32 or without a platform', () => {
            for (const platform of ['linux', 'darwin', 'freebsd', undefined]) {
                expect(localeEnvToSet({ platform, env: {}, userLocales: ['de-DE'] })).toBe(undefined);
            }
        });

        await it('takes the first usable candidate', () => {
            expect(
                localeEnvToSet({ platform: 'win32', env: {}, userLocales: [undefined, 'C', 'fr-FR', 'de-DE'] }),
            ).toBe('fr_FR');
            expect(localeEnvToSet({ platform: 'win32', env: {}, userLocales: [] })).toBe(undefined);
        });
    });
};
