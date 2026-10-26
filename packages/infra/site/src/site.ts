// The two things a consumer asks of this package: render the pages of a repository, and keep the
// page catalogues in sync with the strings the renderer can emit. `cli.ts` is argv parsing on top.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogMsgids, configMsgids, rendererMsgids, syncCatalogs, type I18nResult } from './render/i18n.js';
import { readableText } from './render/color.js';
import { svgToPng } from './render/image-backend.js';
import { processImage, type ProcessedImage } from './render/images.js';
import {
    blogFeedUrl,
    blogIndexUrl,
    latestPostsSection,
    postDescription,
    postKey,
    postOgImage,
    postUrl,
    renderBlogFeed,
    renderBlogIndex,
    renderBlogPost,
    renderPostBody,
    tagsOf,
    tagUrl,
} from './render/blog.js';
import {
    developerPageUrl,
    developerShell,
    renderCv,
    renderDeveloperHome,
    renderDeveloperLegalNoticePage,
    renderDeveloperPrivacyPage,
    renderDeveloperSupportPage,
    type DeveloperContext,
    type DeveloperView,
} from './render/developer.js';
import { ogCardSvg, type OgCardInput } from './render/og-card.js';
import {
    absolute,
    appShell,
    legalNoticeUrl,
    localized,
    pageMeta,
    pageUrl,
    privacyUrl,
    renderLegalNoticePage,
    renderPage,
    renderPrivacyPage,
    renderRoot,
    renderSupportPage,
    supportUrl,
    type RenderContext,
} from './render/pages.js';
import { absoluteUrl, rootPage, type ClientAssets, type Shell } from './render/layout.js';
import { neighbourSitemaps, robotsTxt, seoWarnings, sitemapXml, type SitemapPage } from './render/seo.js';
import {
    UI_SOURCE_LANGUAGE,
    loadCatalogs,
    loadSiteData,
    mergeCatalogs,
    blogAssetFiles,
    loadBlogPosts,
    loadDeveloperData,
    parseAnySiteConfig,
    translator,
    type Catalog,
    type RootManifest,
    type AnySiteConfig,
    type BlogPost,
    type DeveloperData,
    type DeveloperSiteConfig,
    type SiteCommonConfig,
    type SiteRelatedAppConfig,
    type SiteData,
    APP_MANIFEST_FILE,
    buildAppManifest,
    loadLegalNoticeStatements,
    loadPrivacyStatements,
} from './site-data/index.js';

/**
 * This package's own directory: `lib/` holds the client bundle, `po/` the page catalogues.
 *
 * Both `src/site.ts` and the emitted `lib/site.js` sit one level below it, so the module's own URL
 * answers this — except from a bundle, where the inlined module reports the outfile's location. A
 * caller that knows better passes `packageDir`.
 */
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const poDir = (dir = packageDir) => join(dir, 'po');
const clientDir = (dir = packageDir) => join(dir, 'lib/client');
/** Where the renderer's translator calls are read from when this package's own catalogue is synced. */
const rendererDir = (dir = packageDir) => join(dir, 'src/render');
/** `options.packageDir` when given, else the install this module was loaded from. */
const selfDir = (given?: string) => (given === undefined ? packageDir : resolve(given));

/** Where a build reads from and writes to. */
export interface SiteTarget {
    /** Repository root: the root package.json, the metainfo, the screenshots and the icon are read from here. */
    root: string;
    /** Output directory, emptied first. */
    out: string;
}

export interface SiteBuildOptions extends SiteTarget {
    /** Skip every network call; the page is rendered from what is in the repository. */
    offline?: boolean;
    /** Render blog posts marked `draft: true`, for a local preview. */
    drafts?: boolean;
    /**
     * Where the one-hour HTTP response cache and the image renditions live; `false` disables the
     * response cache. A published package must not write inside its own install, so the default is
     * the consumer project's own build cache.
     */
    cacheDir?: string | false;
    /** Raises the GitHub API rate limit. Optional — the public limit is enough for a single build. */
    githubToken?: string;
    log?: (message: string) => void;
    warn?: (message: string) => void;
    /** This package's install, for a caller whose module URL does not reveal it — a bundle. */
    packageDir?: string;
}

