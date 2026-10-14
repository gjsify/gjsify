// The page that lists several apps, each linking to its own support page. It reads no app's data
// beyond a name and an icon, so it needs none of the per-app page machinery.

import { esc } from './html.js';
import { languageName, linkCard } from './pages.js';
import { ogLocale } from './seo.js';
import type { ClientAssets } from './pages.js';

export interface OverviewApp {
    name: string;
    /** Absolute address of this app's support page in the rendered language. */
    url: string;
}

export interface OverviewPage {
    lang: string;
    languages: readonly string[];
    defaultLanguage: string;
    /** Absolute address of the overview per language. */
    urls: Readonly<Record<string, string>>;
    /** Root-relative address per language, for the language switch. */
    paths: Readonly<Record<string, string>>;
    apps: readonly OverviewApp[];
    assets: ClientAssets;
    t: (msgid: string) => string;
}

export function renderOverview(page: OverviewPage): string {
    const { lang, t } = page;
    const title = t('Support');
    const intro = t('These apps are free software. Pick one to see how to support its development.');
    const alternates = page.languages.map(
        (code) => `<link rel="alternate" hreflang="${esc(code)}" href="${esc(page.urls[code]!)}">`,
    );
    const switcher = page.languages
        .map((code) =>
            code === lang
                ? `<li><span aria-current="true">${esc(languageName(code))}</span></li>`
                : `<li><a href="${esc(page.paths[code]!)}" hreflang="${esc(code)}" lang="${esc(code)}">${esc(languageName(code))}</a></li>`,
        )
        .join('');
    return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(intro)}">
<link rel="canonical" href="${esc(page.urls[lang]!)}">
${alternates.join('\n')}
<link rel="alternate" hreflang="x-default" href="${esc(page.urls[page.defaultLanguage]!)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(intro)}">
<meta property="og:url" content="${esc(page.urls[lang]!)}">
<meta property="og:locale" content="${esc(ogLocale(lang))}">
${page.assets.css.map((href) => `<link rel="stylesheet" href="${esc(href)}">`).join('\n')}
</head>
<body>
<header class="masthead">
<div class="hero-inner">
<div class="hero-text">
<h1>${esc(title)}</h1>
</div>
</div>
</header>
<main>
<div class="column">
<p class="support-intro">${esc(intro)}</p>
<ul class="card-list">
${page.apps.map((app) => linkCard(app.url, app.name, 'heart')).join('\n')}
</ul>
</div>
</main>
<footer class="footer"><div class="footer-inner"><nav class="footer-languages" aria-label="${esc(t('Language'))}"><ul>${switcher}</ul></nav></div></footer>
</body>
</html>
`;
}
