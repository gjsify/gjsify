import {
    isAllSites,
    type DownloadTarget,
    type ExtensionBrowser,
    type ExtensionFamily,
    type ExtensionPermission,
    type SiteData,
} from '../site-data/index.js';
import { esc, fmt, plain } from './html.js';
import { icon, type IconName } from './icons.js';
import { documentPage, type Translate } from './layout.js';
import {
    appPageMeta,
    appShell,
    blocks,
    downloadWidget,
    extensionUrl,
    heroBy,
    localized,
    pageUrl,
    privacyUrl,
    releaseDate,
    screenshotBand,
    sizeLabel,
    supportUrl,
    type RenderContext,
} from './pages.js';

/*
 * The extension page is a store listing in this site's own style. Everything it states comes from
 * `data.extension`, which is parsed without rendering so that other listings can be drawn from the
 * same object later.
 */

export { extensionUrl };

const FAMILY_ICONS: Record<ExtensionFamily, IconName> = {
    firefox: 'firefox',
    chromium: 'chromium',
    edge: 'edge',
    safari: 'safari',
};

export function familyName(family: ExtensionFamily, t: Translate): string {
    return { chromium: t('Chromium'), firefox: t('Firefox'), edge: t('Edge'), safari: t('Safari') }[family];
}

/**
 * What a browser says to a person for a standard permission, in the words of the sentence the
 * install prompt would use. A table of lambdas rather than a map of strings, because the catalogue
 * extractor reads literal `t('…')` calls. A name missing here is shown raw: nothing is invented.
 */
const PERMISSION_TEXT: Record<string, (t: Translate) => string> = {
    activeTab: (t) => t('Access the page you are looking at, only after you click the extension'),
    alarms: (t) => t('Schedule work to run later or repeatedly'),
    background: (t) => t('Keep running in the background'),
    bookmarks: (t) => t('Read and change your bookmarks'),
    browsingData: (t) => t('Clear your browsing data'),
    clipboardRead: (t) => t('Read data you copied'),
    clipboardWrite: (t) => t('Write to the clipboard'),
    contextMenus: (t) => t('Add entries to the right-click menu'),
    cookies: (t) => t('Read and change cookies'),
    declarativeNetRequest: (t) => t('Block or change requests to websites'),
    downloads: (t) => t('Manage your downloads'),
    geolocation: (t) => t('Know your location'),
    history: (t) => t('Read and change your browsing history'),
    identity: (t) => t('Sign in with your account'),
    idle: (t) => t('Notice when you are away from the computer'),
    management: (t) => t('Manage other extensions'),
    nativeMessaging: (t) => t('Talk to an app installed on your computer'),
    notifications: (t) => t('Show notifications'),
    offscreen: (t) => t('Run a hidden page for background work'),
    privacy: (t) => t('Change your browser privacy settings'),
    proxy: (t) => t('Control how the browser connects to the internet'),
    scripting: (t) => t('Run code in pages you allow it on'),
    search: (t) => t('Search with your default search engine'),
    sessions: (t) => t('Read and restore recently closed tabs and windows'),
    sidePanel: (t) => t('Show a side panel'),
    storage: (t) => t('Store its own settings and data'),
    tabGroups: (t) => t('Read and change your tab groups'),
    tabs: (t) => t('See the address and title of your tabs'),
    topSites: (t) => t('Read the sites you visit most'),
    unlimitedStorage: (t) => t('Store an unlimited amount of its own data'),
    webNavigation: (t) => t('See how you move between pages'),
    webRequest: (t) => t('See and handle the requests pages make'),
    webRequestBlocking: (t) => t('Block or change requests pages make'),
    webRequestAuthProvider: (t) => t('Provide sign-in details when a site asks for them'),
};

const own = Object.prototype.hasOwnProperty;

function hostText(name: string, t: Translate): string {
    return isAllSites(name)
        ? t('Read and change your data on all websites')
        : t('Read and change your data on this site');
}

/** "Firefox, Chromium" for the browsers a permission applies to. */
function familyList(families: readonly ExtensionFamily[], t: Translate): string {
    return families.map((family) => familyName(family, t)).join(', ');
}

