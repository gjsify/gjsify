// MetaInfo XML / .desktop / flathub.json scaffolding for
// `gjsify flatpak init`. Phase F.9.6 onwards builds the MetaInfo XML
// directly in TypeScript instead of substituting into a static template —
// the AppStream surface (description blocks, per-release rich notes,
// translator hints, kudos, supports/requires/recommends, content_rating
// attributes, provides) has too many optional nested sections for a
// template+placeholder approach to stay legible.
//
// `.desktop` and `flathub.json` keep their static templates (they're
// flat key=value or empty-object files where substitution is fine).

import { readFileSync } from 'node:fs';
import type { ConfigDataFlatpak, DescriptionBlock } from '../../types/config-data.js';

/**
 * Lazy template loaders for the two artefacts that stay template-based.
 * `static-read-inliner` matches this shape and inlines the templates
 * into the GJS bundle at build time.
 */
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
            hint: 'Plain text (split on blank lines) or DescriptionBlock[] for rich content with bullet lists + translator hints.',
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
    return renderMetainfo(inputs, 'desktop-application');
}

/** Render the MetaInfo XML for a console application. */
export function renderMetainfoCli(inputs: ScaffoldInputs): string {
    return renderMetainfo(inputs, 'console-application');
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

// ─── MetaInfo XML builder ────────────────────────────────────────────────

function renderMetainfo(
    inputs: ScaffoldInputs,
    kind: 'desktop-application' | 'console-application',
): string {
    const f = inputs.flatpak;
    const year = new Date().getFullYear();
    const developerName = f.developer?.name ?? '';
    const lines: string[] = [];

    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push(`<!-- Copyright ${year} ${escapeXml(developerName)} -->`);
    lines.push(`<component type="${kind}">`);
    lines.push(`  <id>${escapeXml(inputs.appId)}</id>`);
    lines.push(`  <metadata_license>${escapeXml(f.license?.metadata ?? 'CC0-1.0')}</metadata_license>`);
    lines.push(`  <project_license>${escapeXml(f.license?.project ?? '')}</project_license>`);
    lines.push(`  <name>${escapeXml(inputs.name)}</name>`);
    pushTranslatorHint(lines, f.summaryTranslatorHint, '  ');
    lines.push(`  <summary>${escapeXml(f.summary ?? inputs.name)}</summary>`);

    if (f.iconRemote) {
        lines.push(`  <icon type="remote">${escapeXml(f.iconRemote)}</icon>`);
    }

    // <description>
    lines.push('  <description>');
    for (const blockLine of renderDescriptionBlocks(f.description ?? '', '    ')) {
        lines.push(blockLine);
    }
    lines.push('  </description>');

    // <developer>
    if (f.developer?.id && f.developer?.name) {
        lines.push(`  <developer id="${escapeXml(f.developer.id)}">`);
        const translateAttr = f.developer.nameTranslatable === true ? '' : ' translate="no"';
        lines.push(`    <name${translateAttr}>${escapeXml(f.developer.name)}</name>`);
        if (f.developer.email) {
            lines.push(`    <email>${escapeXml(f.developer.email)}</email>`);
        }
        lines.push('  </developer>');
    }

    if (kind === 'desktop-application') {
        lines.push(`  <launchable type="desktop-id">${escapeXml(inputs.appId)}.desktop</launchable>`);
    }

    // <screenshots>
    if (f.screenshots?.length) {
        lines.push('  <screenshots>');
        f.screenshots.forEach((s, i) => {
            const type = s.type ?? (i === 0 ? 'default' : undefined);
            const typeAttr = type ? ` type="${escapeXml(type)}"` : '';
            const envAttr = s.environment ? ` environment="${escapeXml(s.environment)}"` : '';
            lines.push(`    <screenshot${typeAttr}${envAttr}>`);
            lines.push(`      <image>${escapeXml(s.url)}</image>`);
            if (s.caption) {
                pushTranslatorHint(lines, s.captionTranslatorHint, '      ');
                lines.push(`      <caption>${escapeXml(s.caption)}</caption>`);
            }
            lines.push('    </screenshot>');
        });
        lines.push('  </screenshots>');
    }

    // <url> entries
    if (f.homepageUrl) lines.push(`  <url type="homepage">${escapeXml(f.homepageUrl)}</url>`);
    if (f.bugtrackerUrl) lines.push(`  <url type="bugtracker">${escapeXml(f.bugtrackerUrl)}</url>`);
    if (f.vcsBrowserUrl) lines.push(`  <url type="vcs-browser">${escapeXml(f.vcsBrowserUrl)}</url>`);
    if (f.donationUrl) lines.push(`  <url type="donation">${escapeXml(f.donationUrl)}</url>`);
    if (f.translateUrl) lines.push(`  <url type="translate">${escapeXml(f.translateUrl)}</url>`);

    // <content_rating>
    const cr = normaliseContentRating(f.contentRating);
    if (cr.attributes && Object.keys(cr.attributes).length > 0) {
        lines.push(`  <content_rating type="${escapeXml(cr.type)}">`);
        for (const [key, value] of Object.entries(cr.attributes)) {
            lines.push(`    <content_attribute id="${escapeXml(key)}">${escapeXml(value)}</content_attribute>`);
        }
        lines.push('  </content_rating>');
    } else {
        lines.push(`  <content_rating type="${escapeXml(cr.type)}" />`);
    }

    // <releases>
    if (f.releases?.length) {
        lines.push('  <releases>');
        for (const r of f.releases) {
            if (r.description === undefined) {
                lines.push(`    <release version="${escapeXml(r.version)}" date="${escapeXml(r.date)}" />`);
            } else {
                lines.push(`    <release version="${escapeXml(r.version)}" date="${escapeXml(r.date)}">`);
                lines.push('      <description>');
                for (const blockLine of renderDescriptionBlocks(r.description, '        ')) {
                    lines.push(blockLine);
                }
                lines.push('      </description>');
                lines.push('    </release>');
            }
        }
        lines.push('  </releases>');
    }

    // <categories>
    if (f.categories?.length) {
        lines.push('  <categories>');
        for (const c of f.categories) lines.push(`    <category>${escapeXml(c)}</category>`);
        lines.push('  </categories>');
    }

    // <keywords>
    if (f.keywords?.length) {
        lines.push('  <keywords>');
        for (const k of f.keywords) lines.push(`    <keyword>${escapeXml(k)}</keyword>`);
        lines.push('  </keywords>');
    }

    // <branding> (apps only — Flathub ignores it on CLI)
    if (kind === 'desktop-application' && f.branding) {
        lines.push('  <branding>');
        lines.push(`    <color type="primary" scheme_preference="light">${escapeXml(f.branding.accentLight)}</color>`);
        lines.push(`    <color type="primary" scheme_preference="dark">${escapeXml(f.branding.accentDark)}</color>`);
        lines.push('  </branding>');
    }

    // <kudos>
    if (f.kudos?.length) {
        lines.push('  <kudos>');
        for (const k of f.kudos) lines.push(`    <kudo>${escapeXml(k)}</kudo>`);
        lines.push('  </kudos>');
    }

    // <provides> — always emit <binary> for both kinds; <mediatype>/<dbus> only when configured
    const binaries = f.provides?.binaries ?? [inputs.command];
    const mimetypes = f.provides?.mimetypes ?? [];
    const dbus = f.provides?.dbus ?? [];
    if (binaries.length || mimetypes.length || dbus.length) {
        lines.push('  <provides>');
        for (const b of binaries) lines.push(`    <binary>${escapeXml(b)}</binary>`);
        for (const m of mimetypes) lines.push(`    <mediatype>${escapeXml(m)}</mediatype>`);
        for (const d of dbus) lines.push(`    <dbus type="${escapeXml(d.type)}">${escapeXml(d.id)}</dbus>`);
        lines.push('  </provides>');
    }

    // <supports>
    if (f.supports?.controls?.length || f.supports?.internet) {
        lines.push('  <supports>');
        for (const c of f.supports.controls ?? []) lines.push(`    <control>${escapeXml(c)}</control>`);
        if (f.supports.internet) lines.push(`    <internet>${escapeXml(f.supports.internet)}</internet>`);
        lines.push('  </supports>');
    }

    // <requires>
    if (f.requires?.displayLengthMin || f.requires?.controls?.length || f.requires?.internet) {
        lines.push('  <requires>');
        if (f.requires.displayLengthMin) {
            lines.push(`    <display_length compare="ge">${f.requires.displayLengthMin}</display_length>`);
        }
        for (const c of f.requires.controls ?? []) lines.push(`    <control>${escapeXml(c)}</control>`);
        if (f.requires.internet) lines.push(`    <internet>${escapeXml(f.requires.internet)}</internet>`);
        lines.push('  </requires>');
    }

    // <recommends>
    if (f.recommends?.displayLengthMin || f.recommends?.controls?.length) {
        lines.push('  <recommends>');
        if (f.recommends.displayLengthMin) {
            lines.push(`    <display_length compare="ge">${f.recommends.displayLengthMin}</display_length>`);
        }
        for (const c of f.recommends.controls ?? []) lines.push(`    <control>${escapeXml(c)}</control>`);
        lines.push('  </recommends>');
    }

    lines.push('</component>');
    return lines.join('\n') + '\n';
}

// ─── Description block renderer ──────────────────────────────────────────

function renderDescriptionBlocks(
    description: string | DescriptionBlock[],
    indent: string,
): string[] {
    const blocks = typeof description === 'string'
        ? stringToBlocks(description)
        : description;
    const out: string[] = [];
    for (const block of blocks) {
        if ('p' in block) {
            pushTranslatorHint(out, block.translatorHint, indent);
            out.push(`${indent}<p>${escapeXml(block.p.trim().replace(/\s+/g, ' '))}</p>`);
        } else {
            pushTranslatorHint(out, block.translatorHint, indent);
            out.push(`${indent}<ul>`);
            for (const item of block.ul) {
                if (typeof item === 'string') {
                    out.push(`${indent}  <li>${escapeXml(item)}</li>`);
                } else {
                    pushTranslatorHint(out, item.translatorHint, `${indent}  `);
                    out.push(`${indent}  <li>${escapeXml(item.item)}</li>`);
                }
            }
            out.push(`${indent}</ul>`);
        }
    }
    return out;
}

/** Auto-convert blank-line-split string into paragraph blocks. */
function stringToBlocks(s: string): DescriptionBlock[] {
    return s
        .trim()
        .split(/\n\n+/)
        .map((para) => ({ p: para.trim().replace(/\s+/g, ' ') } as DescriptionBlock));
}

function pushTranslatorHint(out: string[], hint: string | undefined, indent: string): void {
    if (!hint) return;
    out.push(`${indent}<!-- TRANSLATORS: ${hint} -->`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function normaliseContentRating(
    cr: ConfigDataFlatpak['contentRating'],
): { type: string; attributes?: Record<string, string> } {
    if (cr === undefined) return { type: 'oars-1.1' };
    if (typeof cr === 'string') return { type: cr };
    return { type: cr.type ?? 'oars-1.1', attributes: cr.attributes };
}

function substitute(template: string, tokens: Record<string, string>): string {
    let out = template;
    for (const [key, value] of Object.entries(tokens)) {
        out = out.split(`{{${key}}}`).join(value);
    }
    return out;
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
