import { describe, expect, it } from '@gjsify/unit';

import type { DownloadTarget, Screenshot, SiteData } from '../site-data/index.js';
import type { ProcessedImage } from './images.js';
import {
    badges,
    ctaLabel,
    downloadWidget,
    frameAttribute,
    legalNoticeUrl,
    linkCard,
    localizeOwnUrl,
    privacyUrl,
    relatedSection,
    sepaCard,
} from './pages.js';

const t = (msgid: string) => msgid;
const target = (os: DownloadTarget['os'], format: DownloadTarget['format'], component?: string): DownloadTarget => ({
    os,
    arch: 'noarch',
    format,
    component,
    label: '',
    url: 'https://example.org/',
    available: true,
    recommended: true,
});

/** A `SiteData` with only what the download dialog reads. */
const downloadData = (components: Array<Record<string, string>>, targets: DownloadTarget[]): SiteData =>
    ({
        config: { components },
        downloads: { targets, hasReleases: true, releasesUrl: 'https://example.org/releases' },
    }) as unknown as SiteData;

export default async () => {
    await describe('page fragments', async () => {
        await it('describes the recommended target, not just its group', async () => {
            expect(ctaLabel(target('linux', 'flathub'), t)).toBe('Install from Flathub');
            expect(ctaLabel(target('linux', 'appimage'), t)).toBe('Download for Linux');
            expect(ctaLabel(target('web', 'web'), t)).toBe('Try in browser');
            expect(ctaLabel(target('chromium', 'source'), t)).toBe('Build from source');
            expect(ctaLabel(target('linux', 'source'), t)).toBe('Build from source');
            expect(ctaLabel(target('firefox', 'store'), t)).toBe('Add to Firefox');
            expect(ctaLabel(target('firefox', 'xpi'), t)).toBe('Install for Firefox');
        });

        await it('drops our frame only where the screenshot is a window shot', async () => {
            const image = (frameless: boolean) => ({ frameless }) as ProcessedImage;
            const images = new Map([
                ['window', image(true)],
                ['phone', image(false)],
            ]);
            const shot = (slug: string): Screenshot => ({ caption: null, url: '', file: '', slug });
            expect(frameAttribute({ images }, shot('window'))).toBe('none');
            expect(frameAttribute({ images }, shot('phone'))).toBeUndefined();
            expect(frameAttribute({ images }, shot('missing'))).toBeUndefined();
        });

        await it('shows the grouped IBAN, the details and an inline QR code', async () => {
            const html = sepaCard(
                {
                    kind: 'sepa',
                    name: 'Example & Co',
                    iban: 'DE89370400440532013000',
                    bic: 'COBADEFFXXX',
                    reference: 'Donation',
                },
                t,
            );
            expect(html).toMatch(/DE89 3704 0044 0532 0130 00/);
            expect(html).toMatch(/data-copy="DE89370400440532013000"/);
            expect(html).toMatch(/Example &amp; Co/);
            expect(html).toMatch(/COBADEFFXXX/);
            expect(html).toMatch(/<svg class="qr"[^>]*viewBox="0 0 \d+ \d+"/);
            expect(html).toMatch(/Scan with your banking app/);
            expect(sepaCard({ kind: 'sepa', name: 'X', iban: 'DE89370400440532013000' }, t)).not.toMatch(
                /BIC|Reference/,
            );
        });

        await it("moves links to the site's own pages to the rendered language, and leaves others", async () => {
            const data = {
                config: { url: 'https://jumplink.eu/Learn6502/', languages: ['en', 'de'] },
            } as unknown as SiteData;
            const own = 'https://jumplink.eu/Learn6502/';
            expect(localizeOwnUrl(data, `${own}en/support/`, 'de')).toBe(`${own}de/support/`);
            expect(localizeOwnUrl(data, `${own}en/#x`, 'de')).toBe(`${own}de/#x`);
            expect(localizeOwnUrl(data, `${own}en`, 'de')).toBe(`${own}de`);
            expect(localizeOwnUrl(data, `${own}fr/support/`, 'de')).toBe(`${own}fr/support/`);
            expect(localizeOwnUrl(data, `${own}assets/a.png`, 'de')).toBe(`${own}assets/a.png`);
            expect(localizeOwnUrl(data, 'https://example.org/Learn6502/en/', 'de')).toBe(
                'https://example.org/Learn6502/en/',
            );
            expect(linkCard(localizeOwnUrl(data, `${own}en/support/`, 'de'), 'Unterstützen', 'heart')).toMatch(
                /jumplink\.eu\/Learn6502\/de\/support/,
            );
        });

        await it('omits the badge value where the pill already carries the fact', async () => {
            const data = {
                config: { components: [] },
                downloads: { targets: [target('linux', 'appimage'), target('win32', 'source')] },
                app: { license: 'GPL-3.0-or-later' },
                stats: {},
            } as unknown as SiteData;
            const html = badges({ data, t, lang: 'en' });
            expect(html).toMatch(/badge-platforms/);
            expect(html).toMatch(/<span class="badge-value"[^>]*>GPL-3.0\+<\/span>/);
            expect(html).not.toMatch(/<span class="badge-value"[^>]*>\s*<\/span>/);
        });

        await it('gives every part of the product its own numbered heading and tab strip', async () => {
            const data = downloadData(
                [
                    { id: 'app', name: 'Desktop app', summary: 'Runs on your machine' },
                    { id: 'extension', name: 'Browser extension' },
                ],
                [target('linux', 'deb', 'app'), target('darwin', 'zip', 'app'), target('firefox', 'xpi', 'extension')],
            );
            const html = downloadWidget({ data, t, lang: 'en' });
            expect(html).toMatch(/<span class="component-step">1<\/span><span>Desktop app<\/span>/);
            expect(html).toMatch(/<span class="component-step">2<\/span><span>Browser extension<\/span>/);
            expect(html).toMatch(/class="component-summary">Runs on your machine</);
            // One strip per part: the app is picked by operating system, the extension by browser.
            expect([...html.matchAll(/class="os-tabs"/g)].length).toBe(2);
            expect(html).toMatch(/id="os-tab-app-linux"/);
            expect(html).toMatch(/id="os-tab-extension-firefox"/);
            // The button offers the part installed first, not whatever ranked first overall.
            expect(html).toMatch(/download-cta[^>]*data-os="linux"/);
        });

        await it('tells how to open an unsigned download, and stays quiet for a notarised one', async () => {
            const html = (signing: DownloadTarget['signing'], os: DownloadTarget['os'] = 'darwin') =>
                downloadWidget({ data: downloadData([], [{ ...target(os, 'dmg'), signing }]), t, lang: 'en' });
            expect(html('unsigned')).toMatch(/os-note-unsigned">macOS asks before[^<]*Open Anyway\./);
            expect(html('unsigned')).toMatch(/data-unsigned/);
            expect(html('unsigned')).toMatch(/target-meta">[^<]*Not notarized/);
            // Signed is not enough on macOS: Gatekeeper still stops an app Apple has not checked.
            expect(html('signed')).toMatch(/os-note-unsigned/);
            expect(html('notarized')).not.toMatch(/os-note-unsigned|data-unsigned|Not notarized/);
            // Windows is content with a signature.
            expect(html('signed', 'win32')).not.toMatch(/os-note-unsigned/);
            expect(html('unsigned', 'win32')).toMatch(/os-note-unsigned">Windows may warn[^<]*Run anyway\./);
            // A target with nothing to check, like a store page, claims nothing either way.
            expect(html(undefined)).not.toMatch(/os-note-unsigned/);
        });

        await it('numbers nothing when there is only one part to install', async () => {
            const single = downloadWidget({ data: downloadData([], [target('linux', 'deb')]), t, lang: 'en' });
            expect(single).not.toMatch(/component-head|component-step/);
            expect(single).toMatch(/<h3 class="os-title">/);

            // A product that names its one part keeps the heading; a step number would count to one.
            const named = downloadWidget({
                data: downloadData([{ id: 'app', name: 'Desktop app' }], [target('linux', 'deb', 'app')]),
                t,
                lang: 'en',
            });
            expect(named).toMatch(/<h3 class="component-title"><span>Desktop app<\/span>/);
            expect(named).not.toMatch(/component-step/);
        });

        await it('renders the related apps section only when there are apps', async () => {
            const apps = [
                {
                    name: { en: 'Other', de: 'Anderes' },
                    summary: { en: 'Things' },
                    icon: 'https://example.org/i.svg',
                    url: 'https://example.org/other/',
                    languages: ['en', 'de'],
                },
            ];
            const data = (relatedApps: unknown[]) =>
                ({ relatedApps, app: { developer: { name: 'Dev & Co' } } }) as unknown as SiteData;
            expect(relatedSection({ data: data([]), t, lang: 'en' })).toBe('');
            const html = relatedSection({ data: data(apps), t, lang: 'de' });
            expect(html).toMatch(/<h2>More apps by Dev &amp; Co<\/h2>/);
            expect(html).toMatch(/href="https:\/\/example.org\/other\/de\/"/);
            expect(html).toMatch(/related-name">Anderes</);
            expect(html).toMatch(/related-summary">Things</);
        });

        await it('addresses the privacy page under the app page, per language', async () => {
            const data = { config: { base: '/app/', url: 'https://example.org/app/' } } as unknown as SiteData;
            expect(privacyUrl(data, 'en')).toBe('/app/en/privacy/');
            expect(privacyUrl(data, 'de')).toBe('/app/de/privacy/');
        });

        await it('addresses the legal-notice page under the app page, per language', async () => {
            const data = { config: { base: '/app/', url: 'https://example.org/app/' } } as unknown as SiteData;
            expect(legalNoticeUrl(data, 'en')).toBe('/app/en/legal-notice/');
            expect(legalNoticeUrl(data, 'de')).toBe('/app/de/legal-notice/');
        });
    });
};
