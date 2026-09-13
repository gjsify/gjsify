// The AppStream fields an Adwaita About dialog is built from, read without AppStream.
//
// WHY THIS EXISTS. `Adw.AboutDialog.new_from_appdata()` does not exist in the Windows
// libadwaita: gvsbuild applies `patches/libadwaita/0001-remove-appstream-dependency.patch`,
// which wraps every `*_from_appdata` entry point in `#ifndef G_OS_WIN32`, because
// libadwaita 1.9.x parses AppStream through the heavyweight `appstream` library and gvsbuild
// defines no project for it. Both darwin bundles have the constructor (Homebrew's formula
// `depends_on "appstream"`); win32-x64 does not. Measured symbol by symbol out of each
// published bundle's own `Adw-1.typelib` — gjsify/gjsify#1662, and the gap is recorded in
// `packages/node-gi/scripts/typelib-symbols.mjs`. `about-dialog.ts` is the consumer.
//
// WHAT IT IS NOT. Not a general AppStream parser and not a second opinion about one. Every
// selection rule below is a port of `ministream` — the small parser libadwaita 1.10 replaced
// the `appstream` dependency with, at `ms-xml.c` / `ms-locale.c` — because a fallback that
// picked fields by its own taste would show a DIFFERENT About dialog on Windows than on the
// two platforms that run the real constructor, which is the drift this module exists to
// remove. Where it deliberately diverges, the comment says so and says why.
//
// NO GI imports: plain TypeScript, so the `--app node` suite exercises the reading half that
// no Linux or macOS run would otherwise reach.

import { scanXml, type XmlOpenTag, type XmlToken } from './appdata-xml.js';

/** Fields {@link parseAppdata} reads. `null` means the document does not carry the field. */
export interface AppdataFields {
    /** `<id>`, with the `.desktop` suffix resolved the way libadwaita resolves it. */
    applicationId: string | null;
    /** `<name>`, resolved against the locale. */
    applicationName: string | null;
    /** `<name>` inside `<developer>`, or the legacy `<developer_name>`. */
    developerName: string | null;
    /** `version` of the first `<release>` — see {@link parseAppdata} on ordering. */
    version: string | null;
    /** `<url type="homepage">`. */
    website: string | null;
    /** `<url type="help">`. */
    supportUrl: string | null;
    /** `<url type="bugtracker">`. */
    issueUrl: string | null;
    /** `<project_license>`, an SPDX id. */
    license: string | null;
    /**
     * The `<description>` of the release named by `releaseNotesVersion`, as the Pango-ish
     * markup `Adw.AboutDialog:release-notes` parses. `null` when no version was asked for,
     * or when no release matches it.
     */
    releaseNotes: string | null;
}

/** Options for {@link parseAppdata}. */
export interface ParseAppdataOptions {
    /**
     * BCP-47 locale that translatable elements are resolved against. Default `C`, the
     * untranslated source string. {@link appdataLocale} derives it from the platform.
     */
    locale?: string;
    /**
     * Which release's notes to extract, matched by EXACT string equality — the same
     * `g_strcmp0` libadwaita uses, so no version-comparison semantics are implied and
     * `1.0` never matches `1.0.0`.
     */
    releaseNotesVersion?: string;
}

const EMPTY_FIELDS: AppdataFields = {
    applicationId: null,
    applicationName: null,
    developerName: null,
    version: null,
    website: null,
    supportUrl: null,
    issueUrl: null,
    license: null,
    releaseNotes: null,
};

/**
 * How well `lang` answers for `locale`, as a count of matching BCP-47 segments; `0` is no
 * match at all.
 *
 * Ported from `ms_locale_score`, including the property that is easy to get wrong: a
 * mismatch INSIDE a segment scores 0 rather than crediting the segments before it, so
 * `de-DE` against `de-AT` is 0 and against `de` is 1. Anything looser would let a Swiss
 * German string win over the untranslated one for an Austrian user.
 */
export function localeScore(locale: string, lang: string): number {
    let segments = 0;
    for (let i = 0; ; i++) {
        // '\0' stands for "past the end", which is what the C reads there.
        const left = i < locale.length ? locale.charAt(i) : '\0';
        const right = i < lang.length ? lang.charAt(i) : '\0';
        if ((left === '-' || left === '\0') && (right === '-' || right === '\0')) segments++;
        if (left === '\0' || right === '\0') break;
        if (left !== right) return 0;
    }
    return segments;
}

