/**
 * The blog: an index per language, one page per post, a page and a feed per tag, and the "latest
 * posts" section an app's landing page shows. Every page renders through `layout.ts`, so a blog on
 * an app site and one on a developer site look the same (ADR 0120 §4).
 */
import { posix } from 'node:path';

import { tagSlug, type BlogPost, type SiteCommonConfig } from '../site-data/index.js';
import { atomFeed, type FeedEntry } from './feed.js';
import { esc, fmt, plain } from './html.js';
import { icon } from './icons.js';
import { absoluteUrl, documentPage, pageMasthead, sitePageUrl, type PageMeta, type Shell } from './layout.js';
import { renderMarkdown } from './markdown.js';
import { blogPostingJsonLd, metaDescription } from './seo.js';

type Config = Pick<SiteCommonConfig, 'base'>;

/** How many posts an app's landing page shows. */
export const LATEST_POSTS = 3;

export function blogIndexUrl(config: Config, lang: string): string {
    return sitePageUrl(config, lang, 'blog/');
}

export function blogFeedUrl(config: Config, lang: string, tag?: string): string {
    return sitePageUrl(config, lang, tag ? `blog/tags/${tagSlug(tag)}/feed.xml` : 'blog/feed.xml');
}

export function postUrl(config: Config, post: Pick<BlogPost, 'lang' | 'slug'>): string {
    return sitePageUrl(config, post.lang, `blog/${post.slug}/`);
}

export function tagUrl(config: Config, lang: string, tag: string): string {
    return sitePageUrl(config, lang, `blog/tags/${tagSlug(tag)}/`);
}

/** The post's own link-preview card, written next to its page. */
export function postOgImage(config: Config, post: Pick<BlogPost, 'lang' | 'slug'>): string {
    return `${postUrl(config, post)}og.png`;
}

const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i;

/**
 * Rewrites the URLs a post's Markdown names. A relative image or file resolves against the post's
 * own directory below `<base>blog/` — where the build copies the asset files. A relative link to
 * another post's `.md` file becomes that post's page, so a writer links files the way the editor
 * shows them and the published page links pages.
 */
export function postUrlResolver(
    config: Config,
    post: BlogPost,
    postsDir: string,
    posts: readonly BlogPost[],
): (url: string) => string {
    const own = posix.dirname(posix.relative(toPosix(postsDir), toPosix(post.file)));
    const byFile = new Map(posts.map((other) => [posix.relative(toPosix(postsDir), toPosix(other.file)), other]));
    return (url) => {
        if (ABSOLUTE.test(url)) return url;
        const [path = '', hash] = url.split('#', 2);
        const target = posix.normalize(posix.join(own, decodeURI(path)));
        if (target.startsWith('..')) return url;
        if (path.endsWith('.md')) {
            const linked = byFile.get(target);
            // The build never publishes Markdown, so a link to a post it does not render is dead.
            if (!linked) throw new Error(`${post.file}: links to ${path}, which is not a published post (a draft?)`);
            return `${postUrl(config, linked)}${hash ? `#${hash}` : ''}`;
        }
        return `${config.base}blog/${encodeURI(target)}${hash ? `#${hash}` : ''}`;
    };
}

function toPosix(path: string): string {
    return path.split('\\').join('/');
}

export function formatPostDate(date: string, lang: string): string {
    const time = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date;
    return new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(time));
}

