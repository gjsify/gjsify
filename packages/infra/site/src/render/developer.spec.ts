import { describe, expect, it } from '@gjsify/unit';

import {
    parseAnySiteConfig,
    parseSiteConfig,
    type DeveloperData,
    type DeveloperSiteConfig,
    type Resume,
} from '../site-data/index.js';
import { formatResumeDate, renderCv, renderDeveloperHome, type DeveloperContext } from './developer.js';
import { documentHead, type Shell } from './layout.js';

const developerManifest = (site: Record<string, unknown> = {}) => ({
    gjsify: {
        site: {
            url: 'https://example.org',
            languages: ['en', 'de'],
            developer: { resume: { en: 'cv.en.json', de: 'cv.de.json' } },
            ...site,
        },
    },
});

const resume = (name: string): Resume => ({
    basics: {
        name,
        label: 'Developer',
        summary: 'Writes **free** software.',
        email: 'ada@example.org',
        profiles: [{ network: 'GitHub', username: 'ada', url: 'https://github.com/ada' }],
    },
    work: [{ name: 'Studio', position: 'Founder', startDate: '2015-03', highlights: ['Shipped things'] }],
    education: [],
    skills: [{ name: 'TypeScript', keywords: ['GJS'] }],
    languages: [],
    projects: [],
});

const context = (lang: string): DeveloperContext => {
    const config = parseAnySiteConfig(developerManifest()) as DeveloperSiteConfig;
    const data: DeveloperData = {
        config,
        resumes: { en: resume('Ada'), de: resume('Ada') },
        apps: [
            {
                id: 'org.example.Notes',
                url: 'https://example.org/notes/',
                name: { en: 'Notes' },
                summary: { en: 'Take notes' },
                languages: ['en'],
            },
        ],
    };
    return {
        data,
        lang,
        t: (msgid) => msgid,
        assets: { js: '/assets/site.js', css: ['/assets/site.css'] },
        avatarUrl: '/assets/ada-12345678.png',
    };
};

export default async () => {
    await describe('site kinds', async () => {
        await it('tells an app site from a developer site, and refuses both or neither', async () => {
            const developer = parseAnySiteConfig(developerManifest());
            expect(developer.kind).toBe('developer');
            expect(developer.base).toBe('/');
            expect(() => parseAnySiteConfig(developerManifest({ metainfo: 'm.xml' }))).toThrow(/both/);
            expect(() => parseAnySiteConfig({ gjsify: { site: { url: 'https://x' } } })).toThrow(/needs "metainfo"/);
            expect(() => parseSiteConfig(developerManifest())).toThrow(/developer site/);
            expect(() => parseAnySiteConfig(developerManifest({ relatedApps: [] }))).toThrow(/developer.apps/);
        });

        await it('requires a résumé for every language', async () => {
            expect(() =>
                parseAnySiteConfig(developerManifest({ developer: { resume: { en: 'cv.en.json' } } })),
            ).toThrow(/developer.resume/);
        });

        await it('validates the theme', async () => {
            const theme = (value: unknown) => parseAnySiteConfig(developerManifest({ theme: value })).theme;
            expect(theme({ accent: '#e01b24' }).accent).toStrictEqual({ light: '#e01b24', dark: '#e01b24' });
            expect(theme(undefined).imageRendering).toBe('auto');
            expect(() => theme({ displayFont: 'font.ttf' })).toThrow(/woff2/);
            expect(() => theme({ imageRendering: 'crisp' })).toThrow(/imageRendering/);
        });
    });

    await describe('layout', async () => {
        const shell = (theme: DeveloperSiteConfig['theme'], displayFontUrl?: string): Shell => ({
            config: { ...context('en').data.config, theme },
            lang: 'en',
            t: (msgid) => msgid,
            assets: { js: '/assets/site.js', css: ['/assets/site.css'] },
            name: 'Ada',
            home: '/en/',
            branding: {},
            licenses: [],
            nav: [],
            feeds: [],
            displayFontUrl,
        });

        await it('announces only the languages a page exists in', async () => {
            const head = documentHead(shell({ imageRendering: 'auto' }), {
                title: 'Post',
                description: 'A post',
                urls: { en: '/en/blog/a/' },
            });
            expect(head).toMatch(/hreflang="en"/);
            expect(head).not.toMatch(/hreflang="de"/);
        });

        await it('writes the theme into the page, and nothing when there is none', async () => {
            const themed = documentHead(
                shell(
                    { accent: { light: '#e01b24', dark: '#ff7b63' }, imageRendering: 'pixelated' },
                    '/assets/f.woff2',
                ),
                { title: 'x', description: 'y', urls: { en: '/en/' } },
            );
            expect(themed).toMatch(/--accent-light:#e01b24;--accent-dark:#ff7b63/);
            expect(themed).toMatch(/@font-face/);
            expect(themed).toMatch(/image-rendering:pixelated/);
            const plain = documentHead(shell({ imageRendering: 'auto' }), { title: 'x', description: 'y', urls: {} });
            expect(plain).not.toMatch(/--accent-light|@font-face|image-rendering/);
        });
    });

    await describe('developer pages', async () => {
        await it('introduces the person with their apps, their posts and a ProfilePage', async () => {
            const html = renderDeveloperHome(context('en'), '<section class="latest-posts"></section>');
            expect(html).toMatch(/<h1>Ada<\/h1>/);
            expect(html).toMatch(/<strong>free<\/strong>/);
            expect(html).toMatch(/href="https:\/\/example.org\/notes\/en\/"/);
            expect(html).toMatch(/class="latest-posts"/);
            expect(html).toMatch(/"@type":"ProfilePage"/);
            expect(html).toMatch(/"sameAs":\["https:\/\/github.com\/ada"\]/);
            expect(html).toMatch(/href="\/en\/cv\/"/);
        });

        await it('lays out the CV by section and leaves out empty ones', async () => {
            const html = renderCv(context('en'));
            expect(html).toMatch(/Founder · Studio/);
            expect(html).toMatch(/March 2015 – today/);
            expect(html).toMatch(/class="cv-section cv-skills"/);
            expect(html).not.toMatch(/cv-education|cv-languages|cv-projects/);
            expect(html).toMatch(/aria-current="page"/);
        });

        await it('links the source of the site from owner/name', async () => {
            const ctx = context('en');
            ctx.data.config = { ...ctx.data.config, repository: 'ada/site' };
            expect(renderCv(ctx)).toMatch(/href="https:\/\/github.com\/ada\/site"/);
        });

        await it('paints the masthead in the accent, having no metainfo branding', async () => {
            const ctx = context('en');
            ctx.data.config = { ...ctx.data.config, theme: { ...ctx.data.config.theme, accent: { light: '#1c7a4a', dark: '#57e389' } } };
            expect(renderCv(ctx)).toMatch(/--brand-light:#1c7a4a/);
        });

        await it('formats résumé dates as precisely as they were written', async () => {
            expect(formatResumeDate('2015', 'en')).toBe('2015');
            expect(formatResumeDate('2015-03', 'de')).toBe('März 2015');
        });
    });
};