/**
 * The BCP-47 locale AppStream matching uses, from `GLib.get_language_names()` and the
 * environment.
 *
 * Ported from `ms_get_current_locale`, quirks included: the most specific name wins, `LANG`
 * is consulted when that name carries no region (GLib answers `de` for `LANG=de_DE` in some
 * configurations, and a `de-DE` translation must still win there), `.UTF-8` is dropped
 * because AppStream assumes it, and an `@variant` becomes a BCP-47 script subtag.
 */
export function appdataLocale(languageNames: readonly string[], env: { LANG?: string } = {}): string {
    let locale: string | undefined;
    const first = languageNames[0];
    if (first !== undefined && !first.includes('_') && env.LANG !== undefined && env.LANG.includes('_')) {
        locale = env.LANG;
    }
    locale = locale ?? first ?? 'C';
    if (locale.endsWith('.UTF-8')) locale = locale.slice(0, -'.UTF-8'.length);

    let suffix = '';
    const at = locale.indexOf('@');
    if (at >= 0) {
        const variant = locale.slice(at);
        if (variant.startsWith('@cyrillic')) suffix = '-Cyrl';
        else if (variant.startsWith('@devanagari')) suffix = '-Deva';
        else if (variant.startsWith('@latin')) suffix = '-Latn';
        else if (variant.startsWith('@shaw')) suffix = '-Shaw';
        // `@euro` is a currency variant and carries no script; anything else gets the same
        // `-euro` subtag upstream gives it, marked `???` in ministream's own source. Ported
        // rather than corrected, so a locale resolves identically on all three platforms.
        else if (!variant.startsWith('@euro')) suffix = '-euro';
        locale = locale.slice(0, at);
    }
    return locale.replace(/_/g, '-') + suffix;
}

/** One element's extent inside the token array. */
interface ElementSpan {
    name: string;
    attributes: Record<string, string>;
    /** First content token. */
    start: number;
    /** One past the last content token. */
    end: number;
}

/**
 * The IMMEDIATE child elements of a span — never a descendant.
 *
 * Depth matters: `<name>` is also a child of `<developer>` and can appear under
 * `<screenshots>` or `<provides>` in a document nobody controls. A search that ignored depth
 * would answer the application-name question with a screenshot caption on Windows alone.
 */
function childElements(tokens: XmlToken[], from: number, to: number): ElementSpan[] {
    const spans: ElementSpan[] = [];
    let index = from;
    while (index < to) {
        const token = tokens[index];
        if (token.kind !== 'open') {
            index += 1;
            continue;
        }
        const open = token as XmlOpenTag;
        if (open.selfClosing) {
            spans.push({ name: open.name, attributes: open.attributes, start: index + 1, end: index + 1 });
            index += 1;
            continue;
        }
        let depth = 1;
        let cursor = index + 1;
        while (cursor < to && depth > 0) {
            const inner = tokens[cursor];
            if (inner.kind === 'open') {
                if (!(inner as XmlOpenTag).selfClosing) depth += 1;
            } else if (inner.kind === 'close') {
                depth -= 1;
            }
            cursor += 1;
        }
        // An unclosed element runs to the end of its parent rather than being discarded: a
        // truncated metainfo file should cost the fields after the tear, not the ones before.
        const end = depth === 0 ? cursor - 1 : to;
        spans.push({ name: open.name, attributes: open.attributes, start: index + 1, end });
        index = depth === 0 ? cursor : to;
    }
    return spans;
}

/**
 * An element's own character data, child elements excluded.
 *
 * Excluding them is `ms_string_parser`'s behaviour: it warns about a child and swallows the
 * subtree. Trimming is the one deliberate divergence — ministream keeps the surrounding
 * whitespace, and `<name>\n  App\n</name>` is common enough that an About dialog title
 * starting with a newline is a likelier outcome than any use for it.
 */
function elementText(tokens: XmlToken[], span: ElementSpan): string {
    let depth = 0;
    let out = '';
    for (let i = span.start; i < span.end; i++) {
        const token = tokens[i];
        if (token.kind === 'open') {
            if (!(token as XmlOpenTag).selfClosing) depth += 1;
        } else if (token.kind === 'close') {
            depth -= 1;
        } else if (depth === 0) {
            out += token.text;
        }
    }
    return out.trim();
}

/** A translatable field plus the score of the language that currently owns it. */
interface Localized {
    value: string | null;
    score: number;
}

const lang = (span: ElementSpan): string => span.attributes['xml:lang'] ?? 'C';

/**
 * `<name>` / `<developer_name>` selection, as ministream scores it: the untranslated string
 * is taken once, and only a POSITIVE locale score may replace it.
 */
function considerTranslatable(store: Localized, span: ElementSpan, text: string, score: number): void {
    if ((store.value === null && lang(span) === 'C') || score > store.score) {
        store.score = score;
        store.value = text;
    }
}

