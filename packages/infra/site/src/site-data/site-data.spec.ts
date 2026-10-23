// The data layer, from one parser at a time up to `loadSiteData` over a whole repository.
//
// The repository it loads is WRITTEN OUT per case (`withFixture`) rather than committed. These
// specs are bundled before they run, so a committed fixture would have to be located by a
// relative walk from the outfile — and where the outfile sits is the one thing a case about
// AppStream parsing must not depend on. A generated fixture also keeps the expectations readable:
// "six screenshots" means something when the six are three lines above.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from '@gjsify/unit';

import { parseSiteConfig } from './config.js';
import {
    DOWNLOAD_LABELS,
    FORMAT_LABELS,
    buildDownloadTargets,
    classifyAsset,
    componentOf,
    defaultLabel,
} from './downloads.js';
import { parseFlathubStats, parseFlathubSummary } from './flathub.js';
import { fetchLatestRelease, parseLatestRelease } from './github.js';
import { loadSiteData } from './load.js';
import { parseMetainfo } from './metainfo.js';
import { loadPrivacyStatements } from './privacy.js';
import { buildAppManifest, loadRelatedApps, parseAppManifest, relatedText, relatedUrl } from './related.js';
import { fetchJson } from './network.js';
import { minimumAge } from './oars.js';
import { completeLocalized, parseCatalog, resolveLocalized } from './po.js';
import { imageSlug, repositoryPath, resolveScreenshots } from './screenshots.js';
import { epcPayload, formatIban, isValidBic, isValidIban } from './sepa.js';
import type { ReleaseAsset } from './types.js';

/** The smallest valid PNG: one transparent pixel. The loader only asks whether the bytes exist. */
const PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
);

const METAINFO = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>org.example.Notes</id>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>GPL-3.0-or-later</project_license>
  <name>Notes</name>
  <name xml:lang="de">Notizen</name>
  <summary>Write things down</summary>
  <summary xml:lang="de">Dinge aufschreiben</summary>
  <developer id="org.example"><name>Example Developer</name></developer>
  <description>
    <p>A small note taker.</p>
    <p xml:lang="de">Ein kleiner Notizblock.</p>
  </description>
  <content_rating type="oars-1.1"><content_attribute id="violence-cartoon">mild</content_attribute></content_rating>
  <url type="homepage">https://example.org/notes</url>
  <screenshots>
    <screenshot type="default">
      <image>https://raw.githubusercontent.com/example/notes/refs/tags/v1.2.0/data/list.png</image>
      <caption>The note list</caption>
      <caption xml:lang="de">Die Notizliste</caption>
    </screenshot>
    <screenshot>
      <image>https://raw.githubusercontent.com/example/notes/main/data/editor.png</image>
      <caption>Editing a note</caption>
    </screenshot>
  </screenshots>
  <releases>
    <release version="1.2.0" date="2026-03-01">
      <description><p>Faster search.</p></description>
    </release>
  </releases>
</component>
`;

/** What the metainfo's `<image>` URLs point at, inside the fixture repository. */
const SCREENSHOT_FILES = ['list.png', 'editor.png'];

/** The `gjsify.site` block of the fixture repository; a case may override any key. */
const fixtureSite = (overrides: Record<string, unknown> = {}) => ({
    metainfo: 'data/notes.metainfo.xml',
    base: '/notes/',
    url: 'https://example.org/notes',
    repository: 'example/notes',
    languages: ['en', 'de'],
    ...overrides,
});

/** Runs `body` against a fresh fixture repository and removes it afterwards, failure or not. */
async function withFixture(
    body: (root: string) => Promise<void> | void,
    site: Record<string, unknown> = fixtureSite(),
): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-site-'));
    const write = (path: string, content: string | Buffer) => {
        const file = join(root, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
    };
    try {
        write('package.json', JSON.stringify({ name: 'notes', version: '1.2.0', gjsify: { site } }));
        write('data/notes.metainfo.xml', METAINFO);
        for (const name of SCREENSHOT_FILES) write(join('data', name), PIXEL_PNG);
        await body(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

const asset = (name: string): ReleaseAsset => ({
    name,
    size: 1,
    downloadUrl: `https://example.org/${name}`,
    downloadCount: 2,
});

/** The `gjsify.site` of a config-validation case: the four required keys plus what it is about. */
const manifest = (site: Record<string, unknown>) => ({
    version: '1.0.0',
    gjsify: { site: { metainfo: 'm.xml', base: '/x/', url: 'https://example.org/x', repository: 'o/r', ...site } },
});

