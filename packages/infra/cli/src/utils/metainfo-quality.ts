// Flathub quality guidelines for an AppStream MetaInfo file, as a pure function.
//
// Source of truth: https://docs.flathub.org/docs/for-app-authors/metainfo-guidelines/quality-guidelines
// `appstreamcli validate` answers "is this file VALID"; Flathub's curation asks "is this listing
// GOOD" (name length, summary wording, branding colours, screenshot captions, release notes), and
// no linter on the PATH answers that. This module is the second question, so `gjsify flatpak check`
// runs it beside the first instead of replacing it.
//
// Pure TypeScript on purpose — no `node:*` import, no spawn, no GI — so the same rules run under
// Node and GJS, in the unit suite and in an app's CI. The two things that need the file system or
// the network (image dimensions) arrive through an injected {@link ImageProbe}; a probe that cannot
// answer returns `null` and the rule is skipped, never failed: an unreachable screenshot is not a
// bad screenshot.
//
// Severity follows the page's own wording: `must` / "no longer than" limits are errors, everything
// phrased as "should", "avoid" or "ideally" is a warning. `--strict` in the caller promotes warnings.

import { scanXml } from '@gjsify/utils/core';

export type QualitySeverity = 'error' | 'warning';

export interface QualityFinding {
    /** Stable rule id, e.g. `summary-too-long`. */
    rule: string;
    severity: QualitySeverity;
    message: string;
    /** Where in the document: `name[de]`, `screenshot[2]/caption`, `release 1.0.0`. */
    location: string;
    /** Link to the guideline anchor the rule comes from. */
    url: string;
}

export type ImageInfo = { kind: 'svg' } | { kind: 'raster'; width: number; height: number };

/** Resolve an image reference (URL or path) to its dimensions; `null` = cannot tell. */
export type ImageProbe = (ref: string) => Promise<ImageInfo | null>;

export interface QualityOptions {
    /** Terms a summary must not contain (case-insensitive, whole word). Replaces the default list. */
    technicalTerms?: string[];
    /** Candidate references for the app icon, tried in order; the first the probe answers for wins. */
    iconRefs?: string[];
    probeImage?: ImageProbe;
}

const GUIDELINES = 'https://docs.flathub.org/docs/for-app-authors/metainfo-guidelines/quality-guidelines';

/** Words that tell a non-developer nothing: toolkit, language, licence, and generic nouns. */
export const DEFAULT_TECHNICAL_TERMS: readonly string[] = [
    'GTK',
    'GTK3',
    'GTK4',
    'Qt',
    'Qt5',
    'Qt6',
    'libadwaita',
    'Electron',
    'Rust',
    'Python',
    'JavaScript',
    'TypeScript',
    'GJS',
    'Flatpak',
    'written in',
    'open source',
    'open-source',
    'free software',
    'FOSS',
    'app',
    'application',
    'tool',
    'client',
    'wrapper',
    'App',
    'Anwendung',
    'Werkzeug',
];

const GENERIC_RELEASE_NOTES: RegExp[] = [
    /^(minor |various |general |misc(ellaneous)? )?bug ?fix(es)?( (and|&) (minor )?(performance )?(improvements?|fixes|tweaks))?$/i,
    /^(minor |various |general )?(performance )?improvements?( (and|&) (bug ?fix(es)?|fixes))?$/i,
    /^bug ?fix(es)?,? (and )?(performance|stability) improvements?$/i,
    /^(performance|stability) (improvements?|fixes)( (and|&) bug ?fix(es)?)?$/i,
    /^(fehlerbehebungen?|fehlerkorrekturen?|verbesserungen)( (und|&) (fehlerbehebungen?|verbesserungen|leistungsverbesserungen))?$/i,
    /^(kleinere )?(fehlerbehebungen|verbesserungen)$/i,
];

const ARTICLES: Record<string, string[]> = {
    en: ['a', 'an', 'the'],
    de: ['ein', 'eine', 'einen', 'einem', 'einer', 'der', 'die', 'das', 'den', 'dem'],
};