function permissionItem(entry: ExtensionPermission, ctx: RenderContext, all: readonly ExtensionBrowser[]): string {
    const { t, lang, data } = ctx;
    const extra = data.extension?.explanations[entry.name]?.[lang];
    const builtIn = entry.host
        ? hostText(entry.name, t)
        : own.call(PERMISSION_TEXT, entry.name)
          ? PERMISSION_TEXT[entry.name]!(t)
          : undefined;
    // Only worth saying when the browsers disagree; "in every browser" would be noise.
    const differs = entry.families.length < all.length;
    return `<li class="ext-perm">
<code>${esc(entry.name)}</code>
${builtIn ? `<span class="ext-perm-text">${esc(builtIn)}</span>` : ''}
${extra ? `<span class="ext-perm-why">${esc(extra)}</span>` : ''}
${differs ? `<span class="ext-perm-only">${esc(plain(t('Only in {browsers}'), { browsers: familyList(entry.families, t) }))}</span>` : ''}
</li>`;
}

function permissions(ctx: RenderContext): string {
    const extension = ctx.data.extension!;
    const { t } = ctx;
    const list = (entries: ExtensionPermission[]) =>
        `<ul class="ext-perms">\n${entries.map((entry) => permissionItem(entry, ctx, extension.browsers)).join('\n')}\n</ul>`;
    const groups = [
        extension.required.length > 0
            ? `<h3>${esc(t('Asked when you install'))}</h3>\n${list(extension.required)}`
            : '',
        extension.optional.length > 0
            ? `<h3>${esc(t('Asked only when needed'))}</h3>\n<p class="ext-note">${esc(t('The browser asks you first, when a feature needs it. You can say no.'))}</p>\n${list(extension.optional)}`
            : '',
    ].filter(Boolean);
    return `<section class="ext-section ext-permissions">
<h2>${esc(t('Permissions'))}</h2>
${groups.length > 0 ? groups.join('\n') : `<p>${esc(t('This extension asks for no permissions.'))}</p>`}
</section>`;
}

function dataSection(ctx: RenderContext): string {
    const { data, t, lang } = ctx;
    if (!data.extension?.collectsNoData) return '';
    const privacy = data.config.privacy
        ? ` <a href="${esc(privacyUrl(data, lang))}">${esc(t('Read the privacy statement'))}</a>`
        : '';
    return `<section class="ext-section ext-data">
<h2>${esc(t('Data'))}</h2>
<p>${esc(t('The extension declares that it collects no data.'))}${privacy}</p>
</section>`;
}

/** The browsers as chips: name, and the oldest version the extension says it runs on. */
function worksIn(ctx: RenderContext): string {
    const { t } = ctx;
    const chips = ctx.data.extension!.browsers.map((browser) => {
        const version = browser.minVersion ? `${browser.minVersion}+` : '';
        return `<li class="ext-chip">${icon(FAMILY_ICONS[browser.family])}<span>${esc(familyName(browser.family, t))}</span>${version ? `<small>${esc(version)}</small>` : ''}</li>`;
    });
    return `<section class="ext-section">
<h2>${esc(t('Works in'))}</h2>
<ul class="ext-chips">
${chips.join('\n')}
</ul>
</section>`;
}

/** Install targets of the extension's component, grouped by the browser they are for. */
function installTargets(data: SiteData): Map<ExtensionFamily, DownloadTarget[]> {
    const wanted = data.extension?.component;
    const groups = new Map<ExtensionFamily, DownloadTarget[]>();
    for (const target of data.downloads.targets) {
        if ((target.os !== 'firefox' && target.os !== 'chromium') || (wanted && target.component !== wanted)) continue;
        groups.set(target.os, [...(groups.get(target.os) ?? []), target]);
    }
    return groups;
}

/** The split button and the dialog of the app page, limited to the extension's own downloads. */
function install(ctx: RenderContext): string {
    const targets = [...installTargets(ctx.data).values()].flat();
    return targets.length > 0 ? downloadWidget(ctx, targets) : '';
}

/** One line per distinct value: a single value when every browser agrees, else each browser named. */
function perBrowser(
    browsers: readonly ExtensionBrowser[],
    pick: (browser: ExtensionBrowser) => string | undefined,
    t: Translate,
): string[] {
    const values = browsers.map((browser) => ({ browser, value: pick(browser) })).filter((entry) => entry.value);
    if (values.length === 0) return [];
    const same = values.every((entry) => entry.value === values[0]!.value);
    if (same && values.length === browsers.length) return [values[0]!.value!];
    return values.map((entry) => `${familyName(entry.browser.family, t)}: ${entry.value}`);
}

function fact(label: string, lines: readonly string[], raw = false): string {
    if (lines.length === 0) return '';
    return `<div class="ext-fact"><dt>${esc(label)}</dt><dd>${lines.map((line) => `<span>${raw ? line : esc(line)}</span>`).join('')}</dd></div>`;
}

