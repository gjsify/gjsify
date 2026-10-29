import {
    epcPayload,
    formatIban,
    isBrowserPlatform,
    needsOpenAnywayHint,
    PLATFORM_ORDER,
    pickByLanguage,
    relatedText,
    relatedUrl,
    type DescriptionBlock,
    type DownloadTarget,
    type Localized,
    type RelatedApp,
    type Release,
    type Screenshot,
    type SiteData,
    type SiteSupportEntry,
    type SiteSupportSepa,
    type TargetPlatform,
} from '../site-data/index.js';
import { blogFeedUrl, blogIndexUrl } from './blog.js';
import { attrs, esc, fmt, plain } from './html.js';
import { icon, type IconName } from './icons.js';
import {
    absoluteUrl,
    documentPage,
    githubUrl,
    rootPage,
    simplePage,
    sitePageUrl,
    type ClientAssets,
    type PageMeta,
    type Shell,
    type Translate,
} from './layout.js';
import { renderMarkdown } from './markdown.js';
import { qrSvg } from './qr.js';
import { metaDescription, pageTitle, softwareApplicationJsonLd } from './seo.js';
import type { ImageFormat, ProcessedImage } from './images.js';

export interface RenderContext {
    data: SiteData;
    lang: string;
    t: (msgid: string) => string;
    assets: ClientAssets;
    /** Processed renditions keyed by a screenshot's slug. */
    images: ReadonlyMap<string, ProcessedImage>;
    /** Published URL of the app icon, when there is one. */
    iconUrl?: string;
    /** Which page of the app this renders; the language switch and the head follow it. Default `app`. */
    view?: 'app' | 'support' | 'privacy' | 'legal-notice';
    /** Root-relative URL of the link-preview card for this language. */
    ogImage?: string;
    /** The blog's latest posts in this language, rendered; only the landing page shows them. */
    latestPosts?: string;
    /** Root-relative URL of the published `theme.displayFont`. */
    displayFontUrl?: string;
}

/** What the download dialog reads: the targets, the catalogue and the locale it formats sizes in. */
export type DownloadContext = Pick<RenderContext, 'data' | 't' | 'lang'>;

const FORMAT_TYPES: Record<ImageFormat, string> = { avif: 'image/avif', webp: 'image/webp', png: 'image/png' };

type LinkKey =
    | 'homepage'
    | 'help'
    | 'faq'
    | 'vcsBrowser'
    | 'bugtracker'
    | 'contribute'
    | 'translate'
    | 'contact'
    | 'donation';

const LINKS: Array<[key: LinkKey, label: (t: Translate) => string, glyph: IconName]> = [
    ['homepage', (t) => t('Website'), 'web'],
    ['help', (t) => t('Help'), 'help'],
    ['faq', (t) => t('FAQ'), 'help'],
    ['vcsBrowser', (t) => t('Source code'), 'code'],
    ['bugtracker', (t) => t('Report an issue'), 'bug'],
    ['contribute', (t) => t('Contribute'), 'people'],
    ['translate', (t) => t('Help translate'), 'translate'],
    ['contact', (t) => t('Contact'), 'mail'],
    ['donation', (t) => t('Support'), 'heart'],
];

const PLATFORM_ICONS: Record<TargetPlatform, IconName> = {
    linux: 'linux',
    darwin: 'macos',
    win32: 'windows',
    android: 'android',
    web: 'web',
    firefox: 'firefox',
    chromium: 'chromium',
};

export function localized(text: Localized, lang: string): string {
    return pickByLanguage(text.byLanguage, lang) ?? text.source;
}

export function pageUrl(data: SiteData, lang: string): string {
    return `${data.config.base}${lang}/`;
}

export function absolute(data: SiteData, rootRelative: string): string {
    return absoluteUrl(data.config, rootRelative);
}

/**
 * A link into this site's own `/<lang>/…` pages, moved to the language being rendered; any other
 * address is returned as it came. Apps put e.g. their English support page in the metainfo.
 */