// ── Tiny element tree over the scanner's token stream ───────────────────────

interface Node {
    name: string;
    attrs: Record<string, string>;
    children: Node[];
    text: string;
}

/** Strip the legacy intltool `_` prefix (`<_summary>`), which `.metainfo.xml.in` files still use. */
const normName = (name: string): string => (name.startsWith('_') ? name.slice(1) : name);

function buildTree(xml: string): Node {
    const root: Node = { name: '#root', attrs: {}, children: [], text: '' };
    const stack: Node[] = [root];
    for (const token of scanXml(xml)) {
        const top = stack[stack.length - 1];
        if (token.kind === 'text') {
            for (const node of stack) node.text += token.text;
        } else if (token.kind === 'open') {
            const node: Node = { name: normName(token.name), attrs: token.attributes, children: [], text: '' };
            top.children.push(node);
            if (!token.selfClosing) stack.push(node);
        } else if (stack.length > 1) {
            stack.pop();
        }
    }
    return root;
}

const child = (node: Node | undefined, name: string): Node | undefined => node?.children.find((c) => c.name === name);
const kids = (node: Node | undefined, name: string): Node[] => node?.children.filter((c) => c.name === name) ?? [];
const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();
const lang = (node: Node): string => node.attrs['xml:lang'] ?? '';
const langBase = (code: string): string => code.split(/[_\-.@]/)[0].toLowerCase();

/** Every localisation of a child element, keyed by `xml:lang` (`''` = the source string). */
function localized(parent: Node | undefined, name: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const node of kids(parent, name)) {
        const text = clean(node.text);
        if (text !== '' && !out.has(lang(node))) out.set(lang(node), text);
    }
    return out;
}

// ── Colour helpers ──────────────────────────────────────────────────────────

interface Hsl {
    s: number;
    l: number;
}

function parseHex(value: string): Hsl | null {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
    if (m === null) return null;
    let hex = m[1];
    if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
    const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
    const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
    const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return { s, l };
}

// ── Image size parsing (PNG + JPEG; both are what screenshots are) ───────────

/** Dimensions or SVG-ness from the first bytes of an image file. `null` = unknown format. */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
    if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        const u32 = (o: number): number =>
            ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
        return { kind: 'raster', width: u32(16), height: u32(20) };
    }
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        let o = 2;
        while (o + 9 < bytes.length) {
            if (bytes[o] !== 0xff) {
                o++;
                continue;
            }
            const marker = bytes[o + 1];
            if (marker === 0xff) {
                o++;
                continue;
            }
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return {
                    kind: 'raster',
                    height: (bytes[o + 5] << 8) | bytes[o + 6],
                    width: (bytes[o + 7] << 8) | bytes[o + 8],
                };
            }
            o += 2 + ((bytes[o + 2] << 8) | bytes[o + 3]);
        }
        return null;
    }
    let head = '';
    for (let i = 0; i < Math.min(bytes.length, 1024); i++) head += String.fromCharCode(bytes[i]);
    return /<svg[\s>]/.test(head) ? { kind: 'svg' } : null;
}

// ── The rules ───────────────────────────────────────────────────────────────

function termPattern(term: string, flags = 'iu'): RegExp {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, flags);
}