export default async () => {
    await describe('screenshots', async () => {
        await it('reads an <image> of this repository from the checkout, whichever ref it pins', async () => {
            const raw = 'https://raw.githubusercontent.com/';
            expect(repositoryPath(`${raw}example/notes/refs/tags/v1.2.0/data/list.png`, 'example/notes')).toBe(
                'data/list.png',
            );
            expect(repositoryPath(`${raw}example/notes/main/data/list.png`, 'example/notes')).toBe('data/list.png');
            expect(repositoryPath(`${raw}Example/Notes/main/data/a%20b.png`, 'example/notes')).toBe('data/a b.png');
            // Another repository, another host, and a URL with no path left are all "not ours".
            expect(repositoryPath(`${raw}other/app/main/a.png`, 'example/notes')).toBeUndefined();
            expect(repositoryPath('https://example.org/1.png', 'example/notes')).toBeUndefined();
            expect(repositoryPath(`${raw}example/notes/main/`, 'example/notes')).toBeUndefined();
        });

        await it('flattens a path into one filename stem', async () => {
            expect(imageSlug('misc/screenshots/Editor 1.png')).toBe('misc-screenshots-editor-1');
            expect(imageSlug('/1.png')).toBe('1');
        });

        await it('takes the metainfo list in order, with its captions', async () => {
            await withFixture(async (root) => {
                const metainfo = parseMetainfo(METAINFO);
                const shots = await resolveScreenshots(metainfo, { root, repository: 'example/notes' });
                expect(shots.length).toBe(2);
                expect(shots.map((shot) => shot.slug)).toStrictEqual(['data-list', 'data-editor']);
                expect(shots[0]!.file).toBe(join(root, 'data/list.png'));
                expect(shots[0]!.caption?.byLanguage.de).toBe('Die Notizliste');
            });
        });

        await it('skips a screenshot it cannot find and says which', async () => {
            await withFixture(async (root) => {
                rmSync(join(root, 'data/editor.png'));
                const warnings: string[] = [];
                const metainfo = parseMetainfo(METAINFO);
                const shots = await resolveScreenshots(metainfo, {
                    root,
                    repository: 'example/notes',
                    warn: (message) => warnings.push(message),
                });
                expect(shots.length).toBe(1);
                expect(warnings.some((message) => message.includes('data/editor.png'))).toBe(true);
            });
        });

        await it('skips artwork hosted elsewhere when the build is offline', async () => {
            await withFixture(async (root) => {
                const warnings: string[] = [];
                const metainfo = parseMetainfo(METAINFO);
                metainfo.screenshots = [{ url: 'https://example.org/promo.png', caption: null }];
                const shots = await resolveScreenshots(metainfo, {
                    root,
                    repository: 'example/notes',
                    cacheDir: join(root, 'cache'),
                    offline: true,
                    warn: (message) => warnings.push(message),
                });
                expect(shots.length).toBe(0);
                expect(warnings.some((message) => message.includes('offline'))).toBe(true);
            });
        });

        await it('downloads artwork hosted elsewhere into the cache, so the next offline build finds it', async () => {
            await withFixture(async (root) => {
                const metainfo = parseMetainfo(METAINFO);
                metainfo.screenshots = [{ url: 'https://example.org/promo.png', caption: null }];
                const options = {
                    root,
                    repository: 'example/notes',
                    cacheDir: join(root, 'cache'),
                    network: {
                        fetch: async () => ({
                            ok: true,
                            status: 200,
                            json: async () => ({}),
                            arrayBuffer: async () => PIXEL_PNG.buffer.slice(0) as ArrayBuffer,
                        }),
                    },
                };
                const shots = await resolveScreenshots(metainfo, options);
                expect(shots.length).toBe(1);
                expect(shots[0]!.slug).toBe('promo');
                expect(existsSync(shots[0]!.file)).toBe(true);

                // The second pass finds the cached file and needs no network at all.
                const offline = await resolveScreenshots(metainfo, { ...options, network: {}, offline: true });
                expect(offline.length).toBe(1);
            });
        });
    });

    await describe('downloads', async () => {
        await it('classifies release assets per OS', async () => {
            expect(classifyAsset(asset('Notes.AppImage'))).toStrictEqual({
                os: 'linux',
                format: 'appimage',
                arch: 'noarch',
            });
            expect(classifyAsset(asset('notes.msi'))?.os).toBe('win32');
            expect(classifyAsset(asset('Notes.dmg'))?.os).toBe('darwin');
            expect(classifyAsset(asset('SHA256SUMS'))).toBeNull();
        });

        await it('classifies extension files in a release by browser', async () => {
            expect(classifyAsset(asset('app-1.0-firefox-mv2.zip'))).toStrictEqual({
                os: 'firefox',
                format: 'zip',
                arch: 'noarch',
            });
            expect(classifyAsset(asset('app-1.0.xpi'))).toStrictEqual({ os: 'firefox', format: 'xpi', arch: 'noarch' });
            expect(classifyAsset(asset('app-1.0-chrome-mv3.zip'))?.os).toBe('chromium');
        });

        await it('puts Flathub first on Linux, recommends once per OS and keeps web last', async () => {
            const targets = buildDownloadTargets({
                assets: [asset('a.deb'), asset('a.AppImage'), asset('a.msi'), asset('a.dmg')],
                flathub: 'eu.example.App',
                webAppUrl: '/x/app/',
            });
            expect(targets.map((target) => target.format)).toStrictEqual([
                'flathub',
                'appimage',
                'deb',
                'dmg',
                'msi',
                'web',
            ]);
            expect(targets.filter((target) => target.recommended).map((target) => target.os)).toStrictEqual([
                'linux',
                'darwin',
                'win32',
                'web',
            ]);
        });

        await it('prefers a Flatpak bundle over an AppImage on Linux, Flathub over both', async () => {
            const bundled = buildDownloadTargets({ assets: [asset('a.AppImage'), asset('a.flatpak')] });
            expect(bundled.map((target) => [target.format, target.recommended])).toStrictEqual([
                ['flatpak', true],
                ['appimage', false],
            ]);

            const stored = buildDownloadTargets({
                assets: [asset('a.AppImage'), asset('a.flatpak')],
                flathub: 'eu.example.App',
            });
            expect(stored.filter((target) => target.recommended).map((target) => target.format)).toStrictEqual([
                'flathub',
            ]);
        });

        await it("sizes the store target from Flathub's own number, else the Flatpak bundle", async () => {
            const bundle = { ...asset('a.flatpak'), size: 400_000 };
            const fromSummary = buildDownloadTargets({
                assets: [bundle],
                flathub: 'eu.example.App',
                flathubSize: 1_832_624,
            });
            expect(fromSummary.find((target) => target.format === 'flathub')?.size).toBe(1_832_624);
            const fromBundle = buildDownloadTargets({ assets: [bundle], flathub: 'eu.example.App' });
            expect(fromBundle.find((target) => target.format === 'flathub')?.size).toBe(400_000);
            const neither = buildDownloadTargets({ assets: [], flathub: 'eu.example.App' });
            expect(neither.find((target) => target.format === 'flathub')?.size).toBeUndefined();
            expect(parseFlathubSummary({ download_size: 7, installed_size: 9 }).downloadSize).toBe(7);
            expect(() => parseFlathubSummary({})).toThrow(/Unexpected Flathub summary/);
        });

        await it('labels by platform wording first, then format, never the raw id', async () => {
            expect(defaultLabel('firefox', 'store')).toBe('Firefox Add-ons');
            expect(defaultLabel('firefox', 'source')).toBe('Build from source');
            expect(defaultLabel('linux', 'source')).toBe('Source code');
            expect(defaultLabel('android', 'store')).toBe('Store');
            expect(defaultLabel('chromium', 'xpi')).toBe('Firefox add-on');
            for (const [format, text] of Object.entries(FORMAT_LABELS)) expect(text).not.toBe(format);
            for (const key of Object.keys(DOWNLOAD_LABELS)) expect(DOWNLOAD_LABELS[key]).toBeTruthy();
        });

        await it('joins configured stores and sources, never recommending an unavailable one', async () => {
            const config = parseSiteConfig(
                manifest({
                    releaseAssets: false,
                    downloads: [
                        { platform: 'firefox', format: 'store', available: false },
                        { platform: 'firefox', format: 'source', url: 'https://example.org/install' },
                        { platform: 'chromium', format: 'store', available: false, label: 'Chrome Web Store' },
                    ],
                }),
            );
            expect(config.releaseAssets).toBe(false);
            const targets = buildDownloadTargets({ assets: [], configured: config.downloads });
            expect(
                targets.map((target) => [target.os, target.format, target.available, target.recommended]),
            ).toStrictEqual([
                ['firefox', 'store', false, false],
                ['firefox', 'source', true, true],
                ['chromium', 'store', false, false],
            ]);
            expect(targets[0]!.label).toBe('Firefox Add-ons');
            expect(targets[0]!.url).toBe('');
            expect(() => parseSiteConfig(manifest({ downloads: [{ platform: 'firefox', format: 'source' }] }))).toThrow(
                /downloads\[0\].url/,
            );
            expect(() =>
                parseSiteConfig(manifest({ downloads: [{ platform: 'beos', format: 'zip', url: 'https://x' }] })),
            ).toThrow(/downloads\[0\].platform/);
        });

        await it('assigns a release asset to the first component whose match accepts it', async () => {
            const components = [
                { id: 'app', name: 'Desktop app', match: /^notes[-_]/i },
                { id: 'extension', name: 'Browser extension' },
            ];
            expect(componentOf('notes_1.2.0-1_all.deb', components)).toBe('app');
            // A signed add-on is named by the store, without the product prefix: the catch-all takes it.
            expect(componentOf('1bcb7e59df60-1.2.0.xpi', components)).toBe('extension');
            // With no catch-all declared, an unclaimed file belongs to no part of the product.
            expect(componentOf('1bcb7e59df60-1.2.0.xpi', components.slice(0, 1))).toBeUndefined();
            expect(componentOf('notes_1.2.0-1_all.deb', [])).toBeUndefined();
        });

        await it('orders the dialog by component and recommends once per component and platform', async () => {
            const config = parseSiteConfig(
                manifest({
                    components: [
                        { id: 'app', name: 'Desktop app', summary: 'Runs on your machine', match: '^notes[-_]' },
                        { id: 'extension', name: 'Browser extension' },
                    ],
                    downloads: [{ platform: 'chromium', format: 'store', available: false, component: 'extension' }],
                }),
            );
            // The match is compiled case-insensitively: release artefacts differ in case per format.
            expect(config.components[0]!.match!.test('NOTES-1.2.0-1.x86_64.rpm')).toBe(true);
            const targets = buildDownloadTargets({
                // Extension first, to prove the component order decides rather than the asset order.
                assets: [
                    asset('a-1.2.0-firefox-mv2.zip'),
                    asset('notes-1.2.0-1.macos.arm64.zip'),
                    asset('notes_1.2.0-1_all.deb'),
                ],
                configured: config.downloads,
                components: config.components,
            });
            expect(targets.map((entry) => [entry.component, entry.os, entry.recommended])).toStrictEqual([
                ['app', 'linux', true],
                ['app', 'darwin', true],
                ['extension', 'firefox', true],
                ['extension', 'chromium', false],
            ]);
        });

        await it('rejects a download pointing at a component nobody declared', async () => {
            expect(() =>
                parseSiteConfig(
                    manifest({
                        components: [{ id: 'app', name: 'Desktop app' }],
                        downloads: [{ platform: 'firefox', format: 'store', available: false, component: 'extension' }],
                    }),
                ),
            ).toThrow(/components: app/);
            expect(() => parseSiteConfig(manifest({ components: [{ id: 'a', name: 'A', match: '[' }] }))).toThrow(
                /components\[0\].match/,
            );
            expect(() => parseSiteConfig(manifest({ components: [{ name: 'A' }] }))).toThrow(/components\[0\].id/);
        });
    });

    await describe('metainfo', async () => {
        await it('parses an app metainfo with its German strings and an age rating', async () => {
            const metainfo = parseMetainfo(METAINFO);
            expect(metainfo.id).toBe('org.example.Notes');
            expect(metainfo.name.source).toBe('Notes');
            expect(metainfo.summary.byLanguage.de).toBe('Dinge aufschreiben');
            expect(metainfo.releases.length).toBe(1);
            expect(minimumAge(metainfo.contentRating!.type, metainfo.contentRating!.attributes)).toBe(3);
        });

        await it('drops links and brand colours that could break out of their context', async () => {
            const xml = `<component><id>a.b.C</id><name>C</name>
<url type="homepage">javascript:alert(1)</url><url type="faq">https://example.org/faq</url>
<branding><color type="primary" scheme_preference="light">red;}</style><script></color>
<color type="primary" scheme_preference="dark">#1e1e1e</color></branding></component>`;
            const metainfo = parseMetainfo(xml);
            expect(metainfo.urls).toStrictEqual({ faq: 'https://example.org/faq' });
            expect(metainfo.branding).toStrictEqual({ dark: '#1e1e1e' });
        });

        await it('yields no age for an unknown content-rating kind', async () => {
            expect(minimumAge('oars-2.0', {})).toBeUndefined();
            expect(minimumAge('oars-1.1', {})).toBe(0);
            expect(minimumAge('oars-1.1', { 'violence-bloodshed': 'intense' })).toBe(18);
        });
    });

    await describe('catalogues', async () => {
        await it('parses PO and resolves a localized text', async () => {
            const catalog = parseCatalog(
                `msgid ""\nmsgstr "Language: de\\n"\n\n#, fuzzy\nmsgid "Fuzzy"\nmsgstr "x"\n\nmsgid "Hello"\nmsgstr "Hallo"\n\nmsgid "Multi"\n"line"\nmsgstr "Mehr"\n"zeilig"\n`,
            );
            expect(catalog.get('Hello')).toBe('Hallo');
            expect(catalog.get('Multiline')).toBe('Mehrzeilig');
            expect(catalog.has('Fuzzy')).toBe(false);
            const text = { source: 'Hello', byLanguage: { de: 'Moin' } };
            expect(resolveLocalized(text, 'de', catalog)).toBe('Moin');
            expect(resolveLocalized({ source: 'Hello', byLanguage: {} }, 'de', catalog)).toBe('Hallo');
            expect(resolveLocalized({ source: 'Nope', byLanguage: {} }, 'de', catalog)).toBe('Nope');
            expect(
                completeLocalized({ source: 'Hello', byLanguage: { fr: 'Salut' } }, ['en', 'de'], 'en', {
                    de: catalog,
                }),
            ).toStrictEqual({ source: 'Hello', byLanguage: { de: 'Hallo' } });
        });
    });

    await describe('config validation', async () => {
        await it('names the offending key', async () => {
            expect(() => parseSiteConfig({})).toThrow(/no "gjsify.site"/);
            expect(() => parseSiteConfig({ gjsify: { site: { metainfo: 'm.xml' } } })).toThrow(/gjsify.site.url/);
            expect(() => parseSiteConfig(manifest({ languages: ['en'], defaultLanguage: 'de' }))).toThrow(
                /defaultLanguage/,
            );
        });

        await it('applies the documented defaults', async () => {
            const config = parseSiteConfig({
                gjsify: { site: { metainfo: 'm', base: 'x', url: 'https://x', repository: 'a/b' } },
            });
            expect(config.base).toBe('/x/');
            expect(config.url).toBe('https://x/');
            expect(config.languages).toStrictEqual(['en']);
            expect(config.sourceLanguage).toBe('en');
        });

        await it('does not let the landing language change the language of the source text', async () => {
            const german = parseSiteConfig(manifest({ languages: ['de', 'en'], defaultLanguage: 'de' }));
            expect(german.defaultLanguage).toBe('de');
            expect(german.sourceLanguage).toBe('en');
        });

        await it('keeps support links valid and validates a sepa entry at load', async () => {
            const [link, sepa] = parseSiteConfig(
                manifest({
                    support: [
                        { kind: 'Sponsor', url: 'https://example.org/s' },
                        { kind: 'sepa', name: 'N', iban: 'de89 3704 0044 0532 0130 00', bic: 'cobadeffxxx' },
                    ],
                }),
            ).support;
            expect(link).toStrictEqual({ kind: 'Sponsor', url: 'https://example.org/s' });
            expect(sepa).toStrictEqual({
                kind: 'sepa',
                name: 'N',
                iban: 'DE89370400440532013000',
                bic: 'COBADEFFXXX',
                reference: undefined,
            });
            expect(() =>
                parseSiteConfig(manifest({ support: [{ kind: 'sepa', name: 'N', iban: 'DE89370400440532013001' }] })),
            ).toThrow(/support\[0\]\.iban is not a valid IBAN/);
            expect(() =>
                parseSiteConfig(manifest({ support: [{ kind: 'sepa', iban: 'DE89370400440532013000' }] })),
            ).toThrow(/support\[0\]\.name/);
            expect(() =>
                parseSiteConfig(
                    manifest({ support: [{ kind: 'sepa', name: 'N', iban: 'DE89370400440532013000', bic: 'XX' }] }),
                ),
            ).toThrow(/bic is not a valid BIC/);
        });

        await it('requires one privacy statement per configured language, and nothing more', async () => {
            expect(
                parseSiteConfig(
                    manifest({ languages: ['en', 'de'], privacy: { statements: { en: 'p.en.md', de: 'p.de.md' } } }),
                ).privacy,
            ).toStrictEqual({ statements: { en: 'p.en.md', de: 'p.de.md' }, hostingPolicyUrl: undefined });
            expect(parseSiteConfig(manifest({})).privacy).toBeUndefined();
            expect(() =>
                parseSiteConfig(manifest({ languages: ['en', 'de'], privacy: { statements: { en: 'p.en.md' } } })),
            ).toThrow(/privacy\.statements\.de/);
            expect(() => parseSiteConfig(manifest({ privacy: { statements: 'x' } }))).toThrow(
                /privacy\.statements must be an object/,
            );
            expect(
                parseSiteConfig(
                    manifest({ privacy: { statements: { en: 'p.md' }, hostingPolicyUrl: 'https://host.example/' } }),
                ).privacy?.hostingPolicyUrl,
            ).toBe('https://host.example/');
        });

        await it('accepts a consumer-owned page catalogue directory', async () => {
            expect(parseSiteConfig(manifest({ pageTranslations: 'site-po' })).pageTranslations).toBe('site-po');
            expect(parseSiteConfig(manifest({})).pageTranslations).toBeUndefined();
        });
    });

    await describe('network payloads', async () => {
        await it('parses what GitHub and Flathub return and rejects what they do not', async () => {
            const release = parseLatestRelease({
                tag_name: 'v1',
                html_url: 'u',
                assets: [
                    { name: 'a.deb', size: 3, download_count: 4, browser_download_url: 'https://x/a.deb' },
                    { nope: true },
                ],
            });
            expect(release.assets.length).toBe(1);
            expect(release.assets[0]!.downloadCount).toBe(4);
            expect(() => parseLatestRelease({})).toThrow(/Unexpected/);
            expect(parseFlathubStats({ installs_total: 5, installs_last_month: 1 }).installsTotal).toBe(5);
            expect(() => parseFlathubStats({})).toThrow(/Unexpected/);
        });

        await it('rejects on HTTP errors', async () => {
            const failing = async () => ({ ok: false, status: 503, json: async () => ({}) });
            await expect(fetchJson('https://x', {}, { fetch: failing })).rejects.toThrow();
        });

        await it('treats a repository without a release as a state, not an error', async () => {
            const notFound = async () => ({ ok: false, status: 404, json: async () => ({}) });
            expect(await fetchLatestRelease('a/b', undefined, { fetch: notFound })).toBeNull();
            const unavailable = async () => ({ ok: false, status: 503, json: async () => ({}) });
            await expect(fetchLatestRelease('a/b', undefined, { fetch: unavailable })).rejects.toThrow();
        });
    });

    await describe('loadSiteData', async () => {
        await it('degrades to warnings when the network fails', async () => {
            await withFixture(
                async (root) => {
                    const warnings: string[] = [];
                    const data = await loadSiteData({
                        root,
                        warn: (message) => warnings.push(message),
                        network: { fetch: async () => Promise.reject(new Error('offline')) },
                    });
                    expect(data.latestRelease).toBeNull();
                    expect(data.stats.githubDownloads).toBeUndefined();
                    // One per endpoint: the GitHub release, the Flathub statistics and the Flathub summary.
                    expect(warnings.filter((message) => message.startsWith('Could not fetch')).length).toBe(3);
                    expect(data.screenshots.length).toBe(2);
                    expect(data.screenshots[0]!.caption?.source).toBe('The note list');
                    expect(data.screenshots[0]!.caption?.byLanguage.de).toBe('Die Notizliste');
                    expect(data.screenshots[1]!.caption?.source).toBe('Editing a note');
                    expect(data.version).toBe('1.2.0');
                },
                fixtureSite({ flathub: 'org.example.Notes' }),
            );
        });

        await it('reads the metainfo it was pointed at, from the repository root', async () => {
            await withFixture(async (root) => {
                expect(readFileSync(join(root, 'data/notes.metainfo.xml'), 'utf8')).toBe(METAINFO);
                const data = await loadSiteData({ root, offline: true });
                expect(data.app.id).toBe('org.example.Notes');
                expect(data.app.name.byLanguage.de).toBe('Notizen');
                expect(data.config.base).toBe('/notes/');
                expect(data.releases[0]!.version).toBe('1.2.0');
            });
        });

        await it('fails loudly when the metainfo is not where the config says', async () => {
            await withFixture(
                async (root) => {
                    await expect(loadSiteData({ root, offline: true })).rejects.toThrow(/does not exist/);
                },
                fixtureSite({ metainfo: 'data/nope.xml' }),
            );
        });

        await it('reads every language\u2019s privacy statement, verbatim, and names a missing file', async () => {
            await withFixture(async (root) => {
                writeFileSync(join(root, 'privacy.en.md'), '# Privacy\n\nNothing leaves the device.');
                const statements = await loadPrivacyStatements({ statements: { en: 'privacy.en.md' } }, root);
                expect(statements.en).toBe('# Privacy\n\nNothing leaves the device.');
            }, fixtureSite());
            await withFixture(async (root) => {
                await expect(loadPrivacyStatements({ statements: { en: 'privacy.en.md' } }, root)).rejects.toThrow(
                    /privacy\.statements\.en points to "privacy\.en\.md"/,
                );
            }, fixtureSite());
        });
    });

    await describe('related apps', async () => {
        const OTHER = 'https://example.org/other/';
        const manifestFor = (url: string, extra: Record<string, unknown> = {}) => ({
            schema: 1,
            id: 'org.example.Other',
            name: { en: 'Other', de: 'Anderes' },
            summary: { en: 'Does other things' },
            icon: `${url}icon.svg`,
            url,
            languages: ['en', 'de'],
            developer: { name: 'Example Developer' },
            ...extra,
        });
        const serve = (files: Record<string, unknown>) => async (url: string) => {
            if (!(url in files)) return { ok: false, status: 404, json: async () => ({}) };
            return { ok: true, status: 200, json: async () => files[url] };
        };
        const site = (relatedApps: unknown[]) => fixtureSite({ relatedApps });

        await it('parses site addresses and inline entries, in order', async () => {
            const config = parseSiteConfig(
                manifest({
                    relatedApps: [
                        'https://example.org/a',
                        { url: 'https://example.org/b/', name: 'B', summary: 'Bee', icon: 'https://example.org/b.png' },
                    ],
                }),
            );
            expect(config.relatedApps[0]).toStrictEqual({ url: 'https://example.org/a/' });
            expect(config.relatedApps[1]!.name).toBe('B');
            expect(parseSiteConfig(manifest({})).relatedApps).toStrictEqual([]);
            expect(() => parseSiteConfig(manifest({ relatedApps: 'x' }))).toThrow(/relatedApps must be a list/);
            expect(() => parseSiteConfig(manifest({ relatedApps: ['ftp://x'] }))).toThrow(/relatedApps\[0\]/);
            expect(() => parseSiteConfig(manifest({ relatedApps: [{ url: 'https://x/', summary: 's' }] }))).toThrow(
                /needs "name"/,
            );
        });

        await it('emits an app.json shape from the metainfo, translations included', async () => {
            await withFixture(async (root) => {
                const data = await loadSiteData({ root, offline: true });
                const json = buildAppManifest(data, 'https://example.org/notes/icon.svg');
                expect(json.schema).toBe(1);
                expect(json.id).toBe('org.example.Notes');
                expect(json.name).toStrictEqual({ en: 'Notes', de: 'Notizen' });
                expect(json.summary.de).toBe('Dinge aufschreiben');
                expect(json.icon).toBe('https://example.org/notes/icon.svg');
                expect(json.url).toBe('https://example.org/notes/');
                expect(json.developer).toStrictEqual({ id: 'org.example', name: 'Example Developer' });
                expect(typeof parseAppManifest(JSON.parse(JSON.stringify(json)))).toBe('object');
            });
        });

        await it('rejects an unknown schema or a broken body', async () => {
            expect(typeof parseAppManifest(manifestFor(OTHER, { schema: 2 }))).toBe('string');
            expect(typeof parseAppManifest(manifestFor(OTHER, { name: {} }))).toBe('string');
            expect(typeof parseAppManifest('x')).toBe('string');
        });

        await it('fetches app.json in configured order and drops the site itself', async () => {
            await withFixture(
                async (root) => {
                    const data = await loadSiteData({
                        root,
                        network: {
                            fetch: serve({
                                [`${OTHER}app.json`]: manifestFor(OTHER),
                                'https://example.org/second/app.json': manifestFor('https://example.org/second/', {
                                    id: 'org.example.Second',
                                    name: { en: 'Second' },
                                }),
                            }),
                        },
                        offline: false,
                    });
                    expect(data.relatedApps.map((app) => app.id)).toStrictEqual([
                        'org.example.Other',
                        'org.example.Second',
                    ]);
                    expect(relatedText(data.relatedApps[0]!.name, 'de')).toBe('Anderes');
                    expect(relatedText(data.relatedApps[0]!.summary, 'de')).toBe('Does other things');
                    expect(relatedUrl(data.relatedApps[0]!, 'de')).toBe(`${OTHER}de/`);
                    expect(relatedUrl(data.relatedApps[0]!, 'fr')).toBe(`${OTHER}en/`);
                },
                site([OTHER, 'https://example.org/notes', 'https://example.org/second']),
            );
        });

        await it('matches the site itself regardless of letter case', async () => {
            await withFixture(
                async (root) => {
                    const data = await loadSiteData({ root, network: { fetch: serve({}) } });
                    expect(data.relatedApps).toStrictEqual([]);
                },
                site(['https://Example.org/NOTES']),
            );
        });

        await it("drops an entry that carries the site's own app id", async () => {
            await withFixture(
                async (root) => {
                    const data = await loadSiteData({
                        root,
                        network: {
                            fetch: serve({
                                [`${OTHER}app.json`]: manifestFor(OTHER, { id: 'org.example.Notes' }),
                            }),
                        },
                    });
                    expect(data.relatedApps).toStrictEqual([]);
                },
                site([OTHER]),
            );
        });

        await it('does not fetch anything when none is configured', async () => {
            await withFixture(async (root) => {
                let calls = 0;
                const data = await loadSiteData({
                    root,
                    network: {
                        fetch: async () => {
                            calls++;
                            return { ok: false, status: 500, json: async () => ({}) };
                        },
                    },
                    offline: true,
                });
                expect(data.relatedApps).toStrictEqual([]);
                expect(calls).toBe(0);
            });
        });

        await it('falls back to the last good copy, else skips with a warning', async () => {
            await withFixture(
                async (root) => {
                    const cacheDir = join(root, 'cache');
                    const warnings: string[] = [];
                    const warn = (message: string) => warnings.push(message);
                    const config = parseSiteConfig({ gjsify: { site: site([OTHER]) } });
                    const ok = await loadRelatedApps(config, 'x', {
                        warn,
                        network: { cacheDir, fetch: serve({ [`${OTHER}app.json`]: manifestFor(OTHER) }) },
                    });
                    expect(ok.length).toBe(1);
                    const down = await loadRelatedApps(config, 'x', {
                        warn,
                        network: { cacheDir, fetch: async () => Promise.reject(new Error('down')) },
                    });
                    expect(down.map((app) => app.id)).toStrictEqual(['org.example.Other']);
                    expect(warnings).toStrictEqual([]);
                    const none = await loadRelatedApps(config, 'x', {
                        warn,
                        network: {
                            cacheDir: join(root, 'empty'),
                            fetch: async () => Promise.reject(new Error('down')),
                        },
                    });
                    expect(none).toStrictEqual([]);
                    expect(warnings.length).toBe(1);
                    expect(warnings[0]).toMatch(/app\.json.*skipping/);
                    const offline = await loadRelatedApps(config, 'x', { warn, offline: true, network: { cacheDir } });
                    expect(offline.length).toBe(1);
                },
                site([OTHER]),
            );
        });

        await it('lists an inline entry without fetching', async () => {
            await withFixture(
                async (root) => {
                    const data = await loadSiteData({
                        root,
                        network: { fetch: async () => Promise.reject(new Error('no network')) },
                        offline: true,
                    });
                    expect(data.relatedApps.length).toBe(1);
                    expect(data.relatedApps[0]!.name.en).toBe('Plain');
                    expect(relatedUrl(data.relatedApps[0]!, 'de')).toBe('https://example.org/plain/');
                },
                site([{ url: 'https://example.org/plain/', name: 'Plain', summary: 'No app.json' }]),
            );
        });
    });

    await describe('SEPA', async () => {
        await it('checks IBAN format and the mod-97 checksum', async () => {
            expect(isValidIban('DE89370400440532013000')).toBe(true);
            expect(isValidIban('GB82WEST12345698765432')).toBe(true);
            expect(isValidIban('DE89370400440532013001')).toBe(false);
            expect(isValidIban('DE8937040044053201300')).toBe(false);
            // Lower case is rejected on purpose: the caller normalises first.
            expect(isValidIban('de89370400440532013000')).toBe(false);
            expect(isValidIban('1234')).toBe(false);
            expect(formatIban('de89 3704 0044 0532 0130 00')).toBe('DE89 3704 0044 0532 0130 00');
            expect(isValidBic('COBADEFFXXX')).toBe(true);
            expect(isValidBic('COBADEFF')).toBe(true);
            expect(isValidBic('COBADE')).toBe(false);
        });

        await it('builds a payload that follows EPC069-12 v002', async () => {
            expect(
                epcPayload({
                    name: 'Max Müller',
                    iban: 'DE89 3704 0044 0532 0130 00',
                    bic: 'COBADEFFXXX',
                    reference: 'Spende',
                }),
            ).toBe('BCD\n002\n1\nSCT\nCOBADEFFXXX\nMax Müller\nDE89370400440532013000\n\n\n\nSpende');
            expect(epcPayload({ name: 'X', iban: 'DE89370400440532013000' })).toBe(
                'BCD\n002\n1\nSCT\n\nX\nDE89370400440532013000\n\n\n\n',
            );
        });
    });
};
