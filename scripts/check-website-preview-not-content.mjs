#!/usr/bin/env node
// Adwaita markup the WEBSITE mounts inside Starlight prose must opt out of the
// prose layout, and this holds the line.
//
// Starlight puts `margin-top: 1rem` on every element that FOLLOWS a sibling
// inside `.sl-markdown-content`, exempting only `:where(.not-content *)`. That
// is right for paragraphs and wrong for a widget, and when it reaches one the
// damage never looks like a margin bug, which is why it kept being
// rediscovered by eye instead of by a check:
//
//   · Buttons in a gallery card: the first sat 8px above its own row, because it
//     alone had no margin-top while its three neighbours had 16px.
//   · A header bar: the trailing button was pushed below its own title.
//   · The coverage dashboards: every row after the first gained 16px, so a boxed
//     list rendered as a column of floating cards. Reported as "this does not
//     look like Adwaita", which is exactly what it looked like.
//
// Six components were fixed by hand in one pass and two were missed in the same
// pass (`BridgesGrid`, `IntegrationTests`), and a component-by-component sweep is
// precisely the thing that cannot be trusted to be complete. The reason a CSS
// rule cannot replace the `not-content` marker is in `website/src/styles/
// custom.css`: `adw-*` is a tag-name PREFIX and CSS cannot select one, so any
// general rule would be a hand-listed set of element names that drifts the day
// someone adds a widget. What CAN be automated is noticing the marker is absent,
// which is this.
//
// The rule: an element carrying Adwaita markup (an `<adw-*>` custom element, or
// an `adw-*` class from the site's Adwaita component CSS) must have
// `not-content` on itself or on an ancestor, UNLESS it is the outermost element
// of its file. The carve-out is deliberate, not slack: a component's root is a
// block sitting in prose, and prose flow around a block is what you want. Every
// incident above was an element INSIDE such a root.
//
// A check for a sweep is only worth more than the sweep if its own reader sees
// the whole file, so the parser is fixture-tested on every run (SELF_TESTS at the
// bottom). It has already been green while reading a fraction of the input twice:
//
//   · The first cut asked whether a file CONTAINED the string `not-content`.
//     `AdwGalleryCard.astro` carries an eight-line comment naming the marker and
//     the incident behind it, so deleting the marker from its markup left the
//     check green. Fixed by reading markup instead of text.
//   · The second cut masked `<script>…</script>` before it masked comments, and
//     `AdwWidget.astro` names `<script>` INSIDE a JSX comment. Masking ran from
//     that mention to the file's real `</script>`, which is the last line, so the
//     scanner never saw the `<slot name="preview">` that every widget on every
//     docs page is mounted through. Deleting that component's marker flagged one
//     element instead of the 171 it covers. It also read markup one line
//     at a time, so a tag whose attributes wrap (there are fifteen, five of them
//     `<adw-*>`) was invisible, and its closing tag then popped an ANCESTOR off
//     the open-element stack.
//
//   node scripts/check-website-preview-not-content.mjs

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve, relative } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const tracked = (glob) =>
    execSync(`git ls-files -- ${glob}`, { cwd: ROOT, maxBuffer: 1 << 28 })
        .toString()
        .trim()
        .split('\n')
        .filter(Boolean);