export interface SiteBuildResult {
    /** The languages that were rendered, in configuration order. */
    languages: string[];
    /** Screenshot source paths that were turned into renditions. */
    screenshots: number;
}

export function defaultCacheDir(root: string): string {
    return join(root, 'node_modules/.cache/gjsify-site');
}

async function readConfig(root: string): Promise<AnySiteConfig> {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as RootManifest;
    return parseAnySiteConfig(manifest);
}

/** Short, stable and enough to bust a cache: the first bytes of the content's SHA-256. */
function contentHash(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

async function writePage(out: string, path: string, html: string): Promise<void> {
    await mkdir(dirname(join(out, path)), { recursive: true });
    await writeFile(join(out, path), html);
}

/** Copies a repository file to `assets/` under a content-addressed name; answers its URL. */
async function publishHashed(source: string, out: string, base: string): Promise<string> {
    const content = await readFile(source);
    const extension = extname(source);
    const name = `${basename(source, extension)}-${contentHash(content)}${extension}`;
    await mkdir(join(out, 'assets'), { recursive: true });
    await writeFile(join(out, 'assets', name), content);
    return `${base}assets/${name}`;
}

async function publishDisplayFont(config: SiteCommonConfig, { root, out }: SiteTarget): Promise<string | undefined> {
    const font = config.theme.displayFont;
    return font ? publishHashed(resolve(root, font), out, config.base) : undefined;
}

/**
 * Stages the client bundle and the stylesheet this package ships, under content-addressed names.
 * Both are built once, when the package is built — a site build neither needs a bundler nor an
 * opinion about one.
 */
async function stageClientAssets(base: string, out: string, self: string): Promise<ClientAssets> {
    const assetDir = join(out, 'assets');
    await mkdir(assetDir, { recursive: true });
    const staged = await Promise.all(
        (['js', 'css'] as const).map(async (extension) => {
            const content = await readFile(join(clientDir(self), `site.${extension}`));
            const name = `site-${contentHash(content)}.${extension}`;
            await writeFile(join(assetDir, name), content);
            return `${base}assets/${name}`;
        }),
    );
    return { js: staged[0]!, css: [staged[1]!] };
}

/** Keyed by slug, which is what a `Screenshot` carries and the renderer looks up. */
async function processScreenshots(
    data: SiteData,
    { out }: SiteTarget,
    cacheDir: string,
): Promise<Map<string, ProcessedImage>> {
    const options = {
        outDir: join(out, 'img'),
        cacheDir: join(cacheDir, 'images'),
        urlBase: `${data.config.base}img/`,
        pixelated: data.config.theme.imageRendering === 'pixelated',
    };
    const entries = await Promise.all(
        data.screenshots.map(
            async (screenshot) =>
                [screenshot.slug, await processImage(screenshot.file, screenshot.slug, options)] as const,
        ),
    );
    return new Map(entries);
}

const ICON_TYPES: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png' };

/** The icon inlined, so the card's SVG is self-contained when the pixbuf loader rasterises it. */
async function iconDataUri(data: SiteData, { root }: SiteTarget): Promise<string | undefined> {
    if (!data.app.icon) return undefined;
    const type = ICON_TYPES[extname(data.app.icon).toLowerCase()];
    if (!type) return undefined;
    const bytes = await readFile(resolve(root, data.app.icon));
    return `data:${type};base64,${bytes.toString('base64')}`;
}

async function publishIcon(data: SiteData, { root, out }: SiteTarget): Promise<string | undefined> {
    if (!data.app.icon) return undefined;
    const name = basename(data.app.icon);
    await copyFile(resolve(root, data.app.icon), join(out, name));
    return `${data.config.base}${name}`;
}

/**
 * The page catalogues: the ones this package ships, overlaid with the consumer's own. A consumer
 * writes its captions and download labels itself, so only it can translate them.
 */
async function loadPageCatalogs(
    config: AnySiteConfig,
    root: string,
    self: string,
    warn?: (message: string) => void,
): Promise<Record<string, Catalog>> {
    const base = await loadCatalogs(poDir(self), config.languages);
    const catalogs = config.pageTranslations
        ? mergeCatalogs(base, await loadCatalogs(resolve(root, config.pageTranslations), config.languages))
        : base;
    if (warn) {
        const own = configMsgids(config);
        for (const language of config.languages) {
            if (language === UI_SOURCE_LANGUAGE) continue;
            const missing = own.filter((msgid) => !catalogs[language]?.get(msgid));
            if (missing.length === 0) continue;
            warn(
                `${language}: ${missing.length} string(s) from gjsify.site are untranslated, e.g. "${missing[0]}". ` +
                    'Run "gjsify site i18n" to write them to gjsify.site.pageTranslations.',
            );
        }
    }
    return catalogs;
}

/** The posts of a site with a blog, their rendered bodies, and where they came from. */
interface BlogBuild {
    posts: BlogPost[];
    html: Map<string, string>;
}

/** Reads the posts and copies the files next to them to `<out>/blog/`, where the post URLs point. */
async function loadBlog(config: SiteCommonConfig, target: SiteTarget, drafts: boolean): Promise<BlogBuild | undefined> {
    if (!config.blog) return undefined;
    const dir = resolve(target.root, config.blog.posts);
    const posts = await loadBlogPosts({ dir, languages: config.languages, drafts });
    for (const file of await blogAssetFiles(dir)) {
        await mkdir(dirname(join(target.out, 'blog', file)), { recursive: true });
        await copyFile(join(dir, file), join(target.out, 'blog', file));
    }
    const html = new Map(posts.map((post) => [postKey(post), renderPostBody(config, post, dir, posts)]));
    return { posts, html };
}

interface BlogPages {
    blog: BlogBuild;
    shell: (lang: string) => Shell;
    author: { name: string; uri?: string };
    card: Omit<OgCardInput, 'name' | 'summary'>;
    iconUrl?: string;
    /** The site's own card, for the index and tag pages. */
    ogImage: (lang: string) => string;
}

/** Writes the blog of every language and answers its sitemap entries. */
async function writeBlog(config: SiteCommonConfig, out: string, pages: BlogPages): Promise<SitemapPage[]> {
    const { blog } = pages;
    const absoluteAll = (urls: Record<string, string>) =>
        Object.fromEntries(Object.entries(urls).map(([lang, url]) => [lang, absoluteUrl(config, url)]));
    const sitemap: SitemapPage[] = [
        absoluteAll(Object.fromEntries(config.languages.map((lang) => [lang, blogIndexUrl(config, lang)]))),
    ];
    const relative = (url: string) => url.slice(config.base.length);
    for (const lang of config.languages) {
        const shell = pages.shell(lang);
        const feed = { posts: blog.posts, author: pages.author, html: blog.html, iconUrl: pages.iconUrl };
        await writePage(
            out,
            `${relative(blogIndexUrl(config, lang))}index.html`,
            renderBlogIndex(shell, { posts: blog.posts, ogImage: pages.ogImage(lang) }),
        );
        await writePage(out, relative(blogFeedUrl(config, lang)), renderBlogFeed(shell, feed));
        for (const tag of tagsOf(blog.posts, lang)) {
            await writePage(
                out,
                `${relative(tagUrl(config, lang, tag))}index.html`,
                renderBlogIndex(shell, { posts: blog.posts, tag, ogImage: pages.ogImage(lang) }),
            );
            await writePage(out, relative(blogFeedUrl(config, lang, tag)), renderBlogFeed(shell, { ...feed, tag }));
            sitemap.push({ [lang]: absoluteUrl(config, tagUrl(config, lang, tag)) });
        }
        for (const post of blog.posts.filter((candidate) => candidate.lang === lang)) {
            const html = blog.html.get(postKey(post)) ?? '';
            await writePage(
                out,
                `${relative(postUrl(config, post))}index.html`,
                renderBlogPost(shell, post, {
                    posts: blog.posts,
                    html,
                    author: { name: pages.author.name, url: pages.author.uri },
                }),
            );
            const card = ogCardSvg({ ...pages.card, name: post.title, summary: postDescription(post) });
            await writeFile(join(out, relative(postOgImage(config, post))), svgToPng(card));
        }
    }
    for (const slug of new Set(blog.posts.map((post) => post.slug))) {
        const translations = blog.posts.filter((post) => post.slug === slug);
        sitemap.push(absoluteAll(Object.fromEntries(translations.map((post) => [post.lang, postUrl(config, post)]))));
    }
    return sitemap;
}

function writeSitemap(
    config: SiteCommonConfig,
    out: string,
    pages: SitemapPage[],
    apps: readonly SiteRelatedAppConfig[],
): Promise<void>[] {
    return [
        writeFile(join(out, 'sitemap.xml'), sitemapXml(pages, config.defaultLanguage)),
        // Only a site served from the host root can own `/robots.txt`; below a path the host does.
        ...(config.base === '/'
            ? [
                  writeFile(
                      join(out, 'robots.txt'),
                      robotsTxt([absoluteUrl(config, `${config.base}sitemap.xml`), ...neighbourSitemaps(config.url, apps)]),
                  ),
              ]
            : []),
    ];
}


/** Renders one static page per configured language, plus the language-picking root page. */
export async function buildSite(options: SiteBuildOptions): Promise<SiteBuildResult> {
    const target: SiteTarget = { root: resolve(options.root), out: resolve(options.out) };
    const cacheDir = options.cacheDir === false ? undefined : (options.cacheDir ?? defaultCacheDir(target.root));
    const self = selfDir(options.packageDir);
    const config = await readConfig(target.root);

    await rm(target.out, { recursive: true, force: true });
    await mkdir(target.out, { recursive: true });
    const assets = await stageClientAssets(config.base, target.out, self);
    const catalogs = await loadPageCatalogs(config, target.root, self, options.warn);
    const displayFontUrl = await publishDisplayFont(config, target);
    const blog = await loadBlog(config, target, options.drafts ?? false);
    const build = { options, target, cacheDir, assets, catalogs, displayFontUrl, blog };
    return config.kind === 'app' ? buildAppSite(build) : buildDeveloperSite(config, build);
}

interface Build {
    options: SiteBuildOptions;
    target: SiteTarget;
    cacheDir: string | undefined;
    assets: ClientAssets;
    catalogs: Record<string, Catalog>;
    displayFontUrl: string | undefined;
    blog: BlogBuild | undefined;
}

async function buildAppSite(build: Build): Promise<SiteBuildResult> {
    const { options, target, cacheDir, assets, catalogs, displayFontUrl, blog } = build;
    const data = await loadSiteData({
        root: target.root,
        screenshotCacheDir: join(cacheDir ?? defaultCacheDir(target.root), 'screenshots'),
        offline: options.offline ?? false,
        githubToken: options.githubToken,
        network: cacheDir ? { cacheDir: join(cacheDir, 'http') } : {},
        warn: options.warn,
    });

    const images = await processScreenshots(data, target, cacheDir ?? defaultCacheDir(target.root));
    const iconUrl = await publishIcon(data, target);

    const iconHref = await iconDataUri(data, target);
    const { light = '#84bbfd' } = data.app.branding;
    const card = { background: light, foreground: readableText(light), iconHref };
    const hasSupport = data.config.support.length > 0;
    const privacyStatements = data.config.privacy
        ? await loadPrivacyStatements(data.config.privacy, target.root)
        : undefined;
    const legalNoticeStatements = data.config.legalNotice
        ? await loadLegalNoticeStatements(data.config.legalNotice, target.root)
        : undefined;
    const contextFor = (lang: string): RenderContext => ({
        data,
        lang,
        t: translator(catalogs[lang]),
        assets,
        images,
        iconUrl,
        displayFontUrl,
        ogImage: `${data.config.base}og-${lang}.png`,
    });
    for (const lang of data.config.languages) {
        const ctx = contextFor(lang);
        if (blog) ctx.latestPosts = latestPostsSection(appShell(ctx), blog.posts);
        const meta = pageMeta(ctx);
        for (const warning of seoWarnings({ lang, ...meta })) options.warn?.(warning);
        const summary = localized(data.app.summary, lang);
        await writeFile(join(target.out, `og-${lang}.png`), svgToPng(ogCardSvg({ ...card, name: meta.name, summary })));
        await writePage(target.out, `${lang}/index.html`, renderPage(ctx));
        if (hasSupport) await writePage(target.out, `${lang}/support/index.html`, renderSupportPage(ctx));
        if (privacyStatements) {
            await writePage(target.out, `${lang}/privacy/index.html`, renderPrivacyPage(ctx, privacyStatements[lang]!));
        }
        if (legalNoticeStatements) {
            await writePage(
                target.out,
                `${lang}/legal-notice/index.html`,
                renderLegalNoticePage(ctx, legalNoticeStatements[lang]!),
            );
        }
    }
    const manifest = buildAppManifest(data, iconUrl ? absolute(data, iconUrl) : undefined);
    await writeFile(join(target.out, APP_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(target.out, 'index.html'), renderRoot(data, assets, iconUrl));
    const address = (build: (data: SiteData, lang: string) => string) =>
        Object.fromEntries(data.config.languages.map((lang) => [lang, absolute(data, build(data, lang))]));
    const pages: SitemapPage[] = [
        address(pageUrl),
        ...(hasSupport ? [address(supportUrl)] : []),
        ...(privacyStatements ? [address(privacyUrl)] : []),
        ...(legalNoticeStatements ? [address(legalNoticeUrl)] : []),
    ];
    if (blog) {
        const developer = data.app.developer.name;
        pages.push(
            ...(await writeBlog(data.config, target.out, {
                blog,
                shell: (lang) => appShell({ ...contextFor(lang), current: 'blog' }),
                author: { name: developer || localized(data.app.name, data.config.defaultLanguage) },
                card,
                iconUrl,
                ogImage: (lang) => `${data.config.base}og-${lang}.png`,
            })),
        );
    }
    await Promise.all(writeSitemap(data.config, target.out, pages, data.config.relatedApps));
    return { languages: [...data.config.languages], screenshots: images.size };
}

const HTTP_URL = /^https?:\/\//;

/** `basics.image`: a URL is used as it is, a repository file is published under `assets/`. */
async function publishAvatar(data: DeveloperData, target: SiteTarget): Promise<string | undefined> {
    const image = data.resumes[data.config.defaultLanguage]?.basics.image;
    if (!image) return undefined;
    return HTTP_URL.test(image) ? image : publishHashed(resolve(target.root, image), target.out, data.config.base);
}

async function avatarDataUri(data: DeveloperData, { root }: SiteTarget): Promise<string | undefined> {
    const image = data.resumes[data.config.defaultLanguage]?.basics.image;
    if (!image || HTTP_URL.test(image)) return undefined;
    const type = ICON_TYPES[extname(image).toLowerCase()];
    if (!type) return undefined;
    return `data:${type};base64,${(await readFile(resolve(root, image))).toString('base64')}`;
}

async function buildDeveloperSite(config: DeveloperSiteConfig, build: Build): Promise<SiteBuildResult> {
    const { options, target, cacheDir, assets, catalogs, displayFontUrl, blog } = build;
    const data = await loadDeveloperData(config, {
        root: target.root,
        offline: options.offline ?? false,
        network: cacheDir ? { cacheDir: join(cacheDir, 'http') } : {},
        warn: options.warn,
    });
    const avatarUrl = await publishAvatar(data, target);
    const background = config.theme.accent?.light ?? '#84bbfd';
    const card = { background, foreground: readableText(background), iconHref: await avatarDataUri(data, target) };
    const privacyStatements = config.privacy ? await loadPrivacyStatements(config.privacy, target.root) : undefined;
    const legalNoticeStatements = config.legalNotice
        ? await loadLegalNoticeStatements(config.legalNotice, target.root)
        : undefined;
    const contextFor = (lang: string): DeveloperContext => ({
        data,
        lang,
        t: translator(catalogs[lang]),
        assets,
        avatarUrl,
        displayFontUrl,
        ogImage: `${config.base}og-${lang}.png`,
    });
    for (const lang of config.languages) {
        const ctx = contextFor(lang);
        const { basics } = data.resumes[lang]!;
        await writeFile(
            join(target.out, `og-${lang}.png`),
            svgToPng(ogCardSvg({ ...card, name: basics.name, summary: basics.label ?? '' })),
        );
        const latest = blog ? latestPostsSection(developerShell(ctx), blog.posts) : '';
        await writePage(target.out, `${lang}/index.html`, renderDeveloperHome(ctx, latest));
        await writePage(target.out, `${lang}/cv/index.html`, renderCv(ctx));
        if (config.support.length > 0) {
            await writePage(target.out, `${lang}/support/index.html`, renderDeveloperSupportPage(ctx));
        }
        if (privacyStatements) {
            await writePage(
                target.out,
                `${lang}/privacy/index.html`,
                renderDeveloperPrivacyPage(ctx, privacyStatements[lang]!),
            );
        }
        if (legalNoticeStatements) {
            await writePage(
                target.out,
                `${lang}/legal-notice/index.html`,
                renderDeveloperLegalNoticePage(ctx, legalNoticeStatements[lang]!),
            );
        }
    }
    const name = data.resumes[config.defaultLanguage]!.basics.name;
    await writeFile(join(target.out, 'index.html'), rootPage(config, name, assets, avatarUrl));
    const address = (view: DeveloperView) =>
        Object.fromEntries(
            config.languages.map((lang) => [lang, absoluteUrl(config, developerPageUrl({ data }, lang, view))]),
        );
    const pages: SitemapPage[] = [
        address('home'),
        address('cv'),
        ...(config.support.length > 0 ? [address('support')] : []),
        ...(privacyStatements ? [address('privacy')] : []),
        ...(legalNoticeStatements ? [address('legal-notice')] : []),
    ];
    if (blog) {
        const author = data.resumes[config.defaultLanguage]!.basics;
        pages.push(
            ...(await writeBlog(config, target.out, {
                blog,
                shell: (lang) => developerShell(contextFor(lang), 'blog'),
                author: {
                    name: author.name,
                    uri: absoluteUrl(config, developerPageUrl({ data }, config.defaultLanguage, 'home')),
                },
                card,
                iconUrl: avatarUrl,
                ogImage: (lang) => `${config.base}og-${lang}.png`,
            })),
        );
    }
    await Promise.all(writeSitemap(config, target.out, pages, config.developer.apps));
    return { languages: [...config.languages], screenshots: 0 };
}

export interface SiteI18nOptions {
    /**
     * The repository whose `gjsify.site` strings are synced into its `pageTranslations`. Omitted,
     * this package's own `po/` is synced from the renderer sources instead.
     */
    root?: string;
    /** Report what a regeneration would change instead of writing it. */
    check?: boolean;
    /** This package's install, for a caller whose module URL does not reveal it — a bundle. */
    packageDir?: string;
}

/** The languages this package keeps a catalogue for: whichever `po/<lang>.po` files exist. */
async function packageLanguages(dir: string): Promise<string[]> {
    const files = await readdir(dir);
    return files.filter((file) => file.endsWith('.po')).map((file) => basename(file, '.po'));
}

/**
 * Keeps gettext catalogues in sync with the strings that can actually be emitted — this package's
 * own `po/` when called without a root, otherwise the consumer's `pageTranslations`.
 */
export async function syncSiteI18n(options: SiteI18nOptions = {}): Promise<I18nResult> {
    const check = options.check ?? false;
    const self = selfDir(options.packageDir);
    if (options.root === undefined) {
        const renderers = rendererDir(self);
        if (!existsSync(renderers)) {
            throw new Error(`${renderers} does not exist: the package catalogue is synced from a source checkout`);
        }
        return syncCatalogs({
            dir: poDir(self),
            languages: await packageLanguages(poDir(self)),
            msgids: await rendererMsgids(renderers),
            check,
            pot: true,
            base: self,
        });
    }

    const root = resolve(options.root);
    const config = await readConfig(root);
    const shipped = await catalogMsgids(join(poDir(self), 'site.pot'));
    const msgids = configMsgids(config).filter((msgid) => !shipped.has(msgid));
    if (msgids.length === 0) return { stale: [], untranslated: [] };
    if (!config.pageTranslations) {
        throw new Error(
            `gjsify.site introduces ${msgids.length} string(s) of its own, e.g. "${msgids[0]}". ` +
                'Set gjsify.site.pageTranslations to the directory their catalogues should live in.',
        );
    }

    const dir = resolve(root, config.pageTranslations);
    if (!check) await mkdir(dir, { recursive: true });
    return syncCatalogs({ dir, languages: config.languages, msgids, check, base: root });
}