function languageNames(codes: readonly string[], lang: string): string[] {
    const names = new Intl.DisplayNames([lang], { type: 'language' });
    return codes.map((code) => {
        try {
            return names.of(code.replace(/_/g, '-')) ?? code;
        } catch {
            return code;
        }
    });
}

function facts(ctx: RenderContext): string {
    const { data, t, lang } = ctx;
    const extension = data.extension!;
    const browsers = extension.browsers;
    const targets = installTargets(data);
    const sizeLines = perBrowser(
        browsers,
        (browser) =>
            sizeLabel(
                (targets.get(browser.family) ?? []).find((target) => target.available && target.size)?.size,
                lang,
            ) || undefined,
        t,
    );
    const released = data.latestRelease?.publishedAt ?? data.releases[0]?.date;
    const minimums = perBrowser(browsers, (browser) => browser.minVersion, t);
    const link = (href: string, label: string) => `<a href="${esc(href)}">${esc(label)}</a>`;
    const urls = [
        data.app.urls.homepage ? link(data.app.urls.homepage, t('Website')) : '',
        data.config.support.length > 0 ? link(supportUrl(data, lang), t('Support')) : '',
        data.config.privacy ? link(privacyUrl(data, lang), t('Privacy')) : '',
        data.app.urls.vcsBrowser ? link(data.app.urls.vcsBrowser, t('Source code')) : '',
    ].filter(Boolean);
    return `<aside class="ext-facts" aria-label="${esc(t('Details'))}">
<h2>${esc(t('Details'))}</h2>
<dl>
${fact(
    t('Version'),
    perBrowser(browsers, (browser) => browser.version, t),
)}
${released ? fact(t('Updated'), [releaseDate(released, lang)]) : ''}
${fact(t('Size'), sizeLines)}
${fact(t('Languages'), extension.locales.length > 0 ? [languageNames(extension.locales, lang).join(', ')] : [])}
${fact(
    t('Manifest'),
    perBrowser(browsers, (browser) => `V${browser.manifestVersion}`, t),
)}
${fact(t('Requires'), minimums)}
${data.app.license ? fact(t('License'), [data.app.license]) : ''}
${fact(t('Links'), urls, true)}
</dl>
</aside>`;
}

/** The app this extension is useless without, as a card with its icon and summary. */
function needsApp(ctx: RenderContext): string {
    const { data, t, lang, iconUrl } = ctx;
    const name = localized(data.app.name, lang);
    const mark = iconUrl
        ? `<img class="related-icon" src="${esc(iconUrl)}" alt="" width="48" height="48">`
        : `<span class="related-icon related-icon-blank">${icon('package')}</span>`;
    return `<section class="pair">
<a class="card" href="${esc(pageUrl(data, lang))}">
${mark}
<span class="related-text"><span class="related-name">${fmt(t('Needs the app {app}'), { app: name })}</span><span class="related-summary">${esc(localized(data.app.summary, lang))}</span></span>
${icon('chevron-right', { class: 'link-external' })}
</a>
</section>`;
}

function header(ctx: RenderContext): string {
    const { data, lang } = ctx;
    const [first] = data.extension!.browsers;
    return `<header class="masthead ext-masthead">
<div class="hero-inner">
${ctx.iconUrl ? `<div class="hero-icon" style="--icon-url:url(${esc(ctx.iconUrl)})"><img src="${esc(ctx.iconUrl)}" alt="" width="128" height="128"></div>` : ''}
<div class="hero-text">
<h1>${esc(first!.name[lang]!)}</h1>
${heroBy(ctx)}
${first!.description[lang] ? `<p class="ext-short">${esc(first!.description[lang]!)}</p>` : ''}
${install(ctx)}
</div>
</div>
${screenshotBand(ctx)}
</header>`;
}

/** `/<lang>/extension/`: the store-listing page, built from the manifests; see ADR 0109's amendment. */
export function renderExtensionPage(page: RenderContext): string {
    const ctx: RenderContext = { ...page, view: 'extension' };
    const { data, lang } = ctx;
    return documentPage(
        appShell(ctx),
        appPageMeta(ctx, 'extension'),
        `${header(ctx)}
<main>
<div class="column ext-layout">
${facts(ctx)}
<div class="ext-main">
${needsApp(ctx)}
<section class="ext-section about">
<h2>${esc(ctx.t('About'))}</h2>
${blocks(data.app.description, lang)}
</section>
${permissions(ctx)}
${dataSection(ctx)}
${worksIn(ctx)}
</div>
</div>
</main>`,
    );
}
