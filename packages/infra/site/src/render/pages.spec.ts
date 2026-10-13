import { describe, expect, it } from '@gjsify/unit';

import type { DownloadTarget, Screenshot } from '../site-data/index.js';
import type { ProcessedImage } from './images.js';
import { ctaLabel, frameAttribute, sepaCard } from './pages.js';

const t = (msgid: string) => msgid;
const target = (os: DownloadTarget['os'], format: DownloadTarget['format']): DownloadTarget => ({
    os,
    arch: 'noarch',
    format,
    label: '',
    url: 'https://example.org/',
    available: true,
    recommended: true,
});

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

        await it('drops our frame only where the chosen source is a window shot', async () => {
            const image = (frameless: boolean) => ({ frameless }) as ProcessedImage;
            const images = new Map([
                ['window.png', image(true)],
                ['phone.png', image(false)],
            ]);
            const shot = (variants: Screenshot['variants']): Screenshot => ({ caption: null, variants });
            expect(frameAttribute({ images }, shot({ 'desktop-light': 'window.png' }))).toBe('none');
            expect(frameAttribute({ images }, shot({ 'desktop-light': 'phone.png' }))).toBeUndefined();
            expect(
                frameAttribute({ images }, shot({ 'desktop-light': 'window.png', 'mobile-light': 'phone.png' })),
            ).toBe('none-desktop');
            expect(
                frameAttribute({ images }, shot({ 'desktop-light': 'phone.png', 'mobile-light': 'window.png' })),
            ).toBe('none-mobile');
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
    });
};
