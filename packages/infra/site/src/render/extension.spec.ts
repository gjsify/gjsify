import { describe, expect, it } from '@gjsify/unit';

import type { DownloadTarget, ExtensionData, SiteData } from '../site-data/index.js';
import { renderExtensionPage, storeScreenshots, storeVariants } from './extension.js';
import type { RenderContext } from './pages.js';

const t = (msgid: string) => (msgid === 'Add to Firefox' ? 'Zu Firefox' : msgid);
const text = (value: string) => ({ source: value, byLanguage: {} });

const extension: ExtensionData = {
    browsers: [
        {
            family: 'firefox',
            version: '1.2.3',
            manifestVersion: 2,
            minVersion: '140.0',
            name: { en: 'Ext Name', de: 'Ext Name' },
            description: { en: 'Short text', de: 'Kurztext' },
            declaresNoDataCollection: true,
        },
        {
            family: 'chromium',
            version: '1.2.3',
            manifestVersion: 3,
            name: { en: 'Ext Name', de: 'Ext Name' },
            description: { en: 'Short text', de: 'Kurztext' },
            declaresNoDataCollection: false,
        },
    ],
    required: [
        { name: 'storage', host: false, families: ['firefox', 'chromium'] },
        { name: 'scripting', host: false, families: ['chromium'] },
        { name: 'madeUpPermission', host: false, families: ['firefox', 'chromium'] },
    ],
    optional: [{ name: 'https://*/*', host: true, families: ['firefox', 'chromium'] }],
    collectsNoData: true,
    locales: ['de', 'en'],
    component: 'extension',
    explanations: { storage: { en: 'Keeps your list', de: 'Behält deine Liste' } },
};

const target = (os: DownloadTarget['os'], format: DownloadTarget['format'], available: boolean): DownloadTarget => ({
    os,
    arch: 'noarch',
    format,
    component: 'extension',
    label: format === 'source' ? 'Build from source' : 'Store',
    url: `https://example.org/${os}-${format}`,
    available,
    recommended: available,
});

const context = (overrides: Partial<ExtensionData> = {}, privacy = true): RenderContext => {
    const data = {
        config: {
            base: '/x/',
            url: 'https://example.org/x/',
            languages: ['en', 'de'],
            defaultLanguage: 'en',
            components: [{ id: 'extension' }],
            support: [],
            legal: [],
            privacy: privacy ? {} : undefined,
            theme: { imageRendering: 'auto' },
        },
        app: {
            name: text('The App'),
            summary: text('Does app things'),
            description: [{ type: 'paragraph', text: text('Long description') }],
            developer: { name: 'Dev' },
            urls: {},
            license: 'GPL-3.0',
            branding: {},
        },
        screenshots: [],
        releases: [],
        downloads: {
            targets: [
                target('firefox', 'store', false),
                target('firefox', 'source', true),
                target('chromium', 'store', false),
            ],
            hasReleases: false,
            releasesUrl: '',
        },
        relatedApps: [],
        extension: { ...extension, ...overrides },
        warnings: [],
    } as unknown as SiteData;
    return {
        data,
        lang: 'en',
        t,
        assets: { js: '/x/a.js', css: ['/x/a.css'] },
        images: new Map(),
        iconUrl: '/x/icon.png',
    };
};