const VOID_TAGS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
]);

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const FENCE_LINE = /^[ \t]*(```|~~~)/;
const RAW_ELEMENT = /^<(style|script)(?=[\s/>])/i;

/**
 * Blank everything a tag scanner must not read as markup: frontmatter, fenced
 * and inline code (the docs quote `<adw-…>` constantly, and those samples are
 * text, not mounted widgets), HTML and JSX comments, and `<style>` / `<script>`
 * bodies. Blanked characters become spaces and newlines are kept, so offsets and
 * line numbers still address the original file.
 *
 * ONE left-to-right pass, not a sequence of global replaces, because a sequence
 * has an ORDER and every order is wrong for some input: whichever construct is
 * masked first will happily start inside one that should have masked it. That is
 * not hypothetical, it is how this check came to read two thirds of
 * `AdwWidget.astro` as empty (see the header).
 */
export function maskNonMarkup(source) {
    const n = source.length;
    const out = source.split('');
    const blank = (from, to) => {
        for (let k = from; k < Math.min(to, n); k++) if (out[k] !== '\n') out[k] = ' ';
    };

    let i = 0;
    const front = FRONTMATTER.exec(source);
    if (front) {
        blank(0, front[0].length);
        i = front[0].length;
    }

    let inFence = false;
    while (i < n) {
        if (i === 0 || source[i - 1] === '\n') {
            const eol = source.indexOf('\n', i);
            const lineEnd = eol === -1 ? n : eol;
            if (FENCE_LINE.test(source.slice(i, lineEnd)) || inFence) {
                if (FENCE_LINE.test(source.slice(i, lineEnd))) inFence = !inFence;
                blank(i, lineEnd);
                // Past the newline, not onto it: an empty line inside a fence has
                // `lineEnd === i`, and stopping there advances nothing.
                i = lineEnd + 1;
                continue;
            }
        }

        const c = source[i];
        if (c === '\n') {
            i++;
            continue;
        }

        if (source.startsWith('<!--', i)) {
            const from = i;
            const end = source.indexOf('-->', i);
            i = end === -1 ? n : end + 3;
            blank(from, i);
            continue;
        }

        if (source.startsWith('{/*', i)) {
            const from = i;
            const end = source.indexOf('*/}', i);
            i = end === -1 ? n : end + 3;
            blank(from, i);
            continue;
        }

        const raw = RAW_ELEMENT.exec(source.slice(i, i + 8));
        if (raw) {
            const from = i;
            const close = new RegExp(`</${raw[1]}\\s*>`, 'i').exec(source.slice(i));
            i = close ? i + close.index + close[0].length : n;
            blank(from, i);
            continue;
        }

        // Inline code: `<adw-switch-row>` in prose is a quotation, not an element.
        // An unpaired backtick blanks only itself, so a stray one in a comment or
        // a template literal cannot swallow the markup after it.
        if (c === '`') {
            const eol = source.indexOf('\n', i);
            const limit = eol === -1 ? n : eol;
            const end = source.indexOf('`', i + 1);
            const to = end !== -1 && end < limit ? end + 1 : i + 1;
            blank(i, to);
            i = to;
            continue;
        }

        i++;
    }

    return out.join('');
}

const ADW_CLASS = /(^|\s)adw-[a-z0-9-]+/;
// The unquoted stretch of a tag excludes `<` as well as `>`, which bounds the
// damage a false start can do. `{n<items.length ? 'a' : 'b'}` in a template opens
// what looks like a tag named `items.length`; allowing `<` inside it, the match
// runs on to the NEXT tag's `>` and swallows that tag whole. Excluding `<` makes
// the bogus match fail at the following `<` instead, so the real tag is still read.
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9._:-]*)((?:"[^"]*"|'[^']*'|`[^`]*`|[^<>"'`])*?)(\/?)>/g;

/**
 * Read one attribute off a tag, in any of the three shapes Astro accepts:
 * quoted, bare, or a `{…}` expression. The expression form needs balanced braces
 * rather than "up to the first `}`", because the class the site cares about is
 * written `class:list={['adw-widget-preview', 'not-content', `is-${padding}`]}`
 * and the first `}` in that is the one closing `${padding}`.
 */
function attrValue(attrs, name) {
    const at = new RegExp(`(^|\\s)${name}\\s*=\\s*`, 'i').exec(attrs);
    if (!at) return null;
    let i = at.index + at[0].length;
    const opener = attrs[i];
    if (opener === '"' || opener === "'") {
        const end = attrs.indexOf(opener, i + 1);
        return attrs.slice(i + 1, end === -1 ? undefined : end);
    }
    if (opener !== '{') return '';
    let depth = 0;
    for (let j = i; j < attrs.length; j++) {
        if (attrs[j] === '{') depth++;
        else if (attrs[j] === '}' && --depth === 0) return attrs.slice(i + 1, j);
    }
    return attrs.slice(i + 1);
}

/**
 * The class names a tag carries, as a whitespace-separated string. An expression
 * value is reduced to its identifier-ish tokens: `['a', 'not-content']` has to
 * come out as `a not-content`, not as `'a', 'not-content',` where nothing splits
 * on whitespace into a bare class name.
 */
const classOf = (attrs) => {
    const raw = attrValue(attrs, 'class:list') ?? attrValue(attrs, 'class');
    if (raw === null) return '';
    return /^[\w\s-]*$/.test(raw) ? raw : raw.replace(/[^\w-]+/g, ' ');
};

// A widget element carries the prefix of the library that owns its GType (ADR 0034
// clause 1), so `<gtk-entry>` is adwaita-web markup exactly as `<adw-action-row>` is.
// The CSS half stays `adw-` and is a different question: `.adw-button` is the Adwaita
// SKIN on a plain `<button>`, which is why the class test is spelled separately.
const WIDGET_TAG = /^(?:adw|gtk)-/;
const isAdwaitaMarkup = (tag, cls) => WIDGET_TAG.test(tag) || ADW_CLASS.test(cls);

function importsOf(source) {
    const map = new Map();
    for (const m of source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/g)) {
        map.set(m[1], m[2]);
    }
    return map;
}

