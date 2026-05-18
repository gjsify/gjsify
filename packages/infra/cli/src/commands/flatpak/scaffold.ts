// MetaInfo XML / .desktop / flathub.json scaffolding helpers for
// `gjsify flatpak init`. Loads the static templates from the cli's
// `src/templates/flatpak/` directory (inlined into the bundled GJS CLI
// via the static-read-inliner) and substitutes `{{TOKEN}}` placeholders
// from the project's `gjsify.flatpak` config.

import { readFileSync } from 'node:fs';
import type { ConfigDataFlatpak } from '../../types/config-data.js';

/**
 * Lazy template loaders. The function shape matches what
 * `static-read-inliner` looks for so the templates are inlined into the
 * GJS bundle at build time.
 */
function loadMetainfoAppTemplate(): string {
    return readFileSync(
        new URL('../../templates/flatpak/metainfo-app.xml.tmpl', import.meta.url),
        'utf-8',
    );
}
function loadMetainfoCliTemplate(): string {
    return readFileSync(
        new URL('../../templates/flatpak/metainfo-cli.xml.tmpl', import.meta.url),
        'utf-8',
    );
}
function loadDesktopTemplate(): string {
    return readFileSync(
        new URL('../../templates/flatpak/desktop.tmpl', import.meta.url),
        'utf-8',
    );
}
function loadFlathubAppTemplate(): string {
    return readFileSync(
        new URL('../../templates/flatpak/flathub-app.json.tmpl', import.meta.url),
        'utf-8',
    );
}
function loadFlathubCliTemplate(): string {
    return readFileSync(
        new URL('../../templates/flatpak/flathub-cli.json.tmpl', import.meta.url),
        'utf-8',
    );
}

export interface ScaffoldInputs {
    appId: string;
    name: string;
    command: string;
    kind: 'app' | 'cli';
    flatpak: ConfigDataFlatpak;
}

export interface MissingFieldError {
    field: string;
    hint: string;
}

/**
 * Validate that the config has the minimum set of fields required for
 * MetaInfo XML rendering. Returns the list of missing fields with
 * actionable hints; empty list means OK.
 */
export function validateScaffoldInputs(inputs: ScaffoldInputs): MissingFieldError[] {
    const f = inputs.flatpak;
    const missing: MissingFieldError[] = [];
    if (!f.developer?.id || !f.developer?.name) {
        missing.push({
            field: 'gjsify.flatpak.developer',
            hint: 'Set `gjsify.flatpak.developer = { "id": "io.github.you", "name": "Your Name" }` in package.json. The id is reverse-DNS.',
        });
    }
    if (!f.summary) {
        missing.push({
            field: 'gjsify.flatpak.summary',
            hint: 'One-line app summary, ≤80 chars, no trailing period. Example: "Learn 6502 assembly language".',
        });
    }
    if (!f.description) {
        missing.push({
            field: 'gjsify.flatpak.description',
            hint: 'Multi-paragraph plain-text description. Will be split on blank lines into MetaInfo <p> blocks.',
        });
    }
    if (!f.license?.project) {
        missing.push({
            field: 'gjsify.flatpak.license.project',
            hint: 'SPDX identifier of the project license, e.g. "MIT", "GPL-3.0-or-later".',
        });
    }
    if (!f.homepageUrl) {
        missing.push({
            field: 'gjsify.flatpak.homepageUrl',
            hint: 'Required by Flathub. Example: "https://github.com/you/your-repo".',
        });
    }
    return missing;
}

/** Render the MetaInfo XML for a desktop application. */
export function renderMetainfoApp(inputs: ScaffoldInputs): string {
    const f = inputs.flatpak;
    const tokens = buildTokens(inputs);
    return substitute(loadMetainfoAppTemplate(), {
        ...tokens,
        URLS: renderUrls(f),
        CATEGORIES: renderCategories(f.categories),
        KEYWORDS: renderKeywords(f.keywords),
        BRANDING: renderBranding(f.branding),
        SCREENSHOTS: renderScreenshots(f.screenshots),
        RELEASES: renderReleases(f.releases),
    });
}

/** Render the MetaInfo XML for a console application. */
export function renderMetainfoCli(inputs: ScaffoldInputs): string {
    const f = inputs.flatpak;
    const tokens = buildTokens(inputs);
    return substitute(loadMetainfoCliTemplate(), {
        ...tokens,
        URLS: renderUrls(f),
        CATEGORIES: renderCategories(f.categories),
        KEYWORDS: renderKeywords(f.keywords),
        RELEASES: renderReleases(f.releases),
    });
}

/** Render the .desktop entry (app kind only). */
export function renderDesktop(inputs: ScaffoldInputs): string {
    const f = inputs.flatpak;
    const categoriesLine = (f.categories ?? ['Utility']).join(';') + ';';
    const keywordsLine = f.keywords?.length
        ? `Keywords=${f.keywords.join(';')};\n`
        : '';
    return substitute(loadDesktopTemplate(), {
        NAME: inputs.name,
        SUMMARY: f.summary ?? inputs.name,
        COMMAND: inputs.command,
        APP_ID: inputs.appId,
        CATEGORIES_LINE: categoriesLine,
        KEYWORDS_LINE: keywordsLine,
    });
}

