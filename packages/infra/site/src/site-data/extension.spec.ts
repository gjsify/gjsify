import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@gjsify/unit';

import { parseSiteConfig } from './config.js';
import {
    buildExtensionData,
    classifyPermissions,
    declaresNoDataCollection,
    isHostPermission,
    loadExtension,
    localeCandidates,
    parseExtensionManifest,
    resolveMessages,
} from './extension.js';

const catalogs = {
    en: { extName: { message: 'Beifahrer' }, extDescription: { message: 'Browse together' } },
    de: { extDescription: { message: 'Gemeinsam surfen' } },
    pt_BR: { extDescription: { message: 'Navegar' } },
};

const firefox = {
    manifest_version: 2,
    version: '1.2.3',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['storage', 'nativeMessaging'],
    optional_permissions: ['tabs', 'https://*/*'],
    browser_specific_settings: {
        gecko: { strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } },
    },
};
const chromium = {
    manifest_version: 3,
    version: '1.2.3',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['storage', 'nativeMessaging', 'scripting'],
    optional_permissions: ['tabs'],
    host_permissions: ['https://example.org/*'],
    optional_host_permissions: ['https://*/*'],
};

const site = (extension: unknown) => ({
    version: '1.0.0',
    gjsify: {
        site: {
            metainfo: 'm.xml',
            base: '/x/',
            url: 'https://example.org/x',
            repository: 'o/r',
            languages: ['en', 'de'],
            components: [{ id: 'extension', name: 'Extension' }],
            extension,
        },
    },
});

export default async () => {
    await describe('extension config', async () => {
        await it('accepts manifests, locales, a component and explanations in every language', async () => {
            const config = parseSiteConfig(
                site({
                    manifests: { firefox: 'a.json', chromium: 'b.json' },
                    locales: '_locales',
                    component: 'extension',
                    permissions: { nativeMessaging: { en: 'To reach the app', de: 'Um die App zu erreichen' } },
                }),
            );
            expect(Object.keys(config.extension!.manifests)).toStrictEqual(['firefox', 'chromium']);
            expect(config.extension!.component).toBe('extension');
        });

        await it('fails closed on malformed blocks', async () => {
            expect(() => parseSiteConfig(site({ manifests: {} }))).toThrow(/at least one/);
            expect(() => parseSiteConfig(site({}))).toThrow(/manifests/);
            expect(() => parseSiteConfig(site({ manifests: { opera: 'a.json' } }))).toThrow(/browser family/);
            expect(() => parseSiteConfig(site({ manifests: { firefox: 'a.json' }, typo: 1 }))).toThrow(/typo/);
            expect(() => parseSiteConfig(site({ manifests: { firefox: 'a.json' }, component: 'nope' }))).toThrow(
                /component/,
            );
            expect(() =>
                parseSiteConfig(site({ manifests: { firefox: 'a.json' }, permissions: { tabs: { en: 'x' } } })),
            ).toThrow(/de/);
        });
    });

    await describe('extension messages', async () => {
        await it('picks the language, then the default locale', async () => {
            expect(resolveMessages('__MSG_extDescription__', 'de', catalogs, 'en')).toBe('Gemeinsam surfen');
            expect(resolveMessages('__MSG_extName__', 'de', catalogs, 'en')).toBe('Beifahrer');
            expect(resolveMessages('__MSG_extDescription__', 'pt-BR', catalogs, 'en')).toBe('Navegar');
            expect(resolveMessages('plain', 'de', catalogs, 'en')).toBe('plain');
        });

        await it('fails on a missing key or on missing locales', async () => {
            expect(() => resolveMessages('__MSG_nope__', 'en', catalogs, 'en')).toThrow(/nope/);
            expect(() => resolveMessages('__MSG_extName__', 'en', {}, 'en')).toThrow(/locales/);
        });

        await it('maps site languages to locale directories', async () => {
            expect(localeCandidates('pt-BR', ['en', 'pt_BR'])).toStrictEqual(['pt_BR']);
            expect(localeCandidates('de', ['en', 'de_AT'])).toStrictEqual([]);
        });
    });

    await describe('extension permissions', async () => {
        await it('tells host patterns from API names', async () => {
            expect(isHostPermission('https://*/*')).toBe(true);
            expect(isHostPermission('<all_urls>')).toBe(true);
            expect(isHostPermission('tabs')).toBe(false);
        });

        await it('merges MV2 and MV3 and names the browsers that differ', async () => {
            const { required, optional } = classifyPermissions([
                { family: 'firefox', manifest: firefox },
                { family: 'chromium', manifest: chromium },
            ]);
            expect(required.map((entry) => entry.name)).toStrictEqual([
                'storage',
                'nativeMessaging',
                'scripting',
                'https://example.org/*',
            ]);
            expect(required.find((entry) => entry.name === 'scripting')!.families).toStrictEqual(['chromium']);
            expect(required.find((entry) => entry.name === 'storage')!.families).toStrictEqual(['firefox', 'chromium']);
            // MV2 keeps hosts in optional_permissions; MV3 has a separate list. Both land in `optional`.
            expect(optional.map((entry) => [entry.name, entry.host, entry.families.length])).toStrictEqual([
                ['tabs', false, 2],
                ['https://*/*', true, 2],
            ]);
        });

        await it('lists a permission in both groups when browsers disagree', async () => {
            const { required, optional } = classifyPermissions([
                { family: 'firefox', manifest: { permissions: [], optional_permissions: ['tabs'] } },
                { family: 'chromium', manifest: { permissions: ['tabs'] } },
            ]);
            expect(required.map((entry) => entry.name)).toStrictEqual(['tabs']);
            expect(optional.map((entry) => entry.name)).toStrictEqual(['tabs']);
        });
    });

    await describe('extension data', async () => {
        await it('detects the data-collection declaration', async () => {
            expect(declaresNoDataCollection(firefox)).toBe(true);
            expect(declaresNoDataCollection(chromium)).toBe(false);
            const some = { browser_specific_settings: { gecko: { data_collection_permissions: { required: ['x'] } } } };
            expect(declaresNoDataCollection(some)).toBe(false);
        });

        await it('reads versions and resolves texts per language', async () => {
            const browser = parseExtensionManifest('firefox', firefox, ['en', 'de'], catalogs);
            expect(browser.minVersion).toBe('140.0');
            expect(browser.manifestVersion).toBe(2);
            expect(browser.description.de).toBe('Gemeinsam surfen');
            const data = buildExtensionData(
                { manifests: {}, permissions: {} },
                [{ family: 'firefox', manifest: firefox }],
                ['en', 'de'],
                catalogs,
            );
            expect(data.collectsNoData).toBe(true);
            expect(data.locales).toStrictEqual(['de', 'en', 'pt_BR']);
        });

        await it('names the path and says to build first when a manifest is missing', async () => {
            const root = mkdtempSync(join(tmpdir(), 'ext-'));
            try {
                let message = '';
                try {
                    await loadExtension({ manifests: { firefox: 'out/manifest.json' }, permissions: {} }, root, ['en']);
                } catch (error) {
                    message = (error as Error).message;
                }
                expect(message).toMatch(/out\/manifest\.json.*build the extension first/);
                mkdirSync(join(root, 'out'));
                writeFileSync(
                    join(root, 'out/manifest.json'),
                    JSON.stringify({ ...firefox, name: 'X', description: 'Y' }),
                );
                const data = await loadExtension(
                    { manifests: { firefox: 'out/manifest.json' }, permissions: {} },
                    root,
                    ['en'],
                );
                expect(data.browsers[0]!.name.en).toBe('X');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};