const lineIndex = (text) => {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    return (offset) => {
        let lo = 0;
        let hi = starts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= offset) lo = mid;
            else hi = mid - 1;
        }
        return lo + 1;
    };
};

/**
 * Walk one file's markup. Returns the unmarked Adwaita elements it holds, plus
 * whether every `<slot>` in it sits under `not-content`, which is what decides
 * the question its CALLERS ask: is markup passed into this component covered?
 *
 * `resolveComponent` maps a capitalised tag to the scan of the file it is
 * imported from, or to null when that is not a file this check reads. Passing it
 * in is what lets the fixture tests drive the same walker without a filesystem.
 */
function scanMarkup(file, source, resolveComponent) {
    const text = maskNonMarkup(source);
    const lineOf = lineIndex(text);
    const result = { findings: [], slotsCovered: true };

    /** @type {{tag: string, covered: boolean}[]} */
    const stack = [];

    for (const m of text.matchAll(TAG)) {
        const [, closing, rawTag, attrs, selfClosing] = m;
        const tag = rawTag.toLowerCase();

        if (closing) {
            const at = stack.map((e) => e.tag).lastIndexOf(tag);
            if (at >= 0) stack.length = at;
            continue;
        }

        const cls = classOf(attrs);
        const self = Boolean(selfClosing) || VOID_TAGS.has(tag);
        // Children of a component are slotted into ITS markup, so the marker they
        // need may live there.
        const slotted = /^[A-Z]/.test(rawTag) ? resolveComponent(rawTag) : undefined;
        const covered =
            stack.some((e) => e.covered) ||
            cls.split(/\s+/).includes('not-content') ||
            (slotted !== undefined && (slotted === null || slotted.slotsCovered));

        if (tag === 'slot' && !covered) result.slotsCovered = false;

        // Depth 0 is the file's own outermost element: a block in prose flow,
        // where a prose margin is correct. Everything below it is layout the
        // component owns.
        if (stack.length > 0 && !covered && isAdwaitaMarkup(tag, cls)) {
            result.findings.push({
                file,
                line: lineOf(m.index),
                element: cls ? `<${rawTag} class="${cls.trim()}">` : `<${rawTag}>`,
            });
        }

        if (!self) stack.push({ tag, covered });
    }

    return result;
}

const scanCache = new Map();
const scanning = new Set();

function scan(file) {
    const path = resolve(ROOT, file);
    if (scanCache.has(path)) return scanCache.get(path);
    // A cycle can only be an import loop, which is the bundler's complaint, not ours.
    if (scanning.has(path)) return { findings: [], slotsCovered: true };
    scanning.add(path);

    let source;
    try {
        source = readFileSync(path, 'utf8');
    } catch {
        // Unreadable = not ours to judge: a Starlight built-in, a virtual module.
        scanning.delete(path);
        const unknown = { findings: [], slotsCovered: true };
        scanCache.set(path, unknown);
        return unknown;
    }

    const importMap = importsOf(source);
    const result = scanMarkup(file, source, (rawTag) => {
        const spec = importMap.get(rawTag);
        if (spec === undefined) return undefined;
        // A component from a package rather than a relative path is not ours to read.
        return spec.startsWith('.') ? scan(relative(ROOT, resolve(dirname(path), spec))) : null;
    });

    scanning.delete(path);
    scanCache.set(path, result);
    return result;
}

