import { describe, expect, it } from '@gjsify/unit';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseFrontmatter } from './frontmatter.js';
import { blogAssetFiles, loadBlogPosts, postTime, tagSlug, translationsOf } from './blog.js';
import { parseResume } from './resume.js';

export default async () => {
    await describe('frontmatter', async () => {
        await it('parses frontmatter with BOM and CRLF', async () => {
            const text = '\uFEFF---\r\ntitle: Hello\r\n---\r\nBody';
            const result = parseFrontmatter(text, 'test.md');
            expect(result.data.title as string).toBe('Hello');
            expect(result.body).toBe('Body');
        });

        await it('returns empty data and full text if no leading ---', async () => {
            const text = 'no frontmatter here';
            const result = parseFrontmatter(text, 'test.md');
            expect(Object.keys(result.data).length).toBe(0);
            expect(result.body).toBe(text);
        });

        await it('parses quoted strings and booleans', async () => {
            const text = '---\ntitle: "Hello \\"World\\""\ndraft: true\npublished: false\n---\n';
            const result = parseFrontmatter(text, 'test.md');
            expect(result.data.title).toBe('Hello "World"');
            expect(result.data.draft).toBe(true);
            expect(result.data.published).toBe(false);
        });

        await it('parses single quoted strings with doubled single quotes', async () => {
            const text = "---\ntitle: 'it''s fine'\n---\n";
            const result = parseFrontmatter(text, 'test.md');
            expect(result.data.title).toBe("it's fine");
        });

        await it('parses inline lists', async () => {
            const text = '---\ntags: [a, "b c", d]\n---\n';
            const result = parseFrontmatter(text, 'test.md');
            expect(result.data.tags).toStrictEqual(['a', 'b c', 'd']);
        });

        await it('parses dash lists', async () => {
            const text = '---\ntags:\n  - item1\n  - "item 2"\n---\nbody';
            const result = parseFrontmatter(text, 'test.md');
            expect(result.data.tags).toStrictEqual(['item1', 'item 2']);
            expect(result.body).toBe('body');
        });
    });

    await describe('blog', async () => {
        await it('loads blog posts with filename-based slug/lang and sorting', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'site-blog-'));
            try {
                await writeFile(join(dir, 'hello.en.md'), '---\ntitle: Hello\ndate: 2024-01-01\n---\nBody1');
                await writeFile(join(dir, 'hello.de.md'), '---\ntitle: Hallo\ndate: 2024-01-01\n---\nBody2');
                await writeFile(join(dir, 'other.en.md'), '---\ntitle: Other\ndate: 2024-02-01\n---\nBody3');
                const posts = await loadBlogPosts({ dir, languages: ['en', 'de'], drafts: false });
                expect(posts.length).toBe(3);
                expect(posts[0]!.slug).toBe('other');
                expect(translationsOf(posts, posts[0]!).length).toBe(0);
                const helloEn = posts.find((p) => p.slug === 'hello' && p.lang === 'en')!;
                expect(translationsOf(posts, helloEn).length).toBe(1);
            } finally {
                await rm(dir, { recursive: true, force: true });
            }
        });

        await it('tagSlug normalizes', async () => {
            expect(tagSlug('Café & Co!')).toBe('cafe-co');
        });

        await it('postTime handles date-only as UTC midnight', async () => {
            expect(postTime('2024-01-01')).toBe(Date.UTC(2024, 0, 1));
        });

        await it('blogAssetFiles returns non-md files relative with POSIX', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'site-blog-'));
            try {
                await writeFile(join(dir, 'hello.en.md'), '---\ntitle: Hi\ndate: 2024-01-01\n---\n');
                await writeFile(join(dir, 'image.png'), 'x');
                const assets = await blogAssetFiles(dir);
                expect(assets).toStrictEqual(['image.png']);
            } finally {
                await rm(dir, { recursive: true, force: true });
            }
        });
    });

    await describe('resume', async () => {
        await it('parses resume and validates dates/required fields', async () => {
            const resume = parseResume(
                {
                    basics: { name: 'John', profiles: [{ network: 'github', username: 'j' }] },
                    work: [{ name: 'Acme', startDate: '2020-01' }],
                    education: [{ institution: 'Uni' }],
                    skills: [{ name: 'JS', keywords: ['a'] }],
                    languages: [{ language: 'en' }],
                    projects: [{ name: 'p', highlights: [], keywords: [] }],
                },
                'resume.json',
            );
            expect(resume.basics.name).toBe('John');
        });

        await it('errors on wrong types with path', async () => {
            expect(() => {
                parseResume(
                    {
                        basics: { name: 'John', profiles: [] },
                        work: [{ name: 'Acme', startDate: 123 }],
                        education: [],
                        skills: [],
                        languages: [],
                        projects: [],
                    },
                    'resume.json',
                );
            }).toThrow(/resume\.json: work\[0\]\.startDate must be a string/);
        });
    });
};
