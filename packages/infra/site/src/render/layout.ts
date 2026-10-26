/**
 * The frame every page kind shares: `<head>`, the top bar and the footer. App pages, blog pages and
 * developer pages all render through it, so a fix to the head or the footer lands on all of them
 * (ADR 0120 §6). What differs between the kinds is the `Shell` they build; what differs between two
 * pages of one site is their `PageMeta`.
 */
import type { SiteCommonConfig } from '../site-data/index.js';
import { readableText } from './color.js';
import { esc, plain } from './html.js';
import { icon, type IconName } from './icons.js';
import { OG_HEIGHT, OG_WIDTH } from './og-card.js';
import { ogLocale } from './seo.js';

export type Translate = (msgid: string) => string;

export interface ClientAssets {
    js: string;
    css: string[];
}

/** A link in the top bar next to the language switch. */
export interface NavLink {
    href: string;
    label: string;
    glyph: IconName;
    /** The page being rendered is this link's target or below it. */
    current?: boolean;
}

/** What stays the same on every page of one site in one language. */
export interface Shell {
    config: SiteCommonConfig;
    lang: string;
    t: Translate;
    assets: ClientAssets;
    /** The site's name: the bar brand and `og:site_name`. */
    name: string;
    /** Root-relative address the brand links to. */
    home: string;
    /** Published URL of the icon: bar brand, favicon. */
    iconUrl?: string;
    /** Paints the masthead and the bar; `undefined` keeps the stylesheet's palette. */
    branding: { light?: string; dark?: string };
    repository?: string;
    /** Translated footer sentences about licences. */
    licenses: readonly string[];
    nav: readonly NavLink[];
    /** Atom feeds announced in `<head>` of every page. */
    feeds: ReadonlyArray<{ title: string; href: string }>;
    /** Root-relative URL of the content-hashed `theme.displayFont`. */
    displayFontUrl?: string;
}

/** What makes one page different from its siblings. */
export interface PageMeta {
    title: string;
    description: string;
    /** Root-relative address of this page in every language it exists in, including the shell's. */
    urls: Readonly<Record<string, string>>;
    /** Where the language switch leads for a language this page has no translation in. */
    fallback?: (lang: string) => string;
    ogType?: 'website' | 'article' | 'profile';
    /** Root-relative URL of the link-preview card. */
    ogImage?: string;
    /** Further `<meta property>` pairs, e.g. `article:published_time`. */
    meta?: ReadonlyArray<[string, string]>;
    /** Ready `<script type="application/ld+json">` markup. */
    jsonLd?: string;
}

/** `/<lang>/` under the site's base, plus an optional sub path such as `privacy/`. */
export function sitePageUrl(config: Pick<SiteCommonConfig, 'base'>, lang: string, path = ''): string {
    return `${config.base}${lang}/${path}`;
}