/**
 * Fixtures the walker must agree with before it is allowed to report on the real
 * tree. Each one is a shape that has already made this check pass while reading
 * nothing, so a green run without them proves less than it looks like.
 */
const SELF_TESTS = [
    {
        name: 'a <script> named inside a JSX comment does not swallow the rest of the file',
        source: [
            '<div class="widget">',
            '  {/* mounted at runtime, see <script> below */}',
            '  <gtk-button></gtk-button>',
            '</div>',
            '<script>',
            '  const swallowed = 1;',
            '</script>',
        ].join('\n'),
        expect: ['<gtk-button>'],
    },
    {
        name: 'a tag whose attributes wrap over several lines is still read',
        source: ['<div class="widget">', '  <gtk-button', '    label="Open"', '  ></gtk-button>', '</div>'].join('\n'),
        expect: ['<gtk-button>'],
    },
    {
        name: 'a wrapped container carrying the marker covers its children and nothing beyond them',
        source: [
            '<div class="widget">',
            '  <div',
            "    class:list={['panel', 'not-content', `is-${padding}`]}",
            '  >',
            '    <gtk-button></gtk-button>',
            '  </div>',
            '  <adw-switch-row></adw-switch-row>',
            '</div>',
        ].join('\n'),
        expect: ['<adw-switch-row>'],
    },
    {
        name: 'quoted markup is a quotation, not a mounted widget',
        source: [
            '<div class="widget">',
            '',
            '```html',
            '<gtk-button></gtk-button>',
            '```',
            '',
            'Use `<adw-switch-row>` for a toggle.',
            '</div>',
        ].join('\n'),
        expect: [],
    },
    {
        name: "a file's outermost element is a block in prose flow, which is what prose margins are for",
        source: '<adw-status-page title="Empty"></adw-status-page>',
        expect: [],
    },
    {
        name: 'a comparison in a template expression does not swallow the tag after it',
        source: [
            '<div class="widget">',
            "  {n<items.length ? 'more' : 'done'}",
            '  <gtk-button></gtk-button>',
            '</div>',
        ].join('\n'),
        expect: ['<gtk-button>'],
    },
    {
        name: 'markup handed to a component is covered only when that component marks its own slot',
        source: '<div class="page">\n  <Card>\n    <gtk-button></gtk-button>\n  </Card>\n</div>',
        resolve: () => ({ slotsCovered: false }),
        expect: ['<gtk-button>'],
    },
    {
        name: 'and it is covered once that component does mark it',
        source: '<div class="page">\n  <Card>\n    <gtk-button></gtk-button>\n  </Card>\n</div>',
        resolve: () => ({ slotsCovered: true }),
        expect: [],
    },
];

for (const t of SELF_TESTS) {
    const got = scanMarkup('fixture', t.source, t.resolve ?? (() => null)).findings.map((f) => f.element);
    const want = t.expect;
    if (got.length !== want.length || got.some((g, i) => !g.startsWith(want[i].slice(0, -1)))) {
        process.stderr.write(
            `check-website-preview-not-content: its own parser is broken, so it proves nothing about the site.\n` +
                `  fixture: ${t.name}\n  expected: ${JSON.stringify(want)}\n  got:      ${JSON.stringify(got)}\n`,
        );
        process.exit(2);
    }
}

const findings = [];
for (const file of tracked('website/src').filter((f) => /\.(astro|mdx)$/.test(f))) {
    findings.push(...scan(file).findings);
}

if (findings.length === 0) {
    process.stdout.write(
        'check-website-preview-not-content: every Adwaita element the website mounts is under `not-content`.\n',
    );
    process.exit(0);
}

process.stderr.write(
    `check-website-preview-not-content: ${findings.length} Adwaita element(s) are laid out as prose.\n` +
        '  Starlight gives each one `margin-top: 1rem` because it FOLLOWS a sibling, so rows drift\n' +
        '  apart by 16px and the first item of a row sits 8px out of line with the rest.\n' +
        '  Put `not-content` on the container the component mounts them into.\n\n',
);
for (const f of findings) process.stderr.write(`  ${relative('.', f.file)}:${f.line}  ${f.element}\n`);
process.exit(1);
