// AppStream MetaInfo XML + freedesktop `.desktop` rendering, shared by every
// install format.
//
// These files describe the APPLICATION, not the container it ships in: a
// `.deb`, an `.rpm`, a Flatpak and (later) a macOS bundle all want the same
// `<name>`, `<summary>`, categories, keywords and icon name. They lived under
// `commands/flatpak/` while Flatpak was the only packer; ADR 0024 § 8 moves
// them out so `gjsify ship` reads them without importing another command.
//
// The MetaInfo XML is built line by line in TypeScript rather than substituted
// into a template: the AppStream surface (description blocks, per-release rich
// notes, translator hints, kudos, supports/requires/recommends, content_rating
// attributes, provides) has too many optional nested sections for a
// template+placeholder approach to stay legible. The `.desktop` entry stays
// template-based — it is flat `key=value`.

import type { AppMetadata, DescriptionBlock } from '../types/config-data.js';

/**
 * The `.desktop` skeleton, as source rather than as a file to find at runtime.
 *
 * It used to live in `src/templates/app/desktop.tmpl` and be read through
 * `readFileSync(new URL(…, import.meta.url))`, with a comment stating that
 * `static-read-inliner` inlines it into the GJS bundle. It does not: the
 * inliner's `shouldRewrite` requires the file to sit under `node_modules`, and
 * the CLI bundles its OWN source. So the read survived into
 * `dist/cli.gjs.mjs`, resolved `../templates/…` against `dist/`, and
 * `gjsify ship` died with ENOENT on every project — while the Node `lib/`
 * entry, where the relative path happens to be right, worked. A comment
 * asserting the opposite is why it went unnoticed.
 *
 * A ten-line skeleton is not worth a file the bundle has to locate. As a
 * template literal there is nothing to resolve, nothing to package, and the
 * two entry points cannot disagree.
 */
const DESKTOP_TEMPLATE = `[Desktop Entry]
Name={{NAME}}
Comment={{SUMMARY}}
Exec={{COMMAND}}
Icon={{APP_ID}}
Terminal=false
Type=Application
Categories={{CATEGORIES_LINE}}
{{KEYWORDS_LINE}}{{MIMETYPES_LINE}}StartupNotify=true
StartupWMClass={{APP_ID}}
`;

function loadDesktopTemplate(): string {
    return DESKTOP_TEMPLATE;
}

/** Everything a renderer needs that is not part of {@link AppMetadata} itself. */
export interface AppMetadataInputs {
    /** Reverse-DNS application id — the MetaInfo `<id>` and the icon/desktop basename. */
    appId: string;
    /** Human-readable display name. */
    name: string;
    /** The binary to launch (`Exec=`, and the default `<provides><binary>`). */
    command: string;
    /** `'app'` renders a desktop-application component, `'cli'` a console one. */
    kind: 'app' | 'cli';
    metadata: AppMetadata;
    /**
     * Config path the validator names in its hints, e.g. `gjsify.flatpak` or
     * `gjsify.ship`. Both read the same fields, so the hint has to say which
     * block the caller was actually reading.
     */
    configKey: string;
    /**
     * Year for the copyright comment. Passed in rather than read from the
     * clock: this XML is PAYLOAD, so `new Date()` here makes the artifact's
     * bytes depend on when it was packed — a reproducibility hole no test
     * running inside one second can see. Defaults to the current year for
     * callers that write the file to a source tree rather than into a package.
     */
    copyrightYear?: number;
}

export interface MissingFieldError {
    field: string;
    hint: string;
}

/**
 * Validate that the metadata has the minimum set of fields AppStream needs.
 * Returns the missing fields with actionable hints; an empty list means OK.
 */
export function validateAppMetadata(inputs: AppMetadataInputs): MissingFieldError[] {
    const m = inputs.metadata;
    const key = inputs.configKey;
    const missing: MissingFieldError[] = [];
    if (!m.developer?.id || !m.developer?.name) {
        missing.push({
            field: `${key}.developer`,
            hint: `Set \`${key}.developer = { "id": "io.github.you", "name": "Your Name" }\` in package.json. The id is reverse-DNS.`,
        });
    }
    if (!m.summary) {
        missing.push({
            field: `${key}.summary`,
            hint: 'One-line app summary, ≤80 chars, no trailing period. Example: "Learn 6502 assembly language".',
        });
    }
    if (!m.description) {
        missing.push({
            field: `${key}.description`,
            hint: 'Plain text (split on blank lines) or DescriptionBlock[] for rich content with bullet lists + translator hints.',
        });
    }
    if (!m.license?.project) {
        missing.push({
            field: `${key}.license.project`,
            hint: 'SPDX identifier of the project license, e.g. "MIT", "GPL-3.0-or-later".',
        });
    }
    if (!m.homepageUrl) {
        missing.push({
            field: `${key}.homepageUrl`,
            hint: 'Required by Flathub. Example: "https://github.com/you/your-repo".',
        });
    }
    return missing;
}