/** Render the flathub.json policy file. */
export function renderFlathubJson(kind: 'app' | 'cli'): string {
    return kind === 'cli' ? loadFlathubCliTemplate() : loadFlathubAppTemplate();
}

// ─── Internal helpers ────────────────────────────────────────────────────

function buildTokens(inputs: ScaffoldInputs): Record<string, string> {
    const f = inputs.flatpak;
    return {
        APP_ID: inputs.appId,
        NAME: inputs.name,
        SUMMARY: escapeXml(f.summary ?? inputs.name),
        DESCRIPTION_PARAGRAPHS: renderDescription(f.description ?? ''),
        DEVELOPER_ID: f.developer?.id ?? '',
        DEVELOPER_NAME: escapeXml(f.developer?.name ?? ''),
        METADATA_LICENSE: f.license?.metadata ?? 'CC0-1.0',
        PROJECT_LICENSE: f.license?.project ?? '',
        CONTENT_RATING: f.contentRating ?? 'oars-1.1',
        COMMAND: inputs.command,
        COPYRIGHT_YEAR: String(new Date().getFullYear()),
    };
}

function renderDescription(description: string): string {
    const paragraphs = description.trim().split(/\n\n+/);
    return paragraphs
        .map((para) => `    <p>${escapeXml(para.trim().replace(/\s+/g, ' '))}</p>`)
        .join('\n');
}

function renderUrls(f: ConfigDataFlatpak): string {
    const lines: string[] = [];
    if (f.homepageUrl) lines.push(`  <url type="homepage">${escapeXml(f.homepageUrl)}</url>`);
    if (f.bugtrackerUrl) lines.push(`  <url type="bugtracker">${escapeXml(f.bugtrackerUrl)}</url>`);
    if (f.vcsBrowserUrl) lines.push(`  <url type="vcs-browser">${escapeXml(f.vcsBrowserUrl)}</url>`);
    if (f.donationUrl) lines.push(`  <url type="donation">${escapeXml(f.donationUrl)}</url>`);
    return lines.join('\n');
}

function renderCategories(cats: string[] | undefined): string {
    if (!cats?.length) return '';
    const inner = cats.map((c) => `    <category>${escapeXml(c)}</category>`).join('\n');
    return `  <categories>\n${inner}\n  </categories>`;
}

function renderKeywords(kws: string[] | undefined): string {
    if (!kws?.length) return '';
    const inner = kws.map((k) => `    <keyword>${escapeXml(k)}</keyword>`).join('\n');
    return `  <keywords>\n${inner}\n  </keywords>`;
}

function renderBranding(b: ConfigDataFlatpak['branding']): string {
    if (!b) return '';
    return [
        '  <branding>',
        `    <color type="primary" scheme_preference="light">${escapeXml(b.accentLight)}</color>`,
        `    <color type="primary" scheme_preference="dark">${escapeXml(b.accentDark)}</color>`,
        '  </branding>',
    ].join('\n');
}

function renderScreenshots(shots: ConfigDataFlatpak['screenshots']): string {
    if (!shots?.length) return '';
    const inner = shots
        .map((s, i) => {
            const def = i === 0 ? ' type="default"' : '';
            const env = s.environment ? ` environment="${escapeXml(s.environment)}"` : '';
            const caption = s.caption ? `\n      <caption>${escapeXml(s.caption)}</caption>` : '';
            return [
                `    <screenshot${def}${env}>`,
                `      <image>${escapeXml(s.url)}</image>${caption}`,
                '    </screenshot>',
            ].join('\n');
        })
        .join('\n');
    return `  <screenshots>\n${inner}\n  </screenshots>`;
}

function renderReleases(rs: ConfigDataFlatpak['releases']): string {
    if (!rs?.length) return '';
    const inner = rs
        .map((r) => {
            const desc = r.description
                ? `\n      <description><p>${escapeXml(r.description)}</p></description>\n    `
                : '';
            return `    <release version="${escapeXml(r.version)}" date="${escapeXml(r.date)}">${desc}</release>`;
        })
        .join('\n');
    return `  <releases>\n${inner}\n  </releases>`;
}

function substitute(template: string, tokens: Record<string, string>): string {
    let out = template;
    for (const [key, value] of Object.entries(tokens)) {
        out = out.split(`{{${key}}}`).join(value);
    }
    // Remove any leftover unsubstituted tokens (= optional sections that
    // produced empty strings); also collapse 3+ consecutive blank lines.
    out = out.replace(/\{\{[A-Z_]+\}\}\n?/g, '');
    out = out.replace(/\n{3,}/g, '\n\n');
    return out;
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