/** The first paragraph of the Markdown body, reduced to its text. */
function firstParagraph(body: string): string | undefined {
    const paragraph = body
        .split(/\n\s*\n/)
        .map((block) => block.trim())
        .find((block) => block !== '' && !/^(?:#|!\[|```|~~~|>|[-*+] |\d+\. |\||<)/.test(block));
    return paragraph
        ?.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`]/g, '')
        .replace(/\s+/g, ' ');
}

/** `summary`, or the start of the body when the post has none. */
export function postDescription(post: BlogPost): string {
    return post.summary ?? metaDescription('', firstParagraph(post.body));
}

function postMeta(post: BlogPost, shell: Shell): string {
    const { config, lang, t } = shell;
    const tags = post.tags.map(
        (tag) => `<li><a class="tag" href="${esc(tagUrl(config, lang, tag))}" rel="tag">${esc(tag)}</a></li>`,
    );
    const updated =
        post.updated && post.updated !== post.date
            ? ` · ${fmt(t('Updated {date}'), { date: formatPostDate(post.updated, lang) })}`
            : '';
    return `<p class="post-meta"><time datetime="${esc(post.date)}">${esc(formatPostDate(post.date, lang))}</time>${updated}${post.draft ? ` · <strong>${esc(t('Draft'))}</strong>` : ''}</p>
${tags.length > 0 ? `<ul class="post-tags">${tags.join('')}</ul>` : ''}`;
}

function postCard(shell: Shell, post: BlogPost, heading: 'h2' | 'h3'): string {
    const description = postDescription(post);
    return `<li><article class="post-card">
<${heading}><a href="${esc(postUrl(shell.config, post))}">${esc(post.title)}</a></${heading}>
${postMeta(post, shell)}
${description ? `<p>${esc(description)}</p>` : ''}
</article></li>`;
}

function feedLink(shell: Shell, href: string): string {
    return `<p class="post-feed"><a href="${esc(href)}">${icon('feed')}<span>${esc(shell.t('Subscribe to the feed'))}</span></a></p>`;
}

export interface BlogIndexOptions {
    /** Every post of the site, all languages: which other languages have a blog decides the switch. */
    posts: readonly BlogPost[];
    /** Renders the page of one tag instead of the whole index. */
    tag?: string;
    ogImage?: string;
}

/** `/<lang>/blog/` or `/<lang>/blog/tags/<tag>/`. */
export function renderBlogIndex(shell: Shell, options: BlogIndexOptions): string {
    const { config, lang, t } = shell;
    const { tag } = options;
    const inLanguage = options.posts.filter(
        (post) => post.lang === lang && (tag === undefined || post.tags.includes(tag)),
    );
    const urls: Record<string, string> = {};
    // Every language has an index, if an empty one; a tag page exists only where the tag is used.
    for (const code of config.languages) {
        if (tag === undefined) urls[code] = blogIndexUrl(config, code);
        else if (code === lang || options.posts.some((post) => post.lang === code && post.tags.includes(tag)))
            urls[code] = tagUrl(config, code, tag);
    }
    const heading = tag ? plain(t('Posts tagged “{tag}”'), { tag }) : t('Blog');
    const page: PageMeta = {
        title: `${shell.name} – ${heading}`,
        description: tag ? heading : plain(t('Posts by {name}'), { name: shell.name }),
        urls,
        fallback: (code) => blogIndexUrl(config, code),
        ogImage: options.ogImage,
    };
    const list =
        inLanguage.length > 0
            ? `<ul class="post-list">\n${inLanguage.map((post) => postCard(shell, post, 'h2')).join('\n')}\n</ul>`
            : `<p class="post-empty">${esc(t('No posts in this language yet.'))}</p>`;
    const back = tag
        ? `\n<p class="support-back"><a href="${esc(blogIndexUrl(config, lang))}">${esc(t('All posts'))}</a></p>`
        : '';
    return documentPage(
        shell,
        page,
        `${pageMasthead(shell, heading, shell.name)}
<main>
<div class="column blog">
${list}
${feedLink(shell, blogFeedUrl(config, lang, tag))}${back}
</div>
</main>`,
    );
}

export interface BlogPostOptions {
    posts: readonly BlogPost[];
    /** The post's body, rendered — with `postUrlResolver` applied. */
    html: string;
    author: { name: string; url?: string };
}

/** `/<lang>/blog/<slug>/`. */
export function renderBlogPost(shell: Shell, post: BlogPost, options: BlogPostOptions): string {
    const { config, lang, t } = shell;
    const urls: Record<string, string> = {};
    for (const other of options.posts) if (other.slug === post.slug) urls[other.lang] = postUrl(config, other);
    const description = postDescription(post);
    const url = absoluteUrl(config, postUrl(config, post));
    const ogImage = postOgImage(config, post);
    const page: PageMeta = {
        title: `${post.title} – ${shell.name}`,
        description,
        urls,
        fallback: (code) => blogIndexUrl(config, code),
        ogType: 'article',
        ogImage,
        meta: [
            ['article:published_time', post.date],
            ...(post.updated ? [['article:modified_time', post.updated] as [string, string]] : []),
            ...post.tags.map((tag): [string, string] => ['article:tag', tag]),
        ],
        jsonLd: blogPostingJsonLd({
            title: post.title,
            description,
            url,
            published: post.date,
            updated: post.updated,
            author: options.author.name,
            authorUrl: options.author.url,
            image: absoluteUrl(config, ogImage),
            lang,
            tags: post.tags,
        }),
    };
    return documentPage(
        shell,
        page,
        `<main>
<article class="column post">
<header class="post-head">
<p class="post-back"><a href="${esc(blogIndexUrl(config, lang))}">${icon('chevron-left')}<span>${esc(t('Blog'))}</span></a></p>
<h1>${esc(post.title)}</h1>
${postMeta(post, shell)}
</header>
<div class="post-body">
${options.html}
</div>
</article>
</main>`,
        'blog-post',
    );
}

/** The newest posts as a landing-page section; empty when the language has none. */
export function latestPostsSection(shell: Shell, posts: readonly BlogPost[], count = LATEST_POSTS): string {
    const { config, lang, t } = shell;
    const latest = posts.filter((post) => post.lang === lang).slice(0, count);
    if (latest.length === 0) return '';
    return `<section class="latest-posts">
<h2>${esc(t('From the blog'))}</h2>
<ul class="post-list">
${latest.map((post) => postCard(shell, post, 'h3')).join('\n')}
</ul>
<p class="post-feed"><a href="${esc(blogIndexUrl(config, lang))}">${esc(t('All posts'))}</a></p>
</section>`;
}

export interface BlogFeedOptions {
    posts: readonly BlogPost[];
    tag?: string;
    author: { name: string; uri?: string };
    /** Rendered body per post, keyed `<lang>/<slug>`. */
    html: ReadonlyMap<string, string>;
    iconUrl?: string;
}

export function postKey(post: Pick<BlogPost, 'lang' | 'slug'>): string {
    return `${post.lang}/${post.slug}`;
}

/** The Atom feed of one language, or of one tag in it. Relative URLs in the content are made absolute. */
export function renderBlogFeed(shell: Shell, options: BlogFeedOptions): string {
    const { config, lang, t } = shell;
    const { tag } = options;
    const posts = options.posts.filter((post) => post.lang === lang && (tag === undefined || post.tags.includes(tag)));
    const origin = `${new URL(config.url).origin}`;
    const absolutize = (html: string) => html.replace(/(\s(?:href|src)=")\//g, `$1${origin}/`);
    const entries: FeedEntry[] = posts.map((post) => {
        const url = absoluteUrl(config, postUrl(config, post));
        return {
            id: url,
            url,
            title: post.title,
            published: post.date,
            updated: post.updated,
            summary: post.summary,
            contentHtml: absolutize(options.html.get(postKey(post)) ?? ''),
            tags: post.tags,
        };
    });
    const site = absoluteUrl(config, tag ? tagUrl(config, lang, tag) : blogIndexUrl(config, lang));
    const self = absoluteUrl(config, blogFeedUrl(config, lang, tag));
    return atomFeed(
        {
            id: self,
            title: tag ? `${shell.name} – ${tag}` : `${shell.name} – ${t('Blog')}`,
            selfUrl: self,
            siteUrl: site,
            lang,
            author: options.author,
            icon: options.iconUrl ? absoluteUrl(config, options.iconUrl) : undefined,
        },
        entries,
    );
}

/** Every tag in one language, in first-use order. */
export function tagsOf(posts: readonly BlogPost[], lang: string): string[] {
    return [...new Set(posts.filter((post) => post.lang === lang).flatMap((post) => post.tags))];
}

/** Renders a post's Markdown with its URLs resolved. */
export function renderPostBody(config: Config, post: BlogPost, postsDir: string, posts: readonly BlogPost[]): string {
    return renderMarkdown(post.body, { resolveUrl: postUrlResolver(config, post, postsDir, posts) });
}