export function localizeOwnUrl(data: SiteData, url: string, lang: string): string {
    const own = `${data.config.url.replace(/\/+$/, '')}/`;
    if (!url.startsWith(own)) return url;
    const rest = url.slice(own.length);
    const segment = /^[^/?#]*/.exec(rest)![0];
    if (!data.config.languages.includes(segment)) return url;
    return `${own}${lang}${rest.slice(segment.length)}`;
}

export function supportUrl(data: SiteData, lang: string): string {
    return `${pageUrl(data, lang)}support/`;
}

export function privacyUrl(data: SiteData, lang: string): string {
    return `${pageUrl(data, lang)}privacy/`;
}

export function legalNoticeUrl(data: SiteData, lang: string): string {
    return `${pageUrl(data, lang)}legal-notice/`;
}

/** The transfer reference when the config sets none: one per app, so the bank statement says what it was for. */
export function supportReference(data: SiteData): string {
    return `Support ${data.app.name.source}`;
}

function blocks(content: DescriptionBlock[], lang: string): string {
    return content
        .map((block) =>
            block.type === 'paragraph'
                ? `<p>${esc(localized(block.text, lang))}</p>`
                : `<ul>${block.items.map((item) => `<li>${esc(localized(item, lang))}</li>`).join('')}</ul>`,
        )
        .join('\n');
}

function osName(os: TargetPlatform, t: Translate): string {
    return {
        linux: t('Linux'),
        darwin: t('macOS'),
        win32: t('Windows'),
        android: t('Android'),
        web: t('Web'),
        firefox: t('Firefox'),
        chromium: t('Chromium'),
    }[os];
}

/**
 * How to get past the OS's warning for a download without the signature it wants (ADR 0124). The
 * wording follows each system's own button labels, which is what the visitor has to find.
 */
function openAnywayHint(os: TargetPlatform, t: Translate): string | undefined {
    if (os === 'darwin') {
        return t(
            'macOS asks before opening an app Apple has not checked. Try to open it once, then choose System Settings → Privacy & Security → Open Anyway.',
        );
    }
    if (os === 'win32') {
        return t('Windows may warn about an unknown publisher. Choose More info → Run anyway.');
    }
    return undefined;
}

/** The short form beside the target itself; the group's note says what to do about it. */
function unsignedMark(os: TargetPlatform, t: Translate): string {
    return os === 'darwin' ? t('Not notarized') : t('Unsigned');
}

function sizeLabel(bytes: number | undefined, lang: string): string {
    if (!bytes) return '';
    return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
}

/** The second line of a link card: the address without the noise a reader does not need. */
function prettyUrl(url: string): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return url;
    }
    if (parsed.protocol === 'mailto:') return parsed.pathname;
    const host = parsed.host.replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/$/, '');
    return `${host}${path}`;
}

/**
 * What the primary button says. Installing from a store, opening the web build and downloading a
 * file are three different promises, so each gets its own wording.
 */
export function ctaLabel(target: DownloadTarget, t: Translate): string {
    if (target.format === 'flathub') return t('Install from Flathub');
    if (target.format === 'source') return t('Build from source');
    if (target.os === 'web' && target.format === 'web') return t('Try in browser');
    if (isBrowserPlatform(target.os)) {
        return plain(target.format === 'store' ? t('Add to {browser}') : t('Install for {browser}'), {
            browser: osName(target.os, t),
        });
    }
    return plain(t('Download for {os}'), { os: osName(target.os, t) });
}

function srcset(files: Array<{ url: string; width: number }>): string {
    return files.map((file) => `${file.url} ${file.width}w`).join(', ');
}

/**
 * What the browser is told the screenshot will occupy. Capped at the display width the renditions
 * were cut for, so a wide viewport asks for the 1× file and a HiDPI one for the 2× — never more.
 */
function sizes(image: ProcessedImage): string {
    return `(max-width: 600px) 92vw, min(86vw, ${image.displayWidth}px)`;
}

/** What a phone shows for this screenshot: portrait artwork needs a taller track than a landscape window. */
function portraitOnPhone(ctx: RenderContext, screenshot: Screenshot): boolean {
    const image = ctx.images.get(screenshot.slug);
    return image !== undefined && image.height > image.width * 1.1;
}

function picture(ctx: RenderContext, screenshot: Screenshot, alt: string, eager: boolean): string {
    const image = ctx.images.get(screenshot.slug)!;
    const shared = { sizes: sizes(image), width: image.width, height: image.height };
    const sources = (['avif', 'webp'] as const).map(
        (format) =>
            `<source${attrs({ type: FORMAT_TYPES[format], srcset: srcset(image.formats[format]), ...shared })}>`,
    );
    const png = image.formats.png;
    const img = `<img${attrs({
        src: png[png.length - 1]!.url,
        srcset: srcset(png),
        ...shared,
        alt,
        loading: eager ? undefined : 'lazy',
        decoding: 'async',
    })}>`;
    return `<picture${attrs({ 'data-frame': frameAttribute(ctx, screenshot), style: `--shot-w:${image.displayWidth}px` })}>${[...sources, img].join('')}</picture>`;
}

/** A window shot brings its own shadow; ours would draw a second one around it. */
export function frameAttribute(ctx: Pick<RenderContext, 'images'>, screenshot: Screenshot): 'none' | undefined {
    return ctx.images.get(screenshot.slug)?.frameless === true ? 'none' : undefined;
}

