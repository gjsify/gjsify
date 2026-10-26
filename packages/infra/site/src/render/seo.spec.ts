import { describe, expect, it } from '@gjsify/unit';

import { ogCardSvg, wrapText } from './og-card.js';
import {
    metaDescription,
    neighbourSitemaps,
    ogLocale,
    pageTitle,
    robotsTxt,
    seoWarnings,
    sitemapXml,
    softwareApplicationJsonLd,
} from './seo.js';

export default async () => {
    await describe('seo', async () => {
        await it('turns a language into a valid og:locale', async () => {
            expect(ogLocale('de')).toBe('de_DE');
            expect(ogLocale('en')).toBe('en_US');
            expect(ogLocale('pt-br')).toBe('pt_BR');
            expect(ogLocale('xx')).toBe('xx');
        });

        await it('titles a page and warns about weak ones', async () => {
            expect(pageTitle('App', 'Does things')).toBe('App – Does things');
            expect(pageTitle('App', 'app')).toBe('App');
            expect(seoWarnings({ lang: 'en', name: 'App', title: 'App', description: 'x' }).length).toBe(2);
            const good = { lang: 'en', name: 'App', title: 'App – a fine summary', description: 'y'.repeat(100) };
            expect(seoWarnings(good)).toStrictEqual([]);
        });

        await it('prefers the longer first paragraph and cuts it at a word', async () => {
            expect(metaDescription('Short', undefined)).toBe('Short');
            const long = metaDescription('Short', 'word '.repeat(60));
            expect(long.length <= 160).toBe(true);
            expect(long.endsWith('…')).toBe(true);
        });

        await it('writes JSON-LD that cannot close the script element', async () => {
            const html = softwareApplicationJsonLd({
                name: '</script>',
                description: 'd',
                url: 'https://example.org/',
                operatingSystems: ['Linux'],
                license: 'GPL-3.0-or-later',
                languages: ['en'],
            });
            expect(html).toMatch(/"@type":"SoftwareApplication"/);
            expect(html.indexOf('</script>')).toBe(html.length - '</script>'.length);
        });

        await it('lists alternates and x-default in the sitemap', async () => {
            const xml = sitemapXml([{ en: 'https://e.org/en/', de: 'https://e.org/de/' }], 'en');
            expect(xml).toMatch(/hreflang="x-default" href="https:\/\/e.org\/en\/"/);
            expect(xml.match(/<loc>/g)?.length).toBe(2);
            expect(robotsTxt(['https://e.org/sitemap.xml'])).toMatch(/Sitemap: https:\/\/e.org\/sitemap.xml/);
        });

        await it('announces the sitemaps of the apps below a root site on the same host', async () => {
            const sitemaps = neighbourSitemaps('https://e.org/', [
                { url: 'https://e.org/notes/' },
                { url: 'https://other.org/app/' },
                { url: 'https://e.org/plain/', name: 'Plain' },
            ]);
            expect(sitemaps).toStrictEqual(['https://e.org/notes/sitemap.xml']);
            expect(robotsTxt(['https://e.org/sitemap.xml', ...sitemaps]).match(/^Sitemap:/gm)?.length).toBe(2);
        });

        await it('wraps card text and draws the name', async () => {
            expect(wrapText('one two three four', 9, 3)).toStrictEqual(['one two', 'three', 'four']);
            const lines = wrapText('alpha beta gamma delta epsilon', 11, 2);
            expect(lines.length).toBe(2);
            expect(lines[1]!.endsWith('…')).toBe(true);
            const svg = ogCardSvg({ name: 'A&B', summary: 'S', background: '#112233', foreground: '#fff' });
            expect(svg).toMatch(/A&amp;B/);
            expect(svg).toMatch(/width="1200" height="630"/);
        });
    });
};