/** Lint one MetaInfo document. Never throws on a malformed file: it reports what it could read. */
export async function lintMetainfo(xml: string, options: QualityOptions = {}): Promise<QualityFinding[]> {
    const findings: QualityFinding[] = [];
    const add = (rule: string, severity: QualitySeverity, anchor: string, location: string, message: string): void => {
        findings.push({ rule, severity, message, location, url: `${GUIDELINES}#${anchor}` });
    };

    const component = child(buildTree(xml), 'component');
    if (component === undefined) {
        add('no-component', 'error', 'app-name', 'document', 'no <component> element found');
        return findings;
    }

    const loc = (field: string, code: string): string => (code === '' ? field : `${field}[${code}]`);
    const names = localized(component, 'name');
    const summaries = localized(component, 'summary');

    // App name ---------------------------------------------------------------
    for (const [code, name] of names) {
        const where = loc('name', code);
        const length = [...name].length;
        if (length >= 20) {
            add(
                'name-too-long',
                'error',
                'not-too-long',
                where,
                `"${name}" is ${length} characters; a name must be shorter than 20`,
            );
        } else if (length > 15) {
            add('name-long', 'warning', 'not-too-long', where, `"${name}" is ${length} characters; ideally at most 15`);
        }
        if (
            /\s[-–—:]\s|:\s|\(.+\)/.test(name) ||
            (/\b(web browser|editor|client|viewer|player)$/i.test(name) && name.includes(' '))
        ) {
            add(
                'name-extra-info',
                'warning',
                'just-the-name',
                where,
                `"${name}" carries a description; keep just the name and put the rest in the summary`,
            );
        } else if (/[.-]/.test(name)) {
            add(
                'name-formatting',
                'warning',
                'no-weird-formatting',
                where,
                `"${name}" contains a dot or dash; avoid punctuation in names`,
            );
        } else if (/\p{L}/u.test(name)) {
            const letters = name.replace(/[^\p{L}]/gu, '');
            if (name === name.toLowerCase()) {
                add('name-formatting', 'warning', 'no-weird-formatting', where, `"${name}" is all lowercase`);
            } else if (letters.length > 1 && name === name.toUpperCase()) {
                add(
                    'name-formatting',
                    'warning',
                    'no-weird-formatting',
                    where,
                    `"${name}" is all uppercase (exempt only for an established brand such as VLC)`,
                );
            } else if (!/\s/.test(name) && /\p{Ll}\p{Lu}/u.test(name)) {
                add('name-formatting', 'warning', 'no-weird-formatting', where, `"${name}" is camel/pascal case`);
            }
        }
    }

    // Summary ----------------------------------------------------------------
    const terms = (options.technicalTerms ?? [...DEFAULT_TECHNICAL_TERMS]).map((term) => ({
        term,
        re: termPattern(term),
    }));
    for (const [code, summary] of summaries) {
        const where = loc('summary', code);
        const length = [...summary].length;
        if (length > 35) {
            add(
                'summary-too-long',
                'error',
                'not-too-long-1',
                where,
                `"${summary}" is ${length} characters; at most 35 allowed`,
            );
        } else if (length > 25 || length < 10) {
            add(
                'summary-length',
                'warning',
                'not-too-long-1',
                where,
                `"${summary}" is ${length} characters; ideal is 10 to 25`,
            );
        }
        if (/[.。]$/.test(summary)) {
            add(
                'summary-full-stop',
                'warning',
                'no-weird-formatting-1',
                where,
                'a summary does not end with a full stop',
            );
        }
        const words = summary.split(/\s+/).filter((w) => /^\p{L}/u.test(w));
        const capitalised = words.filter((w) => /^\p{Lu}/u.test(w)).length;
        if (words.length >= 3 && capitalised / words.length >= 0.75) {
            add('summary-title-case', 'warning', 'no-weird-formatting-1', where, 'use sentence case, not Title Case');
        }
        const articles = ARTICLES[langBase(code === '' ? 'en' : code)];
        const first = summary.split(/\s+/)[0]?.toLowerCase();
        if (articles?.includes(first)) {
            add(
                'summary-article',
                'warning',
                'dont-start-with-an-article',
                where,
                `starts with the article "${first}"; omit it or phrase it with a verb`,
            );
        }
        const name = names.get(code) ?? names.get('');
        if (name !== undefined && [...name].length >= 3 && termPattern(name, 'u').test(summary)) {
            add('summary-repeats-name', 'warning', 'dont-repeat-the-name', where, `repeats the app name "${name}"`);
        }
        const hit = terms.find(({ re }) => re.test(summary));
        if (hit !== undefined) {
            add(
                'summary-technical',
                'warning',
                'not-technical',
                where,
                `mentions "${hit.term}"; say what the app does for people, not how it is built`,
            );
        }
    }

    // Description ------------------------------------------------------------
    const description = kids(component, 'description').find((d) => lang(d) === '') ?? child(component, 'description');
    if (description !== undefined) {
        const summary = summaries.get('') ?? '';
        const paragraphs = kids(description, 'p')
            .filter((p) => lang(p) === '')
            .map((p) => clean(p.text));
        const body = paragraphs.join(' ');
        if (
            summary !== '' &&
            paragraphs.length > 0 &&
            paragraphs[0].replace(/[.!]$/, '').toLowerCase() === summary.toLowerCase()
        ) {
            add(
                'description-repeats-summary',
                'warning',
                'dont-repeat-the-summary',
                'description',
                'the first paragraph repeats the summary',
            );
        }
        if (summary !== '' && [...body].length < Math.max(80, 3 * [...summary].length)) {
            add(
                'description-short',
                'warning',
                'not-too-short',
                'description',
                `${[...body].length} characters; it should be substantially longer than the summary`,
            );
        }
        for (const list of [...kids(description, 'ul'), ...kids(description, 'ol')]) {
            const items = kids(list, 'li').filter((li) => lang(li) === '').length;
            if (items > 10) {
                add(
                    'description-long-list',
                    'warning',
                    'no-super-long-lists',
                    'description',
                    `a list with ${items} items; group them or use paragraphs (max 10)`,
                );
            }
        }
    }

    // Branding ---------------------------------------------------------------
    const colors = kids(child(component, 'branding'), 'color').filter((c) => c.attrs.type === 'primary');
    const light = colors.find((c) => c.attrs.scheme_preference === 'light');
    const dark = colors.find((c) => c.attrs.scheme_preference === 'dark');
    if (light === undefined || dark === undefined) {
        add(
            'branding-missing',
            'warning',
            'has-primary-brand-colors',
            'branding',
            'set two primary brand colors, scheme_preference="light" and "dark"',
        );
    } else {
        const lightText = clean(light.text).toLowerCase();
        const darkText = clean(dark.text).toLowerCase();
        if (lightText === darkText) {
            add(
                'branding-identical',
                'warning',
                'good-brand-colors',
                'branding',
                'light and dark primary colors are the same',
            );
        }
        const l = parseHex(lightText);
        const d = parseHex(darkText);
        for (const [scheme, hsl, text] of [
            ['light', l, lightText],
            ['dark', d, darkText],
        ] as const) {
            if (hsl !== null && (hsl.s < 0.15 || hsl.l > 0.93 || hsl.l < 0.07)) {
                add(
                    'branding-dull',
                    'warning',
                    'good-brand-colors',
                    `branding/${scheme}`,
                    `${text} is near white, black or gray; brand colors should be colorful`,
                );
            }
        }
        if (l !== null && d !== null && lightText !== darkText && d.l >= l.l) {
            add(
                'branding-dark-not-darker',
                'warning',
                'good-brand-colors',
                'branding/dark',
                'the dark variant should be darker than the light one',
            );
        }
    }

    // Icon -------------------------------------------------------------------
    if (options.probeImage !== undefined) {
        for (const ref of options.iconRefs ?? []) {
            const info = await options.probeImage(ref);
            if (info === null) continue;
            if (info.kind === 'raster') {
                if (info.width !== info.height) {
                    add(
                        'icon-not-square',
                        'error',
                        'icon-size',
                        'icon',
                        `${ref} is ${info.width}×${info.height}; the icon has to be square`,
                    );
                } else if (info.width < 256) {
                    add(
                        'icon-too-small',
                        'error',
                        'icon-size',
                        'icon',
                        `${ref} is ${info.width}×${info.height}; use SVG or at least 256×256`,
                    );
                }
            }
            break;
        }
    }

    // Screenshots ------------------------------------------------------------
    const shots = kids(child(component, 'screenshots'), 'screenshot');
    if (shots.length === 0) {
        add(
            'screenshot-missing',
            'warning',
            'at-least-one-screenshot',
            'screenshots',
            'at least one screenshot is expected',
        );
    } else {
        // A screenshot with an untagged image plus `<image xml:lang="de">` twins is English: the
        // twins are alternatives, and the untagged one is what a non-German user sees.
        const englishTag = (t: string): boolean => t === '' || langBase(t) === 'en';
        const isEnglish = (s: Node): boolean => {
            const images = kids(s, 'image').map(lang);
            return englishTag(lang(s)) && (images.length === 0 || images.some(englishTag));
        };
        if (!shots.some(isEnglish)) {
            add(
                'screenshot-no-english',
                'warning',
                'at-least-one-screenshot',
                'screenshots',
                'no screenshot without xml:lang (or in English)',
            );
        }
        if (shots[0].attrs.type !== 'default') {
            add(
                'screenshot-default-not-first',
                'warning',
                'at-least-one-screenshot',
                'screenshot[1]',
                'the first screenshot should be type="default" — it is the one users see first',
            );
        }
        for (let i = 0; i < shots.length; i++) {
            const shot = shots[i];
            const where = `screenshot[${i + 1}]`;
            const captions = kids(shot, 'caption');
            if (captions.length === 0) {
                add('screenshot-caption-missing', 'warning', 'image-captions', where, 'no <caption>');
            }
            for (const caption of captions) {
                const text = clean(caption.text);
                const at = `${where}/${loc('caption', lang(caption))}`;
                if (/[.。]$/.test(text))
                    add(
                        'caption-full-stop',
                        'warning',
                        'image-captions',
                        at,
                        'a caption does not end with a full stop',
                    );
                if (/^\d/.test(text))
                    add(
                        'caption-starts-with-number',
                        'warning',
                        'image-captions',
                        at,
                        'a caption does not start with a number',
                    );
                if (/[.!?]\s+\p{Lu}/u.test(text))
                    add('caption-multiple-sentences', 'warning', 'image-captions', at, 'a caption is one sentence');
            }
            if (options.probeImage !== undefined) {
                const source = kids(shot, 'image').find((img) => (img.attrs.type ?? 'source') === 'source');
                const ref = source === undefined ? '' : clean(source.text);
                const info = ref === '' ? null : await options.probeImage(ref);
                if (info?.kind === 'raster' && (info.width > 2000 || info.height > 1400)) {
                    add(
                        'screenshot-too-large',
                        'warning',
                        'reasonable-window-size',
                        where,
                        `${info.width}×${info.height}; keep the window at most 1000×700 (2000×1400 on HiDPI)`,
                    );
                }
            }
        }
    }

    // Releases ---------------------------------------------------------------
    for (const release of kids(child(component, 'releases'), 'release')) {
        const where = `release ${release.attrs.version ?? '?'}`;
        const notes = child(release, 'description');
        const text = notes === undefined ? '' : clean(notes.text);
        if (text === '') {
            add('release-notes-missing', 'warning', 'release-notes-for-every-release', where, 'no release notes');
            continue;
        }
        if (GENERIC_RELEASE_NOTES.some((re) => re.test(text.replace(/[.!]+$/, '')))) {
            add(
                'release-notes-generic',
                'warning',
                'no-bug-fixes-and-performance-improvements',
                where,
                `"${text}" says nothing about what changed`,
            );
        } else if ([...text].length > 600 || kids(child(notes, 'ul'), 'li').length > 10) {
            add(
                'release-notes-long',
                'warning',
                'short-but-informative',
                where,
                'release notes are long; summarise what changed for users',
            );
        }
    }

    return findings;
}

/** Counts after `--strict`, which promotes every warning to an error. */
export function summarizeFindings(findings: QualityFinding[], strict: boolean): { errors: number; warnings: number } {
    let errors = 0;
    let warnings = 0;
    for (const f of findings) {
        if (f.severity === 'error' || strict) errors++;
        else warnings++;
    }
    return { errors, warnings };
}

/** One line per finding: `error name-too-long name: message (link)`. */
export function formatFinding(f: QualityFinding, strict: boolean): string {
    const severity = strict ? 'error' : f.severity;
    return `${severity.padEnd(7)} ${f.rule}  ${f.location}: ${f.message}\n        ${f.url}`;
}
