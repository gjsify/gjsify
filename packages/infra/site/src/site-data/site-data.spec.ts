// The data layer, from one parser at a time up to `loadSiteData` over a whole repository.
//
// The repository it loads is WRITTEN OUT per case (`withFixture`) rather than committed. These
// specs are bundled before they run, so a committed fixture would have to be located by a
// relative walk from the outfile — and where the outfile sits is the one thing a case about
// AppStream parsing must not depend on. A generated fixture also keeps the expectations readable:
// "six screenshots" means something when the six are three lines above.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from '@gjsify/unit';

import { parseSiteConfig } from './config.js';
import { DOWNLOAD_LABELS, FORMAT_LABELS, buildDownloadTargets, classifyAsset, defaultLabel } from './downloads.js';
import { parseFlathubStats, parseFlathubSummary } from './flathub.js';
import { fetchLatestRelease, parseLatestRelease } from './github.js';
import { loadSiteData } from './load.js';
import { parseMetainfo } from './metainfo.js';
import { fetchJson } from './network.js';
import { minimumAge } from './oars.js';
import { completeLocalized, parseCatalog, resolveLocalized } from './po.js';
import { resolveVariant, validateVariants } from './screenshots.js';
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
      <image>https://example.org/1.png</image>
      <caption>The note list</caption>
      <caption xml:lang="de">Die Notizliste</caption>
    </screenshot>
    <screenshot>
      <image>https://example.org/2.png</image>
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

const SCREENSHOT_FILES = ['list.png', 'list-dark.png', 'phone.png'];

/** The `gjsify.site` block of the fixture repository; a case may override any key. */
const fixtureSite = (overrides: Record<string, unknown> = {}) => ({
    metainfo: 'data/notes.metainfo.xml',
    base: '/notes/',
    url: 'https://example.org/notes',
    repository: 'example/notes',
    languages: ['en', 'de'],
    screenshots: {
        source: 'merge',
        items: [
            { from: 0, variants: { 'desktop-light': 'data/list.png', 'desktop-dark': 'data/list-dark.png' } },
            { from: 1, variants: { 'desktop-light': 'data/list.png' } },
            { caption: 'Runs on a phone', variants: { 'mobile-light': 'data/phone.png' } },
        ],
    },
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
        await it('falls back between variants in the documented order', async () => {
            const all = {
                'desktop-light': 'dl',
                'desktop-dark': 'dd',
                'mobile-light': 'ml',
                'mobile-dark': 'md',
            };
            expect(resolveVariant(all, 'mobile-dark')).toBe('md');
            expect(resolveVariant({ 'desktop-light': 'dl', 'mobile-light': 'ml' }, 'mobile-dark')).toBe('ml');
            expect(resolveVariant({ 'desktop-light': 'dl', 'desktop-dark': 'dd' }, 'mobile-dark')).toBe('dd');
            expect(resolveVariant({ 'desktop-light': 'dl' }, 'mobile-dark')).toBe('dl');
            expect(resolveVariant({ 'mobile-dark': 'md', 'desktop-dark': 'dd' }, 'mobile-light')).toBe('md');
            expect(resolveVariant({ 'mobile-light': 'ml', 'desktop-dark': 'dd' }, 'desktop-light')).toBe('dd');
            expect(resolveVariant({ 'mobile-light': 'ml', 'mobile-dark': 'md' }, 'desktop-dark')).toBe('md');
            expect(resolveVariant({ 'mobile-light': 'ml' }, 'desktop-dark')).toBe('ml');
            expect(resolveVariant({}, 'desktop-dark')).toBeUndefined();
        });

        await it('fails with a clear message on a missing file', async () => {
            await withFixture((root) => {
                expect(() => validateVariants({ 'desktop-light': 'nope.png' }, root, '#1')).toThrow(
                    /"nope.png", which does not exist/,
                );
                expect(() => validateVariants({}, root, '#2')).toThrow(/no variants/);
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
                    expect(data.screenshots.length).toBe(3);
                    expect(data.screenshots[0]!.caption?.source).toBe('The note list');
                    expect(data.screenshots[0]!.caption?.byLanguage.de).toBe('Die Notizliste');
                    expect(data.screenshots[2]!.caption?.source).toBe('Runs on a phone');
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