/** Markup-escape exactly what `g_markup_escape_text` escapes. */
function escapeMarkup(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, '&#39;')
        .replace(/"/g, '&quot;');
}

/**
 * The inline content of one `<p>` or `<li>`, as the markup `Adw.AboutDialog:release-notes`
 * accepts.
 *
 * `<em>` and `<code>` survive; every other element is dropped WITH its text, which is what
 * ministream's skip parser does. Runs of whitespace collapse to a single space and a leading
 * run disappears entirely (`lastWasSpace` starts `true`) — a metainfo file indents its
 * release notes, and passing that indentation through would reach the dialog as it was typed.
 */
function inlineMarkup(tokens: XmlToken[], span: ElementSpan): string {
    let out = '';
    let lastWasSpace = true;
    let skipDepth = 0;
    let depth = 0;
    for (let i = span.start; i < span.end; i++) {
        const token = tokens[i];
        if (token.kind === 'open') {
            const open = token as XmlOpenTag;
            const nested = !open.selfClosing;
            if (nested) depth += 1;
            if (skipDepth > 0) continue;
            if (open.name === 'em' || open.name === 'code') {
                out += `<${open.name}>`;
            } else if (nested) {
                skipDepth = depth;
            }
        } else if (token.kind === 'close') {
            if (skipDepth > 0 && depth === skipDepth) skipDepth = 0;
            else if (skipDepth === 0 && (token.name === 'em' || token.name === 'code')) out += `</${token.name}>`;
            depth -= 1;
        } else if (skipDepth === 0) {
            let chunk = '';
            for (const ch of token.text) {
                if (ch === '\n' || ch === '\t' || ch === ' ') {
                    if (lastWasSpace) continue;
                    chunk += ' ';
                    lastWasSpace = true;
                    continue;
                }
                chunk += ch;
                lastWasSpace = false;
            }
            out += escapeMarkup(chunk);
        }
    }
    return out;
}

/**
 * A `<description>` rendered to markup, one buffer per language, best language wins.
 *
 * Per-language buffers rather than "pick the language, then read it": AppStream interleaves
 * translations paragraph by paragraph (`<p>`, `<p xml:lang="de">`, `<p>`, …), so a reader
 * that chose a language up front would emit the German second paragraph after the English
 * first. `<ul>`/`<ol>` open in EVERY buffer, because the list wraps items of every language.
 */
function parseDescription(tokens: XmlToken[], span: ElementSpan, locale: string): string | null {
    const buckets = new Map<string, string[]>();

    /** The buffer for one language, created on first sight; `null` when the locale rejects it. */
    const bucketFor = (language: string, openList?: string): string[] | null => {
        if (localeScore(locale, language) === 0 && language !== 'C') return null;
        let bucket = buckets.get(language);
        if (bucket === undefined) {
            bucket = [];
            buckets.set(language, bucket);
            // A language first seen INSIDE a list still needs the list opened for it.
            if (openList !== undefined) bucket.push(`<${openList}>\n`);
        }
        return bucket;
    };

    for (const child of childElements(tokens, span.start, span.end)) {
        if (child.name === 'p') {
            bucketFor(lang(child))?.push(`<p>${inlineMarkup(tokens, child)}</p>\n`);
        } else if (child.name === 'ul' || child.name === 'ol') {
            for (const bucket of buckets.values()) bucket.push(`<${child.name}>\n`);
            for (const item of childElements(tokens, child.start, child.end)) {
                if (item.name !== 'li') continue;
                bucketFor(lang(item), child.name)?.push(`<li>${inlineMarkup(tokens, item)}</li>\n`);
            }
            for (const bucket of buckets.values()) bucket.push(`</${child.name}>\n`);
        }
    }

    // `C` is the floor, then the best-scoring language displaces it. Ties keep the earlier
    // one, which is insertion order here and unspecified in the C — no document produces one.
    let best = buckets.get('C');
    let bestScore = 0;
    for (const [language, bucket] of buckets) {
        const score = localeScore(locale, language);
        if (score > bestScore) {
            bestScore = score;
            best = bucket;
        }
    }
    return best === undefined ? null : best.join('');
}