/** The screenshots, at the bottom of the brand-coloured masthead. */
function screenshotBand(ctx: RenderContext): string {
    if (ctx.data.screenshots.length === 0) return '';
    const { t, lang } = ctx;
    const slides = ctx.data.screenshots.map((screenshot, index) => {
        const caption = screenshot.caption ? localized(screenshot.caption, lang) : '';
        const alt = caption || plain(t('Screenshot {number}'), { number: index + 1 });
        const label = plain(t('{number} of {total}'), { number: index + 1, total: ctx.data.screenshots.length });
        return `<li${attrs({ class: 'slide', 'data-portrait': portraitOnPhone(ctx, screenshot) })} role="group" aria-roledescription="${esc(t('slide'))}" aria-label="${esc(label)}">
<figure>
${picture(ctx, screenshot, alt, index === 0)}
${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}
<button class="slide-expand" type="button" aria-label="${esc(t('View full screen'))}" hidden>${icon('expand')}</button>
</figure>
</li>`;
    });
    // The controls carry translated labels, so they are rendered here and only unhidden by the component.
    const dots = ctx.data.screenshots.map(
        (_screenshot, index) =>
            `<li><button class="carousel-dot" type="button" aria-label="${esc(plain(t('Screenshot {number}'), { number: index + 1 }))}"></button></li>`,
    );
    return `<section class="band" aria-label="${esc(t('Screenshots'))}">
<screenshot-carousel${attrs({ class: 'carousel', 'data-portrait': ctx.data.screenshots.some((screenshot) => portraitOnPhone(ctx, screenshot)) })} role="group" aria-roledescription="${esc(t('carousel'))}" aria-label="${esc(t('Screenshots'))}">
<button class="carousel-arrow carousel-prev" type="button" aria-label="${esc(t('Previous screenshot'))}" hidden>${icon('chevron-left')}</button>
<ul class="carousel-track" aria-label="${esc(t('Screenshots'))}">
${slides.join('\n')}
</ul>
<button class="carousel-arrow carousel-next" type="button" aria-label="${esc(t('Next screenshot'))}" hidden>${icon('chevron-right')}</button>
<ol class="carousel-dots" hidden>${dots.join('')}</ol>
<dialog class="lightbox" aria-label="${esc(t('Screenshots'))}">
<button class="dialog-close" type="button" aria-label="${esc(t('Close'))}" hidden>${icon('close')}</button>
<figure></figure>
</dialog>
</screenshot-carousel>
</section>`;
}

/** The build the page offers before any browser detection: a store install if there is one. */
function defaultTarget(targets: readonly DownloadTarget[]): DownloadTarget | undefined {
    const available = targets.filter((target) => target.available);
    return (
        available.find((target) => target.recommended && target.os === 'linux') ??
        available.find((target) => target.recommended) ??
        available[0]
    );
}

/**
 * The targets of the part a person installs FIRST, which is the one the primary button offers. A
 * product declaring no components has exactly one part, so the whole list is that part.
 */
function primaryTargets(data: SiteData): readonly DownloadTarget[] {
    const first = data.config.components[0];
    if (!first) return data.downloads.targets;
    const own = data.downloads.targets.filter((target) => target.component === first.id);
    return own.length > 0 ? own : data.downloads.targets;
}

/**
 * One block of the download dialog: a part of the product with the targets that install it. `id`
 * is empty for a product that declared no components, and for release assets no component claimed —
 * such a block carries no heading, which is what a single-part product has always looked like.
 */
interface ComponentBlock {
    id: string;
    name?: string;
    summary?: string;
    targets: readonly DownloadTarget[];
}

/**
 * The dialog's blocks, in install order. A component nobody built a file for is left out rather
 * than shown empty, so a release that is missing an artefact says so by absence.
 */
function componentBlocks(data: SiteData): ComponentBlock[] {
    const targets = data.downloads.targets;
    const declared = data.config.components;
    if (declared.length === 0) return [{ id: '', targets }];
    const blocks = declared.flatMap((part): ComponentBlock[] => {
        const own = targets.filter((target) => target.component === part.id);
        return own.length > 0 ? [{ id: part.id, name: part.name, summary: part.summary, targets: own }] : [];
    });
    const rest = targets.filter((target) => !declared.some((part) => part.id === target.component));
    return rest.length > 0 ? [...blocks, { id: '', targets: rest }] : blocks;
}

/**
 * One row of the download dialog. The data attributes carry everything the client needs to put a
 * row on the primary button, so it never has to build a translated string itself.
 */
function targetItem(target: DownloadTarget, ctx: DownloadContext): string {
    const { t, lang } = ctx;
    const size = sizeLabel(target.size, lang);
    const unsigned = target.available && needsOpenAnywayHint(target);
    const meta = [
        target.arch === 'noarch' ? '' : target.arch,
        target.recommended ? t('Recommended') : '',
        target.available ? '' : t('Not yet available'),
        unsigned ? unsignedMark(target.os, t) : '',
    ]
        .filter(Boolean)
        .join(' · ');
    const inner = `<span class="target-icon">${icon(target.format === 'flathub' || target.format === 'store' ? 'package' : 'download')}</span>
<span class="target-text"><span class="target-name">${esc(t(target.label))}</span>${meta ? `<span class="target-meta">${esc(meta)}</span>` : ''}</span>
${size ? `<span class="target-size">${esc(size)}</span>` : ''}`;
    return `<li${attrs({
        class: 'target',
        'data-os': target.os,
        'data-arch': target.arch,
        'data-recommended': target.recommended,
        'data-unavailable': !target.available,
        'data-unsigned': unsigned,
        'data-cta': target.available ? ctaLabel(target, t) : undefined,
        'data-size': size || undefined,
    })}>
${target.available ? `<a href="${esc(target.url)}">\n${inner}\n</a>` : `<span class="target-link">\n${inner}\n</span>`}
</li>`;
}

/** A component id as an HTML id fragment; a configuration's own ids are not guaranteed to be safe. */
function blockSlug(block: ComponentBlock, index: number): string {
    const slug = block.id
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return slug || `part-${index + 1}`;
}

/**
 * One part of the product in the dialog: its heading, then one tab per platform it is built for.
 * The tabs live inside the block, so the extension's tabs are browsers while the app's are
 * operating systems — the two parts are picked by different facts about the visitor.
 *
 * `step` numbers the part when there is more than one, because the order they are listed in is the
 * order they have to be installed in.
 */
