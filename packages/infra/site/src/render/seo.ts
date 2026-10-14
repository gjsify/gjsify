// Everything a crawler or a link preview reads that is not the visible page: locale tags, the
// title and description, structured data, the sitemap. Pure string work, so it runs on every runtime.

import { esc } from './html.js';

/** Facebook's Open Graph wants `language_TERRITORY`; a bare language code is not a valid `og:locale`. */
const DEFAULT_TERRITORY: Record<string, string> = {
    cs: 'CZ',
    da: 'DK',
    de: 'DE',
    en: 'US',
    es: 'ES',
    fi: 'FI',
    fr: 'FR',
    it: 'IT',
    ja: 'JP',
    ko: 'KR',
    nb: 'NO',
    nl: 'NL',
    pl: 'PL',
    pt: 'PT',
    ru: 'RU',
    sv: 'SE',
    tr: 'TR',
    uk: 'UA',
    zh: 'CN',
};

/** `de` → `de_DE`, `pt-BR` → `pt_BR`; a language with no known default territory is passed through. */
export function ogLocale(lang: string): string {
    const [primary = lang, ...rest] = lang.split(/[-_]/);
    const language = primary.toLowerCase();
    const territory = rest.find((part) => /^[A-Za-z]{2}$/.test(part))?.toUpperCase() ?? DEFAULT_TERRITORY[language];
    return territory ? `${language}_${territory}` : language;
}

/** Search results cut a title near 60 characters and a description near 160. */
export const TITLE_MIN = 20;
export const DESCRIPTION_MIN = 70;
export const DESCRIPTION_MAX = 160;

/** `Name – summary`, or the bare name when the summary adds nothing to it. */
export function pageTitle(name: string, summary: string): string {
    const trimmed = summary.trim();
    return trimmed === '' || trimmed.toLowerCase() === name.trim().toLowerCase() ? name : `${name} – ${trimmed}`;
}

/**
 * The description for search results and link previews. A metainfo summary is a few words by
 * design (Flathub caps it), so the first paragraph of the description carries more.
 */
export function metaDescription(summary: string, firstParagraph: string | undefined): string {
    const text = firstParagraph?.replace(/\s+/g, ' ').trim();
    if (!text || text.length <= summary.length) return summary;
    if (text.length <= DESCRIPTION_MAX) return text;
    const cut = text.slice(0, DESCRIPTION_MAX - 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > DESCRIPTION_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, '')}…`;
}

/** What is wrong with a page's title or description, one sentence each; empty when both are fine. */
export function seoWarnings(page: { lang: string; name: string; title: string; description: string }): string[] {
    const { lang, name, title, description } = page;
    const warnings: string[] = [];
    if (title === name) {
        warnings.push(`${lang}: the page title is only the app name "${name}" — give the metainfo a distinct summary`);
    } else if (title.length < TITLE_MIN) {
        warnings.push(`${lang}: the page title "${title}" is shorter than ${TITLE_MIN} characters`);
    }
    if (description.trim() === name.trim() || description.length < DESCRIPTION_MIN) {
        warnings.push(
            `${lang}: the meta description is ${description.length} characters (under ${DESCRIPTION_MIN}) — ` +
                'write a longer first paragraph in the metainfo description',
        );
    }
    return warnings;
}

export interface SoftwareApplicationInput {
    name: string;
    description: string;
    url: string;
    image?: string;
    version?: string;
    category?: string;
    operatingSystems: string[];
    /** An SPDX identifier; only a single id has a page of its own. */
    license?: string;
    downloadUrl?: string;
    repository?: string;
    languages: string[];
}

/** schema.org `SoftwareApplication` as a `<script type="application/ld+json">`. Nothing is invented: absent facts are left out. */
export function softwareApplicationJsonLd(input: SoftwareApplicationInput): string {
    const spdx = input.license && /^[A-Za-z0-9.+-]+$/.test(input.license) ? input.license : undefined;
    const data: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: input.name,
        description: input.description,
        url: input.url,
        image: input.image,
        softwareVersion: input.version || undefined,
        applicationCategory: input.category,
        operatingSystem: input.operatingSystems.length > 0 ? input.operatingSystems.join(', ') : undefined,
        license: spdx ? `https://spdx.org/licenses/${spdx}.html` : undefined,
        downloadUrl: input.downloadUrl,
        sameAs: input.repository ? [input.repository] : undefined,
        inLanguage: input.languages,
    };
    const json = JSON.stringify(data).replace(/</g, '\\u003c');
    return `<script type="application/ld+json">${json}</script>`;
}

/** One logical page, as its absolute address per language. */
export type SitemapPage = Readonly<Record<string, string>>;

/** `sitemap.xml` with a self-including `xhtml:link` alternate set per page, and `x-default` on the default language. */
export function sitemapXml(pages: readonly SitemapPage[], defaultLanguage: string): string {
    const entries = pages.flatMap((page) => {
        const languages = Object.keys(page);
        const alternates = [
            ...languages.map(
                (code) => `    <xhtml:link rel="alternate" hreflang="${esc(code)}" href="${esc(page[code]!)}"/>`,
            ),
            ...(page[defaultLanguage]
                ? [`    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(page[defaultLanguage])}"/>`]
                : []),
        ].join('\n');
        return languages.map((code) => `  <url>\n    <loc>${esc(page[code]!)}</loc>\n${alternates}\n  </url>`);
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`;
}

export function robotsTxt(sitemapUrl: string): string {
    return `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`;
}