/** Render the MetaInfo XML for a desktop application. */
export function renderMetainfoApp(inputs: AppMetadataInputs): string {
    return renderMetainfo(inputs, 'desktop-application');
}

/** Render the MetaInfo XML for a console application. */
export function renderMetainfoCli(inputs: AppMetadataInputs): string {
    return renderMetainfo(inputs, 'console-application');
}

/**
 * Render the `.desktop` entry (app kind only).
 *
 * `Exec=` carries a field code when the app declares MIME types, because a
 * desktop entry with `MimeType=` and no `%f`/`%u` is registered as a handler
 * that is then launched with no argument — the file the user double-clicked is
 * dropped on the floor, and `desktop-file-validate` says so. `x-scheme-handler/*`
 * wins over file types: a URL handler must take `%u`.
 */
export function renderDesktopEntry(inputs: AppMetadataInputs): string {
    const m = inputs.metadata;
    const categoriesLine = (m.categories ?? ['Utility']).join(';') + ';';
    const keywordsLine = m.keywords?.length ? `Keywords=${m.keywords.join(';')};\n` : '';
    // `MimeType=` is sourced from `<config>.provides.mimetypes` — the same field
    // already populates `<mediatype>` entries in the MetaInfo XML, so callers
    // configure both with one knob. Typical entries: `x-scheme-handler/<scheme>`
    // for URL-scheme handlers, or `application/<mime>` for file-type handlers.
    const mimetypes = m.provides?.mimetypes ?? [];
    const mimetypesLine = mimetypes.length ? `MimeType=${mimetypes.join(';')};\n` : '';
    return substitute(loadDesktopTemplate(), {
        NAME: inputs.name,
        SUMMARY: m.summary ?? inputs.name,
        COMMAND: `${inputs.command}${execFieldCode(mimetypes)}`,
        APP_ID: inputs.appId,
        CATEGORIES_LINE: categoriesLine,
        KEYWORDS_LINE: keywordsLine,
        MIMETYPES_LINE: mimetypesLine,
    });
}

/** The `Exec=` field code implied by the declared MIME types. */
function execFieldCode(mimetypes: readonly string[]): string {
    if (mimetypes.some((t) => t.startsWith('x-scheme-handler/'))) return ' %u';
    if (mimetypes.length > 0) return ' %f';
    return '';
}

// ─── MetaInfo XML builder ────────────────────────────────────────────────