export function absoluteUrl(config: Pick<SiteCommonConfig, 'url'>, rootRelative: string): string {
    return new URL(rootRelative.replace(/^\//, ''), `${new URL(config.url).origin}/`).href;
}

export function languageName(code: string): string {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
}

function switchUrl(shell: Shell, page: PageMeta, code: string): string {
    return page.urls[code] ?? page.fallback?.(code) ?? sitePageUrl(shell.config, code);
}

export function languageSwitch(shell: Shell, page: PageMeta, className: string, style: 'code' | 'name'): string {
    const { config, lang, t } = shell;
    const items = config.languages.map((code) => {
        const label = style === 'code' ? code.toUpperCase() : languageName(code);
        // Only a real translation is the same page in another language; a fallback is not.
        const hreflang = page.urls[code] ? ` hreflang="${esc(code)}"` : '';
        return code === lang
            ? `<li><span aria-current="true">${esc(label)}</span></li>`
            : `<li><a href="${esc(switchUrl(shell, page, code))}"${hreflang} lang="${esc(code)}">${esc(label)}</a></li>`;
    });
    return `<nav class="${className}" aria-label="${esc(t('Language'))}"><ul>${items.join('')}</ul></nav>`;
}

/**
 * The theme as inline CSS: accent and display font as custom properties the stylesheet reads, and
 * nearest-neighbour scaling for pixel art. Empty without a theme, so the default look is untouched.
 */
function themeStyle(shell: Shell): string {
    const { theme } = shell.config;
    const { light, dark } = shell.branding;
    const vars = [
        light ? `--brand-light:${light};--band-fg-light:${readableText(light)}` : '',
        dark ? `--brand-dark:${dark};--band-fg-dark:${readableText(dark)}` : '',
        theme.accent
            ? `--accent-light:${theme.accent.light};--accent-dark:${theme.accent.dark};--accent-fg-light:${readableText(theme.accent.light)};--accent-fg-dark:${readableText(theme.accent.dark)}`
            : '',
        shell.displayFontUrl ? '--display-font:"Site Display"' : '',
    ]
        .filter(Boolean)
        .join(';');
    const rules = [
        shell.displayFontUrl
            ? `@font-face{font-family:"Site Display";src:url(${JSON.stringify(shell.displayFontUrl)}) format("woff2");font-display:swap}`
            : '',
        vars ? `:root{${vars}}` : '',
        theme.imageRendering === 'pixelated' ? 'img{image-rendering:pixelated}' : '',
    ].join('');
    return rules ? `<style>${rules}</style>` : '';
}

export function documentHead(shell: Shell, page: PageMeta): string {
    const { config, lang, name } = shell;
    const { title, description } = page;
    const url = absoluteUrl(config, page.urls[lang] ?? sitePageUrl(config, lang));
    const ogImage = page.ogImage ? absoluteUrl(config, page.ogImage) : undefined;
    const languages = config.languages.filter((code) => page.urls[code] !== undefined);
    const alternates = languages.map(
        (code) => `<link rel="alternate" hreflang="${esc(code)}" href="${esc(absoluteUrl(config, page.urls[code]!))}">`,
    );
    const xDefault = page.urls[config.defaultLanguage];
    const meta: Array<[string, string]> = [
        ['og:type', page.ogType ?? 'website'],
        ['og:title', title],
        ['og:description', description],
        ['og:url', url],
        ['og:site_name', name],
        ['og:locale', ogLocale(lang)],
        ...languages
            .filter((code) => code !== lang)
            .map((code): [string, string] => ['og:locale:alternate', ogLocale(code)]),
    ];
    if (ogImage) {
        meta.push(
            ['og:image', ogImage],
            ['og:image:width', String(OG_WIDTH)],
            ['og:image:height', String(OG_HEIGHT)],
            ['og:image:alt', title],
        );
    }
    meta.push(...(page.meta ?? []));
    const { light, dark } = shell.branding;
    return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
${alternates.join('\n')}
${xDefault ? `<link rel="alternate" hreflang="x-default" href="${esc(absoluteUrl(config, xDefault))}">` : ''}
${meta.map(([property, content]) => `<meta property="${property}" content="${esc(content)}">`).join('\n')}
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}">` : ''}
<meta name="theme-color" content="${esc(light ?? '#ffffff')}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${esc(dark ?? '#1e1e1e')}" media="(prefers-color-scheme: dark)">
${shell.iconUrl ? `<link rel="icon"${shell.iconUrl.endsWith('.svg') ? ' type="image/svg+xml"' : ''} href="${esc(shell.iconUrl)}">` : ''}
${shell.feeds.map((feed) => `<link rel="alternate" type="application/atom+xml" title="${esc(feed.title)}" href="${esc(feed.href)}">`).join('\n')}
${page.jsonLd ?? ''}
${themeStyle(shell)}
${shell.assets.css.map((href) => `<link rel="stylesheet" href="${esc(href)}">`).join('\n')}
<script type="module" src="${esc(shell.assets.js)}"></script>`;
}

function onGitHub(url: string): boolean {
    return /(^|\.)github\.com$/.test(new URL(url).host);
}

export function topBar(shell: Shell, page: PageMeta): string {
    const { t, repository } = shell;
    const nav = shell.nav.map(
        (link) =>
            `<a class="bar-link" href="${esc(link.href)}"${link.current ? ' aria-current="page"' : ''}>${icon(link.glyph)}<span>${esc(link.label)}</span></a>`,
    );
    return `<div class="topbar">
<div class="bar-inner">
<a class="bar-brand" href="${esc(shell.home)}">
${shell.iconUrl ? `<img src="${esc(shell.iconUrl)}" alt="" width="24" height="24">` : ''}
<span>${esc(shell.name)}</span>
</a>
<div class="bar-end">
${nav.join('\n')}
${languageSwitch(shell, page, 'bar-languages', 'code')}
${repository ? `<a class="bar-link" href="${esc(repository)}">${icon('code')}<span>${onGitHub(repository) ? 'GitHub' : esc(t('Source code'))}</span></a>` : ''}
</div>
</div>
</div>`;
}

export function footer(shell: Shell, page: PageMeta): string {
    const { config, lang, t, repository } = shell;
    // The privacy and legal-notice links are derived, never configured: a consumer with a
    // `gjsify.site.privacy`/`legalNotice` block gets the link on every page without also listing
    // it in `legal`, which would be a second place for the two to disagree.
    const legal = [
        ...(config.legalNotice
            ? [`<li><a href="${esc(sitePageUrl(config, lang, 'legal-notice/'))}">${esc(t('Legal Notice'))}</a></li>`]
            : []),
        ...(config.privacy
            ? [`<li><a href="${esc(sitePageUrl(config, lang, 'privacy/'))}">${esc(t('Privacy'))}</a></li>`]
            : []),
        ...config.legal.map((link) => `<li><a href="${esc(link.url)}">${esc(link.label)}</a></li>`),
    ].join('');
    return `<footer class="footer">
<div class="footer-inner">
${languageSwitch(shell, page, 'footer-languages', 'name')}
${repository ? `<p class="footer-source"><a href="${esc(repository)}">${icon('code')}<span>${esc(t('Source code'))}</span></a></p>` : ''}
${shell.licenses.length > 0 ? `<p class="footer-license">${shell.licenses.map(esc).join(' ')}</p>` : ''}
<p class="footer-made"><a href="https://github.com/gjsify/gjsify">${esc(plain(t('Made with {project}'), { project: 'gjsify' }))}</a></p>
${legal ? `<ul class="footer-legal">${legal}</ul>` : ''}
</div>
</footer>`;
}

/** A whole document: head, bar, the page's own markup, footer. */
export function documentPage(shell: Shell, page: PageMeta, body: string, bodyClass?: string): string {
    return `<!doctype html>
<html lang="${esc(shell.lang)}">
<head>
${documentHead(shell, page)}
</head>
<body${bodyClass ? ` class="${esc(bodyClass)}"` : ''}>
${topBar(shell, page)}
${body}
${footer(shell, page)}
</body>
</html>
`;
}

/** The small masthead of a secondary page: the site's icon, a heading and who it belongs to. */
export function pageMasthead(shell: Pick<Shell, 'iconUrl'>, heading: string, byline?: string): string {
    return `<header class="masthead">
<div class="hero-inner">
${shell.iconUrl ? `<div class="hero-icon" style="--icon-url:url(${esc(shell.iconUrl)})"><img src="${esc(shell.iconUrl)}" alt="" width="128" height="128"></div>` : ''}
<div class="hero-text">
<h1>${esc(heading)}</h1>
${byline ? `<p class="hero-by">${esc(byline)}</p>` : ''}
</div>
</div>
</header>`;
}

/** A text page — support, privacy, legal notice, a blog post — in one column under a small masthead. */
export function simplePage(
    shell: Shell,
    page: PageMeta,
    options: {
        heading: string;
        byline?: string;
        columnClass?: string;
        body: string;
        back?: { href: string; label: string };
    },
): string {
    const back = options.back
        ? `\n<p class="support-back"><a href="${esc(options.back.href)}">${options.back.label}</a></p>`
        : '';
    return documentPage(
        shell,
        page,
        `${pageMasthead(shell, options.heading, options.byline)}
<main>
<div class="column${options.columnClass ? ` ${options.columnClass}` : ''}">
${options.body}${back}
</div>
</main>`,
    );
}

/** The root page: a script picks the visitor's language, the link list is what everyone else (and every crawler) sees. */
export function rootPage(
    config: Pick<SiteCommonConfig, 'base' | 'url' | 'languages' | 'defaultLanguage'>,
    name: string,
    assets: ClientAssets,
    iconUrl: string | undefined,
): string {
    const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
    const choose = `var l=${json(config.languages)},d=${json(config.defaultLanguage)},p=(navigator.languages||[navigator.language]).map(function(x){return String(x).toLowerCase()}),c=d;for(var i=0;i<p.length;i++){var m=l.filter(function(x){return p[i]===x.toLowerCase()||p[i].split("-")[0]===x.toLowerCase()})[0];if(m){c=m;break}}location.replace(${json(config.base)}+c+"/")`;
    const home = (code: string) => sitePageUrl(config, code);
    const alternates = config.languages.map(
        (code) => `<link rel="alternate" hreflang="${esc(code)}" href="${esc(absoluteUrl(config, home(code)))}">`,
    );
    return `<!doctype html>
<html lang="${esc(config.defaultLanguage)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<link rel="canonical" href="${esc(absoluteUrl(config, home(config.defaultLanguage)))}">
${alternates.join('\n')}
<link rel="alternate" hreflang="x-default" href="${esc(absoluteUrl(config, home(config.defaultLanguage)))}">
${iconUrl ? `<link rel="icon"${iconUrl.endsWith('.svg') ? ' type="image/svg+xml"' : ''} href="${esc(iconUrl)}">` : ''}
${assets.css.map((href) => `<link rel="stylesheet" href="${esc(href)}">`).join('\n')}
<script>${choose}</script>
</head>
<body class="root">
<main>
<h1>${esc(name)}</h1>
<ul class="languages-list">${config.languages.map((code) => `<li><a href="${esc(home(code))}" hreflang="${esc(code)}" lang="${esc(code)}">${esc(languageName(code))}</a></li>`).join('')}</ul>
</main>
</body>
</html>
`;
}
