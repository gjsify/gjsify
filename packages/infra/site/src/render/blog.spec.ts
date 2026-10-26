import { describe, expect, it } from '@gjsify/unit';

import type { BlogPost } from '../site-data/index.js';
import {
    latestPostsSection,
    postDescription,
    postUrlResolver,
    renderBlogFeed,
    renderBlogIndex,
    renderBlogPost,
    tagsOf,
} from './blog.js';
import type { Shell } from './layout.js';

const config = {
    base: '/',
    url: 'https://example.org/',
    languages: ['en', 'de'],
    defaultLanguage: 'en',
    sourceLanguage: 'en',
    support: [],
    legal: [],
    theme: { imageRendering: 'auto' as const },
    blog: { posts: 'blog' },
};

const shell = (lang: string): Shell => ({
    config,
    lang,
    t: (msgid) => msgid,
    assets: { js: '/assets/site.js', css: ['/assets/site.css'] },
    name: 'Ada',
    home: `/${lang}/`,
    branding: {},
    licenses: [],
    nav: [],
    feeds: [],
});

const post = (slug: string, lang: string, extra: Partial<BlogPost> = {}): BlogPost => ({
    slug,
    lang,
    title: `${slug} (${lang})`,
    date: '2026-10-01',
    tags: [],
    draft: false,
    body: 'First paragraph of the post.\n\nSecond one.',
    file: `/repo/blog/${slug}.${lang}.md`,
    ...extra,
});

export default async () => {
    await describe('blog', async () => {
        await it('resolves a post’s relative links to published files and other posts’ pages', async () => {
            const posts = [post('hello', 'en', { file: '/repo/blog/2026/hello.en.md' }), post('other', 'en')];
            const resolve = postUrlResolver(config, posts[0]!, '/repo/blog', posts);
            expect(resolve('shot.png')).toBe('/blog/2026/shot.png');
            expect(resolve('../other.en.md#part')).toBe('/en/blog/other/#part');
            expect(resolve('https://example.com/x.png')).toBe('https://example.com/x.png');
            expect(resolve('/elsewhere/')).toBe('/elsewhere/');
            expect(resolve('#heading')).toBe('#heading');
            // Outside the posts directory there is nothing the build published.
            expect(resolve('../../secret.txt')).toBe('../../secret.txt');
            expect(() => resolve('draft.en.md')).toThrow(/not a published post/);
        });

        await it('describes a post by its summary, else by its first paragraph', async () => {
            expect(postDescription(post('a', 'en', { summary: 'Short.' }))).toBe('Short.');
            expect(postDescription(post('a', 'en', { body: '# Heading\n\nSome *real* [text](x.md).' }))).toBe(
                'Some real text.',
            );
        });

        await it('lists only the language’s posts and links every language’s index', async () => {
            const posts = [post('a', 'en'), post('b', 'de')];
            const html = renderBlogIndex(shell('en'), { posts });
            expect(html).toMatch(/href="\/en\/blog\/a\/"/);
            expect(html).not.toMatch(/\/de\/blog\/b\//);
            expect(html).toMatch(/hreflang="de" href="https:\/\/example.org\/de\/blog\/"/);
            expect(renderBlogIndex(shell('de'), { posts: [post('a', 'en')] })).toMatch(/No posts in this language yet/);
        });

        await it('gives a tag page only the languages that use the tag', async () => {
            const posts = [post('a', 'en', { tags: ['GNOME'] }), post('b', 'de', { tags: ['Rust'] })];
            const html = renderBlogIndex(shell('en'), { posts, tag: 'GNOME' });
            expect(html).toMatch(/Posts tagged “GNOME”/);
            expect(html).not.toMatch(/hreflang="de"/);
            expect(tagsOf(posts, 'en')).toStrictEqual(['GNOME']);
        });

        await it('marks up a post as an article with its translations', async () => {
            const posts = [post('a', 'en', { tags: ['GNOME'], updated: '2026-10-05' }), post('a', 'de')];
            const html = renderBlogPost(shell('en'), posts[0]!, {
                posts,
                html: '<p>Body</p>',
                author: { name: 'Ada' },
            });
            expect(html).toMatch(/<meta property="og:type" content="article">/);
            expect(html).toMatch(/article:tag" content="GNOME"/);
            expect(html).toMatch(/"@type":"BlogPosting"/);
            expect(html).toMatch(/hreflang="de" href="https:\/\/example.org\/de\/blog\/a\/"/);
            expect(html).toMatch(/Updated October 5, 2026/);
            expect(html).toMatch(/<p>Body<\/p>/);
        });

        await it('shows the newest posts of the language on a landing page, or nothing', async () => {
            const posts = ['a', 'b', 'c', 'd'].map((slug) => post(slug, 'en'));
            const html = latestPostsSection(shell('en'), posts);
            expect(html.match(/<article/g)?.length).toBe(3);
            expect(latestPostsSection(shell('de'), posts)).toBe('');
        });

        await it('publishes absolute URLs in the feed', async () => {
            const posts = [post('a', 'en')];
            const xml = renderBlogFeed(shell('en'), {
                posts,
                author: { name: 'Ada' },
                html: new Map([['en/a', '<img src="/blog/x.png">']]),
            });
            expect(xml).toMatch(/<id>https:\/\/example.org\/en\/blog\/feed.xml<\/id>/);
            expect(xml).toMatch(/https:\/\/example.org\/blog\/x.png/);
            expect(xml).toMatch(/https:\/\/example.org\/en\/blog\/a\//);
        });
    });
};