function componentSection(block: ComponentBlock, slug: string, step: number | undefined, ctx: DownloadContext): string {
    const { t } = ctx;
    const selected = defaultTarget(block.targets)?.os;
    const groups = PLATFORM_ORDER.flatMap((os) => {
        const own = block.targets.filter((target) => target.os === os);
        return own.length > 0 ? [[os, own] as const] : [];
    });
    // A nested block already has a heading of its own, so its platforms are one level deeper.
    const level = block.name ? 'h4' : 'h3';
    const tabs = groups.map(
        ([os]) =>
            `<button class="os-tab" type="button" role="tab" id="os-tab-${esc(slug)}-${esc(os)}" aria-controls="os-group-${esc(slug)}-${esc(os)}" data-os="${esc(os)}" aria-selected="${os === selected}">${icon(PLATFORM_ICONS[os])}<span>${esc(osName(os, t))}</span></button>`,
    );
    const sections = groups.map(
        ([
            os,
            own,
        ]) => `<section class="os-group" id="os-group-${esc(slug)}-${esc(os)}" role="tabpanel" aria-labelledby="os-tab-${esc(slug)}-${esc(os)}" data-os="${esc(os)}">
<${level} class="os-title">${icon(PLATFORM_ICONS[os])}<span>${esc(osName(os, t))}</span></${level}>
<ul>
${own.map((target) => targetItem(target, ctx)).join('\n')}
</ul>
${os === 'darwin' ? `<p class="os-note">${esc(t('Apple Silicon is assumed. Pick the Intel build if your Mac has an Intel processor.'))}</p>` : ''}
${own.some((target) => target.available && needsOpenAnywayHint(target)) ? `<p class="os-note os-note-unsigned">${esc(openAnywayHint(os, t) ?? '')}</p>` : ''}
</section>`,
    );
    const head = block.name
        ? `<div class="component-head">
<h3 class="component-title">${step === undefined ? '' : `<span class="component-step">${esc(String(step))}</span>`}<span>${esc(t(block.name))}</span></h3>
${block.summary ? `<p class="component-summary">${esc(t(block.summary))}</p>` : ''}
</div>`
        : '';
    // An extension's tabs are browsers; naming them "Operating system" would mislead a screen reader.
    const tabsLabel = groups.every(([os]) => isBrowserPlatform(os)) ? t('Browser') : t('Operating system');
    return `<section class="component"${attrs({ 'data-component': block.id || undefined })}>
${head}
<div class="os-tabs" role="tablist" aria-label="${esc(tabsLabel)}" hidden>${tabs.join('')}</div>
<div class="os-groups">
${sections.join('\n')}
</div>
</section>`;
}

/**
 * The split button plus the dialog holding every target. Both are server-rendered: without
 * JavaScript the dialog stays an open panel below the button (see `site.css`), with it the
 * component turns the same markup into a modal and swaps the button for the detected platform.
 *
 * The button offers the part that is installed first; the dialog lists every part in that order,
 * so a product made of an app and the extension it pairs with reads as the two steps it is.
 */
export function downloadWidget(ctx: DownloadContext): string {
    const { data, t } = ctx;
    const primary = defaultTarget(primaryTargets(data));
    if (!primary) {
        // Nothing downloadable yet: point at the releases, or at the source when there are none.
        const [href, label] = data.downloads.hasReleases
            ? [data.downloads.releasesUrl, t('All releases')]
            : [repositoryUrl(data) ?? data.downloads.releasesUrl, t('Source code')];
        return `<div class="download">
<a class="button download-cta" href="${esc(href)}">${icon('download')}<span class="download-label">${esc(label)}</span></a>
</div>`;
    }
    const blocks = componentBlocks(data);
    const named = blocks.filter((block) => block.name).length;
    let step = 0;
    const sections = blocks.map((block, index) =>
        componentSection(block, blockSlug(block, index), block.name && named > 1 ? ++step : undefined, ctx),
    );
    return `<app-download class="download">
<div class="download-split">
<a class="button download-cta" href="${esc(primary.url)}"${attrs({ 'data-os': primary.os, 'data-arch': primary.arch })}>${icon('download')}<span class="download-label">${esc(ctaLabel(primary, t))}</span></a>
<a class="button download-toggle" href="#all-downloads" aria-label="${esc(t('All download options'))}">${icon('chevron-down')}</a>
</div>
<dialog id="all-downloads" class="download-dialog" aria-labelledby="all-downloads-title">
<div class="dialog-head">
<h2 id="all-downloads-title">${esc(t('All download options'))}</h2>
<button class="dialog-close" type="button" aria-label="${esc(t('Close'))}" hidden>${icon('close')}</button>
</div>
<div class="components">
${sections.join('\n')}
</div>
${data.downloads.hasReleases ? `<p class="dialog-foot"><a href="${esc(data.downloads.releasesUrl)}">${esc(t('All releases on GitHub'))}${icon('external', { class: 'link-external' })}</a></p>` : ''}
</dialog>
</app-download>`;
}