/**
 * Read an AppStream metainfo document.
 *
 * Mirrors `adw_about_dialog_new_from_appdata()`'s `populate_from_appdata`, whose whole field
 * list is: application icon (from `<id>`), application name, developer name, version,
 * website, support url, issue url, licence type, and the release notes of ONE named release.
 * It sets nothing else — no `comments`, no `copyright`, no `translator-credits`, no
 * `developers` — so neither does this.
 *
 * RELEASE ORDER IS THE ONE DIVERGENCE. ministream sorts `<releases>` by a dpkg-style version
 * comparison and reports the highest; this takes the first `<release>` in document order and
 * does not re-implement that comparison. AppStream requires releases to be written
 * newest-first (`appstreamcli validate` reports `releases-not-in-order` otherwise), so the
 * two agree on every valid document — and a caller that will not rely on that passes its own
 * version to `createAboutDialog`, which overrides this on every platform alike.
 */
export function parseAppdata(xml: string, options: ParseAppdataOptions = {}): AppdataFields {
    const locale = options.locale ?? 'C';
    const tokens = scanXml(xml);
    const root = childElements(tokens, 0, tokens.length).find(
        // `<application>` is the legacy root ministream still accepts.
        (span) => span.name === 'component' || span.name === 'application',
    );
    if (root === undefined) return { ...EMPTY_FIELDS };

    const fields: AppdataFields = { ...EMPTY_FIELDS };
    const name: Localized = { value: null, score: 0 };
    const developerName: Localized = { value: null, score: 0 };
    const desktopLaunchables: string[] = [];
    let releases: ElementSpan | null = null;

    for (const child of childElements(tokens, root.start, root.end)) {
        switch (child.name) {
            case 'id':
                // First wins, here and for `project_license` and `releases`: ministream
                // warns about a repeat and ignores it. `<url>` has no such guard, so a
                // repeated one overwrites — the asymmetry is upstream's, not a slip.
                if (fields.applicationId === null) fields.applicationId = elementText(tokens, child);
                break;
            case 'name':
                considerTranslatable(name, child, elementText(tokens, child), localeScore(locale, lang(child)));
                break;
            case 'developer':
                for (const inner of childElements(tokens, child.start, child.end)) {
                    if (inner.name !== 'name') continue;
                    // +1024 is ministream's own shift, so `<developer><name>` always outranks
                    // the legacy `<developer_name>` however well the latter matches. The
                    // second half of the condition is what stops a NON-matching translation
                    // (score 1024 exactly) from displacing the untranslated name.
                    const score = localeScore(locale, lang(inner)) + 1024;
                    if (score > developerName.score && (lang(inner) === 'C' || score > 1024)) {
                        developerName.score = score;
                        developerName.value = elementText(tokens, inner);
                    }
                }
                break;
            case 'developer_name':
                considerTranslatable(
                    developerName,
                    child,
                    elementText(tokens, child),
                    localeScore(locale, lang(child)),
                );
                break;
            case 'url': {
                const text = elementText(tokens, child);
                if (child.attributes.type === 'homepage') fields.website = text;
                else if (child.attributes.type === 'bugtracker') fields.issueUrl = text;
                else if (child.attributes.type === 'help') fields.supportUrl = text;
                break;
            }
            case 'launchable':
                if (child.attributes.type === 'desktop-id') desktopLaunchables.push(elementText(tokens, child));
                break;
            case 'project_license':
                if (fields.license === null) fields.license = elementText(tokens, child);
                break;
            case 'releases':
                if (releases === null) releases = child;
                break;
            default:
                break;
        }
    }

    fields.applicationName = name.value;
    fields.developerName = developerName.value;

    if (releases !== null) {
        const entries = childElements(tokens, releases.start, releases.end).filter((span) => span.name === 'release');
        fields.version = entries[0]?.attributes.version ?? null;
        const wanted = options.releaseNotesVersion;
        if (wanted !== undefined && wanted !== '') {
            const match = entries.find((span) => span.attributes.version === wanted);
            const description =
                match && childElements(tokens, match.start, match.end).find((s) => s.name === 'description');
            if (description) fields.releaseNotes = parseDescription(tokens, description, locale);
        }
    }

    if (fields.applicationId !== null && fields.applicationId.endsWith('.desktop')) {
        // Upstream's rule, transcribed rather than reasoned about: an id ending in
        // `.desktop` loses that suffix UNLESS a `<launchable type="desktop-id">` names
        // `<id>.desktop` — i.e. unless the `.desktop` is genuinely part of the id.
        if (!desktopLaunchables.includes(`${fields.applicationId}.desktop`)) {
            fields.applicationId = fields.applicationId.slice(0, -'.desktop'.length);
        }
    }

    // An element that is present but empty is the same answer as an absent one for every
    // consumer here, and collapsing it means `about-dialog.ts` needs one test per field
    // instead of two.
    for (const key of Object.keys(fields) as (keyof AppdataFields)[]) {
        if (fields[key] === '') fields[key] = null;
    }
    return fields;
}
