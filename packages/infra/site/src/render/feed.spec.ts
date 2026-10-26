import { describe, expect, it } from '@gjsify/unit';

import { atomFeed } from './feed.js';

export default async () => {
    await describe('atomFeed', async () => {
        await it('produces well-formed Atom with required elements', async () => {
            const xml = atomFeed(
                {
                    id: 'urn:example:feed',
                    title: 'Blog',
                    subtitle: 'A blog',
                    selfUrl: 'https://example.com/feed.xml',
                    siteUrl: 'https://example.com/',
                    lang: 'en',
                    author: { name: 'Alice', uri: 'https://example.com' },
                    icon: 'https://example.com/icon.png',
                },
                [
                    {
                        id: 'urn:example:post-1',
                        url: 'https://example.com/post-1',
                        title: 'Hello & World',
                        published: '2024-01-01',
                        updated: '2024-01-02T10:00:00Z',
                        summary: 'A & B',
                        contentHtml: '<p>Hi &amp; bye</p>',
                        tags: ['news', 'tech'],
                    },
                ],
            );
            expect(xml).toContain('<?xml version="1.0" encoding="utf-8"?>');
            expect(xml).toContain('xmlns="http://www.w3.org/2005/Atom"');
            expect(xml).toContain('xml:lang="en"');
            expect(xml).toContain('rel="self"');
            expect(xml).toContain('rel="alternate"');
            expect(xml).toContain('<author>');
            expect(xml).toContain('<category term="news"/>');
            expect(xml).toContain('<content type="html">');
            // escaping
            expect(xml).toContain('Hello &amp; World');
            expect(xml).toContain('&lt;p&gt;');
        });

        await it('normalizes dates to RFC3339 and sets feed updated to newest', async () => {
            const xml = atomFeed(
                {
                    id: 'id',
                    title: 't',
                    selfUrl: 'https://x/feed.xml',
                    siteUrl: 'https://x/',
                    lang: 'en',
                    author: { name: 'A' },
                },
                [
                    { id: '1', url: 'u1', title: 't1', published: '2024-01-01', contentHtml: '<p>x</p>', tags: [] },
                    {
                        id: '2',
                        url: 'u2',
                        title: 't2',
                        published: '2024-05-01',
                        updated: '2024-06-01',
                        contentHtml: '<p>y</p>',
                        tags: [],
                    },
                ],
            );
            expect(xml).toContain('<updated>2024-06-01T00:00:00Z</updated>');
            expect(xml).toContain('<published>2024-01-01T00:00:00Z</published>');
        });

        await it('empty feed has updated 1970-01-01T00:00:00Z', async () => {
            const xml = atomFeed(
                {
                    id: 'id',
                    title: 't',
                    selfUrl: 'https://x/feed.xml',
                    siteUrl: 'https://x/',
                    lang: 'en',
                    author: { name: 'A' },
                },
                [],
            );
            expect(xml).toContain('<updated>1970-01-01T00:00:00Z</updated>');
        });
    });
};