interface BadgeSpec {
    /** Drawn in the pill; `pill` wins when a badge needs more than one glyph. */
    glyph?: IconName;
    pill?: string;
    /** Left out when the pill already carries the fact, like the platform glyphs. */
    value?: string;
    label: string;
    /** The unabbreviated fact, when the badge shows a short form of it. */
    title?: string;
    class?: string;
    hidden?: boolean;
}

function badge(spec: BadgeSpec): string {
    // An absent value is not an empty element: the row reserves the line, the DOM stays clean.
    const value = spec.value
        ? `\n<span${attrs({ class: 'badge-value', title: spec.title })}>${esc(spec.value)}</span>`
        : '';
    return `<li${attrs({ class: spec.class ? `badge ${spec.class}` : 'badge', hidden: spec.hidden })}>
<span class="badge-pill">${spec.pill ?? icon(spec.glyph!)}</span>${value}
<span class="badge-label">${esc(spec.label)}</span>
</li>`;
}

/** `GPL-3.0-or-later` is too long for a badge; the full id stays in the title. */
function shortLicense(id: string): string {
    return id.replace(/-or-later$/, '+').replace(/-only$/, '');
}

/**
 * The facts row under the hero. A badge whose fact is missing is left out, not faked, and the row
 * tells CSS how many it ended up with so the columns divide the width evenly.
 */
export function badges(ctx: Pick<RenderContext, 'data' | 't' | 'lang'>): string {
    const { data, t, lang } = ctx;
    const number = new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 });
    const targets = data.downloads.targets;
    const specs: BadgeSpec[] = [];

    // The badge belongs to the primary button, so it reports the part that button offers.
    const primary = defaultTarget(primaryTargets(data));
    if (primary) {
        // Not every target reports a size; the client swaps this one as the reader picks another.
        const size = sizeLabel(primary.size, lang);
        specs.push({ glyph: 'download', value: size, label: t('Download size'), class: 'badge-size', hidden: !size });
    }
    if (data.app.license) {
        const short = shortLicense(data.app.license);
        specs.push({
            glyph: 'license',
            value: short,
            label: t('License'),
            title: short === data.app.license ? undefined : data.app.license,
        });
    }
    const oses = PLATFORM_ORDER.filter((os) => targets.some((target) => target.available && target.os === os));
    if (oses.length > 0) {
        // The class is the hook for the platform's own colour, which the stylesheet reveals on hover.
        const glyphs = oses
            .map((os) => icon(PLATFORM_ICONS[os], { title: osName(os, t), class: `platform platform-${os}` }))
            .join('');
        const label = oses.every(isBrowserPlatform) ? t('Browsers') : t('Platforms');
        specs.push({ pill: `<span class="badge-platforms">${glyphs}</span>`, label });
    }
    if (data.app.ageRating) {
        const { minAge } = data.app.ageRating;
        specs.push({
            glyph: 'people',
            value: minAge === 0 ? t('All ages') : plain(t('{age}+'), { age: minAge }),
            label: t('Age rating'),
        });
    }
    if (data.stats.flathubInstalls !== undefined)
        specs.push({ glyph: 'package', value: number.format(data.stats.flathubInstalls), label: t('Installs') });

    if (specs.length === 0) return '';
    const visible = specs.filter((spec) => !spec.hidden).length;
    const odd = visible % 2 === 1 ? ' data-odd="true"' : '';
    return `<ul class="badges" style="--badge-count:${visible}"${odd}>\n${specs.map(badge).join('\n')}\n</ul>`;
}

function releaseDate(date: string, lang: string): string {
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime())
        ? date
        : new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone: 'UTC' }).format(parsed);
}

function datePill(release: Release, lang: string): string {
    return `<p class="date-pill"><time datetime="${esc(release.date)}">${esc(releaseDate(release.date, lang))}</time></p>`;
}

/**
 * The latest release as a card, older ones folded away. The "show more" button is rendered
 * hidden and the body unclamped: a reader without JavaScript gets the whole text, which a closed
 * `<details>` would have hidden instead.
 */
function releases(ctx: RenderContext): string {
    // A release without notes would render an empty card: it only has a version and a date.
    const [latest, ...older] = ctx.data.releases.filter((release) => release.description.length > 0);
    if (!latest) return '';
    const { t, lang } = ctx;
    return `<section class="releases">
<release-notes class="card release"${attrs({ 'data-more': t('Show more'), 'data-less': t('Show less') })}>
<div class="release-head">
<h2>${fmt(t('Changes in version {version}'), { version: latest.version })}</h2>
${datePill(latest, lang)}
</div>
<div class="release-body">
${blocks(latest.description, lang)}
</div>
<button class="release-more" type="button" hidden>${esc(t('Show more'))}</button>
</release-notes>
${
    older.length > 0
        ? `<details class="card older">
<summary>${esc(t('Older releases'))}${icon('chevron-down', { class: 'summary-chevron' })}</summary>
${older
    .map(
        (release) => `<article class="release-old">
<div class="release-head">
<h3>${fmt(t('Changes in version {version}'), { version: release.version })}</h3>
${datePill(release, lang)}
</div>
${blocks(release.description, lang)}
</article>`,
    )
    .join('\n')}
</details>`
        : ''
}
</section>`;
}