function renderMetainfo(inputs: AppMetadataInputs, kind: 'desktop-application' | 'console-application'): string {
    const m = inputs.metadata;
    const year = inputs.copyrightYear ?? new Date().getFullYear();
    const developerName = m.developer?.name ?? '';
    const lines: string[] = [];

    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push(`<!-- Copyright ${year} ${escapeXml(developerName)} -->`);
    lines.push(`<component type="${kind}">`);
    lines.push(`  <id>${escapeXml(inputs.appId)}</id>`);
    lines.push(`  <metadata_license>${escapeXml(m.license?.metadata ?? 'CC0-1.0')}</metadata_license>`);
    lines.push(`  <project_license>${escapeXml(m.license?.project ?? '')}</project_license>`);
    lines.push(`  <name>${escapeXml(inputs.name)}</name>`);
    pushTranslatorHint(lines, m.summaryTranslatorHint, '  ');
    lines.push(`  <summary>${escapeXml(m.summary ?? inputs.name)}</summary>`);

    if (m.iconRemote) {
        lines.push(`  <icon type="remote">${escapeXml(m.iconRemote)}</icon>`);
    }

    // <description>
    lines.push('  <description>');
    for (const blockLine of renderDescriptionBlocks(m.description ?? '', '    ')) {
        lines.push(blockLine);
    }
    lines.push('  </description>');

    // <developer>
    if (m.developer?.id && m.developer?.name) {
        lines.push(`  <developer id="${escapeXml(m.developer.id)}">`);
        const translateAttr = m.developer.nameTranslatable === true ? '' : ' translate="no"';
        lines.push(`    <name${translateAttr}>${escapeXml(m.developer.name)}</name>`);
        if (m.developer.email) {
            lines.push(`    <email>${escapeXml(m.developer.email)}</email>`);
        }
        lines.push('  </developer>');
    }

    if (kind === 'desktop-application') {
        lines.push(`  <launchable type="desktop-id">${escapeXml(inputs.appId)}.desktop</launchable>`);
    }

    // <screenshots>
    if (m.screenshots?.length) {
        lines.push('  <screenshots>');
        m.screenshots.forEach((s, i) => {
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
    if (m.homepageUrl) lines.push(`  <url type="homepage">${escapeXml(m.homepageUrl)}</url>`);
    if (m.bugtrackerUrl) lines.push(`  <url type="bugtracker">${escapeXml(m.bugtrackerUrl)}</url>`);
    if (m.vcsBrowserUrl) lines.push(`  <url type="vcs-browser">${escapeXml(m.vcsBrowserUrl)}</url>`);
    if (m.donationUrl) lines.push(`  <url type="donation">${escapeXml(m.donationUrl)}</url>`);
    if (m.translateUrl) lines.push(`  <url type="translate">${escapeXml(m.translateUrl)}</url>`);

    // <content_rating>
    const cr = normaliseContentRating(m.contentRating);
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
    if (m.releases?.length) {
        lines.push('  <releases>');
        for (const r of m.releases) {
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
    if (m.categories?.length) {
        lines.push('  <categories>');
        for (const c of m.categories) lines.push(`    <category>${escapeXml(c)}</category>`);
        lines.push('  </categories>');
    }

    // <keywords>
    if (m.keywords?.length) {
        lines.push('  <keywords>');
        for (const k of m.keywords) lines.push(`    <keyword>${escapeXml(k)}</keyword>`);
        lines.push('  </keywords>');
    }

    // <branding> (apps only — Flathub ignores it on CLI)
    if (kind === 'desktop-application' && m.branding) {
        lines.push('  <branding>');
        lines.push(`    <color type="primary" scheme_preference="light">${escapeXml(m.branding.accentLight)}</color>`);
        lines.push(`    <color type="primary" scheme_preference="dark">${escapeXml(m.branding.accentDark)}</color>`);
        lines.push('  </branding>');
    }

    // <kudos>
    if (m.kudos?.length) {
        lines.push('  <kudos>');
        for (const k of m.kudos) lines.push(`    <kudo>${escapeXml(k)}</kudo>`);
        lines.push('  </kudos>');
    }

    // <provides> — always emit <binary> for both kinds; <mediatype>/<dbus> only when configured
    const binaries = m.provides?.binaries ?? [inputs.command];
    const mimetypes = m.provides?.mimetypes ?? [];
    const dbus = m.provides?.dbus ?? [];
    if (binaries.length || mimetypes.length || dbus.length) {
        lines.push('  <provides>');
        for (const b of binaries) lines.push(`    <binary>${escapeXml(b)}</binary>`);
        for (const t of mimetypes) lines.push(`    <mediatype>${escapeXml(t)}</mediatype>`);
        for (const d of dbus) lines.push(`    <dbus type="${escapeXml(d.type)}">${escapeXml(d.id)}</dbus>`);
        lines.push('  </provides>');
    }

    // <supports>
    if (m.supports?.controls?.length || m.supports?.internet) {
        lines.push('  <supports>');
        for (const c of m.supports.controls ?? []) lines.push(`    <control>${escapeXml(c)}</control>`);
        if (m.supports.internet) lines.push(`    <internet>${escapeXml(m.supports.internet)}</internet>`);
        lines.push('  </supports>');
    }

    // <requires>
    if (m.requires?.displayLengthMin || m.requires?.controls?.length || m.requires?.internet) {
        lines.push('  <requires>');
        if (m.requires.displayLengthMin) {
            lines.push(`    <display_length compare="ge">${m.requires.displayLengthMin}</display_length>`);
        }
        for (const c of m.requires.controls ?? []) lines.push(`    <control>${escapeXml(c)}</control>`);
        if (m.requires.internet) lines.push(`    <internet>${escapeXml(m.requires.internet)}</internet>`);
        lines.push('  </requires>');
    }

    // <recommends>
    if (m.recommends?.displayLengthMin || m.recommends?.controls?.length) {
        lines.push('  <recommends>');
        if (m.recommends.displayLengthMin) {
            lines.push(`    <display_length compare="ge">${m.recommends.displayLengthMin}</display_length>`);
        }
        for (const c of m.recommends.controls ?? []) lines.push(`    <control>${escapeXml(c)}</control>`);
        lines.push('  </recommends>');
    }

    lines.push('</component>');
    return lines.join('\n') + '\n';
}

// ─── Description block renderer ──────────────────────────────────────────

function renderDescriptionBlocks(description: string | DescriptionBlock[], indent: string): string[] {
    const blocks = typeof description === 'string' ? stringToBlocks(description) : description;
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
        .map((para) => ({ p: para.trim().replace(/\s+/g, ' ') }) as DescriptionBlock);
}

function pushTranslatorHint(out: string[], hint: string | undefined, indent: string): void {
    if (!hint) return;
    out.push(`${indent}<!-- TRANSLATORS: ${hint} -->`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function normaliseContentRating(cr: AppMetadata['contentRating']): {
    type: string;
    attributes?: Record<string, string>;
} {
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

export function escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