export default async () => {
    await describe('extension page', async () => {
        await it('renders header, facts, the needs-app card, permissions, data and browsers', async () => {
            const html = renderExtensionPage(context());
            expect(html).toContain('<h1>Ext Name</h1>');
            expect(html).toContain('Short text');
            expect(html).toContain('class="ext-facts"');
            expect(html).toContain('Needs the app The App');
            expect(html).toContain('Does app things');
            expect(html).toContain('Asked when you install');
            expect(html).toContain('Asked only when needed');
            expect(html).toContain('The extension declares that it collects no data.');
            expect(html).toContain('href="/x/en/privacy/"');
            expect(html).toContain('ext-chips');
            expect(html).toContain('140.0+');
            expect(html).toContain('Long description');
        });

        await it('puts the facts aside before the main column, for the phone layout', async () => {
            const html = renderExtensionPage(context());
            expect(html.indexOf('class="ext-facts"')).toBeLessThan(html.indexOf('class="ext-main"'));
        });

        await it('places the download widget to the right of the hero text, like the app page', async () => {
            const html = renderExtensionPage(context());
            const textEnd = html.indexOf('</div>', html.indexOf('class="ext-short"'));
            const widget = html.indexOf('<app-download class="download">');
            expect(textEnd).toBeGreaterThan(-1);
            expect(widget).toBeGreaterThan(textEnd);
            expect(widget).toBeLessThan(html.indexOf('</header>'));
        });

        await it('explains known permissions, shows unknown ones raw, and names differing browsers', async () => {
            const html = renderExtensionPage(context());
            expect(html).toContain('Store its own settings and data');
            expect(html).toContain('Keeps your list');
            expect(html).toContain('<code>madeUpPermission</code>');
            expect(html).not.toContain('madeUpPermission</code>\n<span class="ext-perm-text">');
            expect(html).toContain('Only in Chromium');
            expect(html).toContain('Read and change your data on all websites');
        });

        await it('reuses the download dialog with only the extension, as browser tabs, unnumbered', async () => {
            const html = renderExtensionPage(context());
            expect(html).toContain('<app-download class="download">');
            expect(html).not.toContain('extension-install');
            expect(html).toContain('id="os-tab-extension-firefox"');
            expect(html).toContain('id="os-tab-extension-chromium"');
            expect(html).toContain('aria-label="Browser"');
            expect(html).not.toContain('component-step');
            expect(html).toContain('href="https://example.org/firefox-source"');
        });

        await it('puts the first available target of the browser on the button, never a dead store entry', async () => {
            const html = renderExtensionPage(context());
            expect(html).not.toMatch(/download-cta" href="https:\/\/example.org\/firefox-source"/);
            expect(html).toMatch(/download-cta" href="#all-downloads"/);
            const withXpi = context();
            withXpi.data.downloads.targets.push(target('firefox', 'xpi', true));
            expect(renderExtensionPage(withXpi)).toMatch(/download-cta" href="https:\/\/example.org\/firefox-xpi"/);
        });

        await it('says nothing about data collection unless the manifest declares it', async () => {
            const html = renderExtensionPage(context({ collectsNoData: false }));
            expect(html).not.toContain('collects no data');
        });

        await it('does not link a privacy page that is not configured', async () => {
            const html = renderExtensionPage(context({}, false));
            expect(html).not.toContain('/x/en/privacy/');
        });

        await describe('store pages', async () => {
            const safari = {
                family: 'safari' as const,
                version: '1.2.3',
                manifestVersion: 3 as const,
                name: { en: 'Ext Name', de: 'Ext Name' },
                description: { en: 'Short text', de: 'Kurztext' },
                declaresNoDataCollection: false,
            };
            const withSafari = () => {
                const ctx = context({
                    browsers: [...extension.browsers, safari],
                    required: extension.required.map((entry) => ({
                        ...entry,
                        families: [...entry.families, 'safari' as const],
                    })),
                });
                ctx.data.downloads.targets.push({ ...target('darwin', 'dmg', true), safariExtension: true });
                return ctx;
            };

            await it('links one page per store and marks the current one, without script', async () => {
                const html = renderExtensionPage(context());
                expect(html).toContain('href="/x/en/extension/"');
                expect(html).toContain('href="/x/en/extension/firefox/"');
                expect(html).toContain('href="/x/en/extension/chromium/"');
                expect(html).toMatch(/href="\/x\/en\/extension\/"[^>]*aria-current="page"/);
                const store = renderExtensionPage(context(), 'chromium');
                expect(store).toMatch(/href="\/x\/en\/extension\/chromium\/"[^>]*aria-current="page"/);
            });

            await it('narrows a store page to its manifest, permissions, button wording and title', async () => {
                const chrome = renderExtensionPage(context(), 'chromium');
                expect(chrome).toContain('<code>scripting</code>');
                expect(chrome).not.toContain('Only in');
                expect(chrome).not.toContain('ext-chips');
                expect(chrome).toContain('Browser extension for Chrome');
                const firefox = renderExtensionPage(context(), 'firefox');
                expect(firefox).not.toContain('<code>scripting</code>');
                expect(firefox).toContain('Browser extension for Firefox');
                expect(firefox).not.toContain('Keeps your list');
                expect(chrome).toContain('Keeps your list');
            });

            await it('makes Safari the macOS app, not a store', async () => {
                const html = renderExtensionPage(withSafari(), 'safari');
                expect(html).toContain('Safari has no extension store');
                expect(html).toContain('href="https://example.org/darwin-dmg"');
                expect(html).not.toContain('os-tab-extension-firefox');
            });

            await it('renders nothing for a store the extension does not have', async () => {
                expect(storeVariants(context().data)).toStrictEqual(['firefox', 'chromium']);
                const single = context({ browsers: [extension.browsers[0]!] });
                expect(storeVariants(single.data)).toStrictEqual([]);
                expect(renderExtensionPage(single)).not.toContain('ext-stores');
                expect(() => renderExtensionPage(context(), 'edge')).toThrow();
                expect(renderExtensionPage(context())).not.toContain('extension/edge/');
            });

            await it('limits screenshots to what the store takes and shares one set where it takes one', async () => {
                const shot = (n: number) =>
                    ({ source: { name: `${n}.png` }, byLanguage: { de: { name: `${n}-de.png` } } }) as never;
                const shots = Array.from({ length: 8 }, (_, n) => shot(n));
                expect(storeScreenshots(shots, 'edge')).toHaveLength(6);
                expect(Object.keys(storeScreenshots(shots, 'cws')[0]!.byLanguage)).toStrictEqual(['de']);
                expect(Object.keys(storeScreenshots(shots, 'amo')[0]!.byLanguage)).toStrictEqual([]);
            });
        });
    });
};