export function linkCard(href: string, title: string, glyph: IconName): string {
    return `<li>
<a href="${esc(href)}">
<span class="link-icon">${icon(glyph)}</span>
<span class="link-text"><span class="link-title">${esc(title)}</span><span class="link-url">${esc(prettyUrl(href))}</span></span>
${icon('external', { class: 'link-external' })}
</a>
</li>`;
}

/** Same address, trailing slash or not. */
function sameUrl(a: string, b: string): boolean {
    return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

function links(ctx: RenderContext): string {
    const { data, lang, t } = ctx;
    const items = LINKS.flatMap(([key, label, glyph]) => {
        const href = data.app.urls[key];
        // No point linking the page the reader is on: the metainfo's homepage is often this site.
        if (!href || (key === 'homepage' && sameUrl(href, data.config.url))) return [];
        return [linkCard(localizeOwnUrl(data, href, lang), label(t), glyph)];
    });
    if (data.config.flathub)
        items.unshift(linkCard(`https://flathub.org/apps/${data.config.flathub}`, 'Flathub', 'package'));
    if (items.length === 0) return '';
    return `<section class="links">
<h2>${esc(t('Links'))}</h2>
<ul class="card-list">
${items.join('\n')}
</ul>
</section>`;
}

/** One app as a card: icon, name, summary. Also the app grid of a developer site. */
export function relatedCard(app: RelatedApp, lang: string): string {
    const summary = relatedText(app.summary, lang);
    const mark = app.icon
        ? `<img class="related-icon" src="${esc(app.icon)}" alt="" width="48" height="48" loading="lazy">`
        : `<span class="related-icon related-icon-blank">${icon('package')}</span>`;
    return `<li>
<a href="${esc(relatedUrl(app, lang))}">
${mark}
<span class="related-text"><span class="related-name">${esc(relatedText(app.name, lang))}</span>${summary ? `<span class="related-summary">${esc(summary)}</span>` : ''}</span>
</a>
</li>`;
}

/** Other apps of the same developer, resolved at build time so the page needs no script. */
export function relatedSection(ctx: Pick<RenderContext, 'data' | 'lang' | 't'>): string {
    const { data, lang, t } = ctx;
    if (data.relatedApps.length === 0) return '';
    const developer = data.app.developer.name;
    const heading = developer ? fmt(t('More apps by {developer}'), { developer }) : esc(t('More apps'));
    return `<section class="related">
<h2>${heading}</h2>
<ul class="related-list">
${data.relatedApps.map((app) => relatedCard(app, lang)).join('\n')}
</ul>
</section>`;
}

/** A bank transfer as a card: the details to read or copy, and an EPC QR code that fills them into a banking app. */
export function sepaCard(entry: SiteSupportSepa, t: Translate): string {
    const grouped = formatIban(entry.iban);
    const row = (label: string, value: string, extra = '') =>
        `<div class="sepa-row"><dt>${esc(label)}</dt><dd>${extra ? `<span class="sepa-value">${esc(value)}</span>${extra}` : esc(value)}</dd></div>`;
    const copy = `<button class="sepa-copy" type="button" data-copy="${esc(entry.iban)}" data-done="${esc(t('Copied'))}" hidden>${icon('copy')}<span>${esc(t('Copy'))}</span></button>`;
    return `<li class="sepa">
<div class="sepa-text">
<h3>${esc(t('Bank transfer'))}</h3>
<dl class="sepa-details">
${row(t('Recipient'), entry.name)}
${row('IBAN', grouped, copy)}
${entry.bic ? row('BIC', entry.bic) : ''}
${entry.reference ? row(t('Reference'), entry.reference) : ''}
</dl>
</div>
<figure class="sepa-qr">
${qrSvg(epcPayload(entry), t('QR code for a bank transfer'))}
<figcaption>${esc(t('Scan with your banking app'))}</figcaption>
</figure>
</li>`;
}

function supportItem(entry: SiteSupportEntry, t: Translate, reference: string): string {
    return entry.kind === 'sepa'
        ? sepaCard({ ...(entry as SiteSupportSepa), reference: (entry as SiteSupportSepa).reference ?? reference }, t)
        : linkCard((entry as { url: string }).url, t(entry.kind), 'heart');
}

/** The landing page only points at the support page: the details live there, readable without a dialog. */
function support(ctx: RenderContext): string {
    const { data, lang, t } = ctx;
    if (data.config.support.length === 0) return '';
    return `<section class="support">
<a class="button support-cta" href="${esc(supportUrl(data, lang))}">${icon('heart')}<span>${esc(t('Support this project'))}</span></a>
</section>`;
}

function tags(ctx: RenderContext): string {
    const { data, t, lang } = ctx;
    const keywords = data.app.keywords.map((keyword) => localized(keyword, lang));
    const arches = [
        ...new Set(data.downloads.targets.map((target) => target.arch).filter((arch) => arch !== 'noarch')),
    ];
    const list = (label: string, values: string[]) =>
        values.length === 0
            ? ''
            : `<div class="tag-group"><h3>${esc(label)}</h3><ul class="tags">${values.map((value) => `<li>${esc(value)}</li>`).join('')}</ul></div>`;
    const body = [
        list(t('Categories'), data.app.categories),
        list(t('Keywords'), keywords),
        list(t('Architectures'), arches),
    ].join('\n');
    return body.trim() ? `<section class="tags-section">\n${body}\n</section>` : '';
}

/**
 * Everything above the text: the icon and name, the install button, the facts row and the
 * screenshots. One element, so the app's brand colour is behind all of it rather than behind the
 * screenshots alone. The bar is its sibling and not its child — a `position: sticky` element
 * cannot outlive its own containing block — but it is painted in the same colour, so it reads as
 * the top of this header and needs no script to tell whether it has detached.
 */
/** "by <developer>" under the app name, linking to the developer's site when one is configured. */
export function heroBy({ data, t }: Pick<RenderContext, 'data' | 't'>): string {
    const developer = data.app.developer.name;
    if (!developer) return '';
    const url = data.config.developerUrl;
    const name = url ? `<a href="${esc(url)}">${esc(developer)}</a>` : esc(developer);
    return `<p class="hero-by">${esc(t('by {developer}')).replace('{developer}', name)}</p>`;
}

function masthead(ctx: RenderContext): string {
    const { data, lang } = ctx;
    return `<header class="masthead">
<div class="hero-inner">
${ctx.iconUrl ? `<div class="hero-icon" style="--icon-url:url(${esc(ctx.iconUrl)})"><img src="${esc(ctx.iconUrl)}" alt="" width="128" height="128"></div>` : ''}
<div class="hero-text">
<h1>${esc(localized(data.app.name, lang))}</h1>
${heroBy(ctx)}
</div>
${downloadWidget(ctx)}
</div>
${badges(ctx)}
${screenshotBand(ctx)}
</header>`;
}

/** The title and description of one page; also what the build checks for weak ones. */
export function pageMeta(
    ctx: Pick<RenderContext, 'data' | 'lang' | 't'>,
    view: 'app' | 'support' | 'privacy' | 'legal-notice' = 'app',
): { name: string; title: string; description: string } {
    const { data, lang, t } = ctx;
    const name = localized(data.app.name, lang);
    if (view === 'support') {
        return {
            name,
            title: `${t('Support')} – ${name}`,
            description: plain(t('{app} is free software. Support its development with a transfer or a service.'), {
                app: name,
            }),
        };
    }
    if (view === 'privacy') {
        return {
            name,
            title: `${t('Privacy')} – ${name}`,
            description: plain(t('What {app} does with data.'), { app: name }),
        };
    }
    if (view === 'legal-notice') {
        return {
            name,
            title: `${t('Legal Notice')} – ${name}`,
            description: plain(t('Who publishes {app}, and how to reach them.'), { app: name }),
        };
    }
    const summary = localized(data.app.summary, lang);
    const first = data.app.description.find((block) => block.type === 'paragraph');
    const paragraph = first?.type === 'paragraph' ? localized(first.text, lang) : undefined;
    return { name, title: pageTitle(name, summary), description: metaDescription(summary, paragraph) };
}

const SCHEMA_OS: Record<TargetPlatform, string> = {
    linux: 'Linux',
    darwin: 'macOS',
    win32: 'Windows',
    android: 'Android',
    web: 'Web browser',
    firefox: 'Web browser',
    chromium: 'Web browser',
};

function structuredData(ctx: RenderContext, title: string, description: string): string {
    const { data, lang } = ctx;
    const systems = [
        ...new Set(data.downloads.targets.filter((target) => target.available).map((target) => SCHEMA_OS[target.os])),
    ];
    return softwareApplicationJsonLd({
        name: localized(data.app.name, lang),
        description,
        url: absolute(data, pageUrl(data, lang)),
        image: ctx.iconUrl ? absolute(data, ctx.iconUrl) : undefined,
        version: data.version,
        operatingSystems: systems,
        license: data.app.license,
        downloadUrl: data.downloads.releasesUrl,
        repository: repositoryUrl(data),
        languages: data.config.languages,
    });
}

type View = NonNullable<RenderContext['view']>;

const VIEW_PATHS: Record<View, string> = {
    app: '',
    support: 'support/',
    privacy: 'privacy/',
    'legal-notice': 'legal-notice/',
};

function repositoryUrl(data: SiteData): string | undefined {
    return data.app.urls.vcsBrowser ?? githubUrl(data.config.repository);
}

/** The frame of every page of an app site in one language. */
export function appShell(
    ctx: Pick<RenderContext, 'data' | 'lang' | 't' | 'assets' | 'iconUrl' | 'displayFontUrl'> & { current?: 'blog' },
): Shell {
    const { data, lang, t } = ctx;
    const name = localized(data.app.name, lang);
    const { config } = data;
    return {
        config,
        lang,
        t,
        assets: ctx.assets,
        name,
        home: pageUrl(data, lang),
        iconUrl: ctx.iconUrl,
        branding: data.app.branding,
        repository: repositoryUrl(data),
        licenses: [
            data.app.license
                ? plain(t('{app} is licensed under {license}.'), { app: name, license: data.app.license })
                : '',
            data.app.contentLicense
                ? plain(t('This page reproduces text licensed under {license}.'), { license: data.app.contentLicense })
                : '',
        ].filter(Boolean),
        nav: config.blog
            ? [{ href: blogIndexUrl(config, lang), label: t('Blog'), glyph: 'blog', current: ctx.current === 'blog' }]
            : [],
        feeds: config.blog ? [{ title: `${name} – ${t('Blog')}`, href: blogFeedUrl(config, lang) }] : [],
        displayFontUrl: ctx.displayFontUrl,
    };
}

function appPageMeta(ctx: RenderContext, view: View): PageMeta {
    const { data } = ctx;
    const { title, description } = pageMeta(ctx, view);
    return {
        title,
        description,
        urls: Object.fromEntries(
            data.config.languages.map((code) => [code, sitePageUrl(data.config, code, VIEW_PATHS[view])]),
        ),
        ogImage: ctx.ogImage,
        jsonLd: view === 'app' ? structuredData(ctx, title, description) : undefined,
    };
}

export function renderPage(ctx: RenderContext): string {
    const { data, lang } = ctx;
    return documentPage(
        appShell(ctx),
        appPageMeta(ctx, 'app'),
        `${masthead(ctx)}
<main>
<div class="column">
<section class="about">
<h2>${esc(localized(data.app.summary, lang))}</h2>
${blocks(data.app.description, lang)}
</section>
${releases(ctx)}
${ctx.latestPosts ?? ''}
${support(ctx)}
${links(ctx)}
${relatedSection(ctx)}
${tags(ctx)}
</div>
</main>`,
    );
}

/** The support entries as cards; shared with the developer site, whose reference is the person's. */
export function supportList(entries: readonly SiteSupportEntry[], t: Translate, reference: string): string {
    return `<app-support>
<ul class="card-list">
${entries.map((entry) => supportItem(entry, t, reference)).join('\n')}
</ul>
</app-support>`;
}

function backToApp(ctx: RenderContext, name: string): { href: string; label: string } {
    return { href: pageUrl(ctx.data, ctx.lang), label: fmt(ctx.t('Back to {app}'), { app: name }) };
}

/** `/<lang>/support/`: the ways to support the app, as plain markup that needs no script. */
export function renderSupportPage(page: RenderContext): string {
    const ctx: RenderContext = { ...page, view: 'support' };
    const { data, t } = ctx;
    const meta = pageMeta(ctx, 'support');
    return simplePage(appShell(ctx), appPageMeta(ctx, 'support'), {
        heading: t('Support'),
        byline: meta.name,
        body: `<p class="support-intro">${esc(meta.description)}</p>
${supportList(data.config.support, t, supportReference(data))}`,
        back: backToApp(ctx, meta.name),
    });
}

/**
 * The paragraph every privacy page opens with, regardless of what the site is about. It is about
 * visiting THIS static page — this package adds no cookie, no analytics and no third-party resource
 * of its own, so that much is true for every consumer. `hostingPolicyUrl` is the one fact that
 * varies by deployment and is not guessed; left out, nothing about hosting is said.
 */
export function hostingNotice(config: Pick<SiteData['config'], 'privacy'>, t: Translate): string {
    const intro = t('This page is a static file: no cookie, no analytics, nothing from a third party.');
    const logs = t('Whoever serves it may keep ordinary web-server access logs of the request.');
    const link = config.privacy?.hostingPolicyUrl;
    return `<p class="privacy-hosting">${esc(intro)} ${esc(logs)}${link ? ` <a href="${esc(link)}">${esc(t("See the hosting provider's notice"))}</a>` : ''}</p>`;
}

/**
 * `/<lang>/privacy/`: the hosting paragraph above, then the app's own statement of what it does
 * with data — read verbatim from the file `gjsify.site.privacy.statements[lang]` names, rendered
 * through the Markdown subset in `markdown.ts`. Never generated: see ADR 0109's amendment on why.
 */
export function renderPrivacyPage(page: RenderContext, statement: string): string {
    const ctx: RenderContext = { ...page, view: 'privacy' };
    const meta = pageMeta(ctx, 'privacy');
    return simplePage(appShell(ctx), appPageMeta(ctx, 'privacy'), {
        heading: ctx.t('Privacy'),
        byline: meta.name,
        columnClass: 'privacy-statement',
        body: `${hostingNotice(ctx.data.config, ctx.t)}
${renderMarkdown(statement)}`,
        back: backToApp(ctx, meta.name),
    });
}

/**
 * `/<lang>/legal-notice/`: the app's own Legal Notice / Impressum statement, read verbatim from
 * `gjsify.site.legalNotice.statements[lang]` and rendered through the same Markdown subset as
 * `privacy`. Unlike `privacy`, no built-in paragraph is prepended — there is nothing about hosting
 * to disclose here, only who is legally responsible for the site, and that is entirely the
 * consumer's own statement.
 */
export function renderLegalNoticePage(page: RenderContext, statement: string): string {
    const ctx: RenderContext = { ...page, view: 'legal-notice' };
    const meta = pageMeta(ctx, 'legal-notice');
    return simplePage(appShell(ctx), appPageMeta(ctx, 'legal-notice'), {
        heading: ctx.t('Legal Notice'),
        byline: meta.name,
        columnClass: 'privacy-statement',
        body: renderMarkdown(statement),
        back: backToApp(ctx, meta.name),
    });
}

/** The root page: a script picks the visitor's language, the link list is what everyone else (and every crawler) sees. */
export function renderRoot(data: SiteData, assets: ClientAssets, iconUrl: string | undefined): string {
    return rootPage(data.config, data.app.name.source, assets, iconUrl);
}
