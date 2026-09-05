#!/usr/bin/env node
// The Adwaita gallery's attribute table reads REAL VALUES off preview markup, and
// nothing held the reader that does it.
//
// THE INCIDENT
//
// `sampleAttributes()` shipped inside `website/src/components/AdwWidget.astro` — the
// one .astro file `.oxlintrc.json` ignores, because oxlint's reader takes a `<script>`
// inside a JSX comment there as a real opener and stops parsing. So a hand-rolled HTML
// scanner sat in the only website file no linter reads, with no test, feeding a column
// the page presents as fact. Three of its answers were wrong on the SHIPPED site
// before this gate existed:
//
//   · `<adw-shortcut-label accelerator="&lt;Control&gt;C">` printed `&lt;Control&gt;C`
//     in the cell. `getAttribute('accelerator')` returns `<Control>C`. Character
//     references were never decoded, so the column showed source bytes as a value.
//   · `accelerator=""` resolved to a value of `''` and rendered a BLANK cell — where
//     the DOM cannot tell `x=""` from a bare `x` at all.
//   · An element inside an HTML COMMENT was scanned like markup, and an unquoted
//     value was reported as a bare attribute — i.e. as "set", losing the value.
//
// A wrong value in that column is worse than no column, because the column's whole
// claim is that it was read off the sample.
//
// WHAT IT CHECKS
//
//   1. FIXTURES, against `parse5`-free expectations written out by hand: the shapes a
//      quote-aware scan can get wrong — `>` inside a value, the other quote character,
//      an unquoted value, a self-closing tag, a repeated name, a tag name that is a
//      prefix of another, a commented-out element, a character reference, an empty
//      value.
//   2. EVERY preview fence the gallery actually ships: the sampled value for each
//      observed attribute occurs, verbatim, in the fence it was read from — after
//      decoding — so a scan that drifts into another element's attributes fails here
//      rather than on the page.
//   3. …and the OTHER direction, which arm 2 is structurally blind to: an attribute the
//      fence WRITES that the element does not observe. Arm 2 walks the observed names, so
//      a name outside that list is not compared to anything — it just never appears in the
//      table, and the page reads as if the preview had not set it. Measured: the
//      `<adw-combo-row>` preview on /adwaita/boxed-lists/ wrote `items` for its whole
//      life, which the row never observed and its `connectedCallback` read anyway; ADR
//      0046 then RENAMED that attribute to `model` and four call sites elsewhere in the
//      tree kept writing `items` into an element that had stopped reading it at all —
//      silently empty widgets, because an attribute is a string and no type sees it.
//      Platform-global names (`slot`, `class`, `aria-*`, …) are excepted, and an element
//      that observes NOTHING is skipped: its attributes are its parent's to read, which is
//      what `<adw-view-switcher-page>` is.
//   4. the same rule on the website's own SCRIPTS, which arm 3 cannot see: it reads
//      markup, and `el.setAttribute('x', …)` is a call. ADR 0048 renamed
//      `<adw-tab-view selected="n">` to `selected-page="<page id>"` and recorded that
//      nothing in `website/` wrote it — measured wrong twice over, because both writers
//      spelled it as a call: `CommandTabs.astro` (the npm/yarn/gjsify tabs, restored from
//      localStorage and mirrored across the page) and `AdwWidget.astro` (every gallery
//      block's implementation tabs). Both became silent no-ops, and neither a type nor
//      arm 3 nor `astro build` could say so. So a binding taken from a custom-element
//      selector is followed to its `set/get/has/removeAttribute` calls, and the name each
//      one passes is held against the same `observedAttributes` list arm 3 uses.
//
// Plain Node over the repo's own files: no install, no build, no astro render.
//
// Usage: node scripts/check-website-attr-samples.mjs [--root <dir>]

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { attributeCells, galleryElementTag, sampleAttributes } from '../website/src/components/attr-sample.mjs';
import { observedAttributes } from './adwaita-elements.mjs';

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : process.argv[rootFlag + 1];
/**
 * The gallery's section directories, one per widget library. Two since ADR 0034 § 1
 * put `Gtk` beside `Adwaita`; this gate counts CELLS across gallery blocks, so a
 * single-directory scan would go green over a set four blocks short of the site's.
 */
const DOCS_SECTIONS = ['adwaita', 'gtk'];
const docsDir = (section) => join(ROOT, 'website/src/content/docs', section);

const failures = [];
const fail = (what, expected, actual) => failures.push(`${what}\n      expected ${expected}\n      actual   ${actual}`);

/**
 * Attribute names an element carries WITHOUT observing them — the arm-3 finding.
 *
 * The exceptions are the two shapes that are not the widget's vocabulary at all: the
 * platform-global names any HTML element takes, and every element that observes nothing,
 * whose attributes belong to whichever parent reads them (`<adw-view-switcher-page>`).
 */
const PLATFORM_GLOBAL = new Set(['slot', 'class', 'id', 'style', 'hidden', 'role', 'tabindex', 'part', 'lang', 'dir']);
/** Whether a name belongs to the WIDGET's vocabulary at all. Shared by arms 3 and 4. */
const isVocabulary = (name) => !PLATFORM_GLOBAL.has(name) && !name.startsWith('data-') && !name.startsWith('aria-');
const unobservedIn = (markup, tag, observed) =>
    [...sampleAttributes(markup, tag).keys()].filter((name) => !observed.includes(name) && isVocabulary(name));

/**
 * `<name>.setAttribute('x', …)` where `<name>` was bound from a custom-element selector,
 * paired with the tag that selector named — the arm-4 finding.
 *
 * Deliberately shallow: one file, one binding statement, direct calls on that binding.
 * A binding that travels through a helper or a field is out of reach and stays so, which
 * is why arm 4 reports how many receivers it RESOLVED — a rule that silently resolves
 * none is the shape this file exists to refuse.
 */
const ELEMENT_BINDING =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?(?:=|\sof\s)[^;]*?\b(?:querySelector(?:All)?|createElement)\s*(?:<[^;()]*>)?\s*\(\s*['"`]\s*([a-z][\w-]*)/g;

function scriptedAttributeWrites(text) {
    const bindings = new Map();
    for (const [, name, tag] of text.matchAll(ELEMENT_BINDING)) {
        // A custom element, i.e. a tag with a hyphen — `div`, `button` and the rest carry
        // no widget vocabulary and are not this rule's business.
        if (tag.includes('-')) bindings.set(name, tag);
    }
    const writes = [];
    for (const [name, tag] of bindings) {
        const call = new RegExp(
            `(?<![\\w$.])${name.replaceAll('$', '\\$')}\\s*[?!]?\\.\\s*(?:set|get|has|remove)Attribute\\s*\\(\\s*(['"\`])([^'"\`]+)\\1`,
            'g',
        );
        for (const [, , attr] of text.matchAll(call)) writes.push({ name, tag, attr });
    }
    return { receivers: bindings, writes };
}

// ---------------------------------------------------------------- 1. fixtures

/** @type {[string, string, string, Record<string, string>][]} name, markup, tag, expected cells */
const FIXTURES = [
    [
        '`>` inside a quoted value',
        `<adw-data-grid columns='[{"cmp":"x>y"}]' rows="2"></adw-data-grid>`,
        'adw-data-grid',
        { columns: '[{"cmp":"x>y"}]', rows: '2' },
    ],
    [
        'the other quote character inside a value',
        `<gtk-button label="it's here" tooltip='say "hi"'></gtk-button>`,
        'gtk-button',
        { label: "it's here", tooltip: 'say "hi"' },
    ],
    [
        'an UNQUOTED value',
        '<gtk-button label=Download can-shrink></gtk-button>',
        'gtk-button',
        {
            label: 'Download',
            'can-shrink': 'set',
        },
    ],
    ['a self-closing tag', '<adw-avatar size="48" text="PG" />', 'adw-avatar', { size: '48', text: 'PG' }],
    [
        'a tag name that is a PREFIX of another tag',
        '<adw-button-content-extra icon-name="wrong"></adw-button-content-extra>' +
            '<adw-button-content label="right"></adw-button-content>',
        'adw-button-content',
        { 'icon-name': 'not used', label: 'right' },
    ],
    [
        'an element inside an HTML COMMENT',
        '<!-- <gtk-button label="commented-out"></gtk-button> -->\n<gtk-button can-shrink></gtk-button>',
        'gtk-button',
        { label: 'not used', 'can-shrink': 'set' },
    ],
    [
        'a name REPEATED on one tag',
        '<gtk-button label="first" label="second"></gtk-button>',
        'gtk-button',
        {
            label: 'first',
        },
    ],
    [
        'CHARACTER REFERENCES in a value',
        '<adw-shortcut-label accelerator="&lt;Control&gt;C &amp; &#x41;"></adw-shortcut-label>',
        'adw-shortcut-label',
        { accelerator: '<Control>C & A' },
    ],
    [
        'an EMPTY value, which the DOM cannot tell from a bare attribute',
        '<gtk-button label=""></gtk-button>',
        'gtk-button',
        {
            label: 'set',
        },
    ],
    ['an UPPERCASE tag', '<GTK-BUTTON LABEL="x"></GTK-BUTTON>', 'gtk-button', { label: 'x' }],
    [
        'the tag inside ANOTHER element, entity-escaped as a reader would write it',
        '<adw-status-page description="use &lt;gtk-button&gt;"></adw-status-page>' +
            '<gtk-button label="real"></gtk-button>',
        'gtk-button',
        { label: 'real' },
    ],
];

for (const [what, markup, tag, expected] of FIXTURES) {
    const names = Object.keys(expected);
    const cells = attributeCells(names, sampleAttributes(markup, tag));
    const got = Object.fromEntries(cells.map((c) => [c.name, c.text]));
    for (const name of names) {
        if (got[name] !== expected[name]) {
            fail(`fixture — ${what}: \`${name}\``, JSON.stringify(expected[name]), JSON.stringify(got[name]));
        }
    }
}

// The arm-3 rule on broken input, so it cannot go quietly blind: it has to SEE the name
// the element does not observe, and it has to stay silent on the two exceptions.
/** @type {[string, string, string, readonly string[], readonly string[]][]} */
const UNOBSERVED_FIXTURES = [
    [
        'the retired spelling of a renamed attribute',
        `<adw-combo-row title="Region" items='["A"]' selected="0"></adw-combo-row>`,
        'adw-combo-row',
        ['title', 'subtitle', 'model', 'selected'],
        ['items'],
    ],
    [
        'a platform-global name is not the widget vocabulary',
        '<gtk-button slot="start" class="flat" aria-label="Back" data-x="1" label="Back"></gtk-button>',
        'gtk-button',
        ['label'],
        [],
    ],
];
for (const [what, markup, tag, observed, expected] of UNOBSERVED_FIXTURES) {
    const got = unobservedIn(markup, tag, observed);
    if (got.join(',') !== expected.join(',')) {
        fail(`fixture — unobserved: ${what}`, JSON.stringify(expected), JSON.stringify(got));
    }
}

// The arm-4 reader on the shapes a regex over source can get wrong. It has to SEE the
// incident's own line, and it has to stay silent on a receiver that is not a widget.
/** @type {[string, string, string[]][]} name, source, expected `<tag> <attr>` pairs */
const SCRIPTED_FIXTURES = [
    [
        "the incident's own line — a renamed attribute written as a call",
        "const view = el.querySelector<Adw.TabView>('adw-tab-view[data-cmd-view]');\n" +
            "if (index >= 0) view.setAttribute('selected', String(index));",
        ['adw-tab-view selected'],
    ],
    [
        'a `for … of` binding, an optional call, and a getter',
        "for (const row of host.querySelectorAll('adw-combo-row')) {\n" +
            "  row?.setAttribute('items', '[]');\n" +
            "  row.getAttribute('model');\n}",
        ['adw-combo-row items', 'adw-combo-row model'],
    ],
    [
        'a receiver that names no custom element carries no widget vocabulary',
        "const frame = btn.querySelector('.frame');\nframe.setAttribute('data-copied', '1');\n" +
            "const div = document.createElement('div');\ndiv.setAttribute('selected', '2');",
        [],
    ],
    [
        'a binding whose name is a PREFIX of another binding',
        "const view = el.querySelector('adw-tab-view');\nconst viewBar = el.querySelector('adw-view-switcher-bar');\n" +
            "viewBar.setAttribute('reveal', '');",
        ['adw-view-switcher-bar reveal'],
    ],
    [
        'a member access that merely ENDS in the binding name',
        "const view = el.querySelector('adw-tab-view');\nthis.view.setAttribute('selected', '1');",
        [],
    ],
];
for (const [what, source, expected] of SCRIPTED_FIXTURES) {
    const got = scriptedAttributeWrites(source).writes.map((w) => `${w.tag} ${w.attr}`);
    if (got.join(',') !== expected.join(',')) {
        fail(`fixture — scripted: ${what}`, JSON.stringify(expected), JSON.stringify(got));
    }
}

// ------------------------------------------------- 2. every shipped preview fence

const { byTag } = observedAttributes(ROOT);
let blocks = 0;
let cellsSeen = 0;
let unobservedSeen = 0;
for (const { page, file } of DOCS_SECTIONS.flatMap((section) =>
    readdirSync(docsDir(section))
        .filter((f) => f.endsWith('.mdx'))
        // `buttons.mdx` now exists in both sections, so a bare filename in a failure
        // no longer says which page it is.
        .map((f) => ({ page: `${section}/${f}`, file: join(docsDir(section), f) })),
)) {
    const text = readFileSync(file, 'utf8');
    for (const block of text.split('<AdwWidget').slice(1)) {
        const title = /^[^>]*title="([^"]+)"/.exec(block)?.[1];
        if (title === undefined) continue;
        const tag = galleryElementTag(title);
        const names = byTag.get(tag);
        if (names === undefined || names.length === 0) continue;
        // The preview slot's ```html fence, up to the slot that follows it.
        const slot = block.indexOf('slot="preview"');
        if (slot === -1) continue;
        const fenced = /```html\n([\s\S]*?)\n\s*```/.exec(block.slice(slot));
        if (fenced === null) {
            failures.push(`${page} — <AdwWidget title="${title}"> has a preview slot with no \`\`\`html fence`);
            continue;
        }
        blocks++;
        const markup = fenced[1];
        for (const name of unobservedIn(markup, tag, names)) {
            unobservedSeen++;
            fail(
                `${page} — <${tag}> writes \`${name}\``,
                `an attribute <${tag}> observes (${names.join(', ')})`,
                'a name it never reads, so the preview shows one thing and the element does another',
            );
        }
        for (const cell of attributeCells(names, sampleAttributes(markup, tag))) {
            cellsSeen++;
            if (cell.kind !== 'value') continue;
            // The value the page prints has to be IN the fence the page shows. Compared
            // after re-encoding the three references a fence can carry, so a decoded
            // `<Control>C` still matches the `&lt;Control&gt;C` it was read from.
            const encoded = cell.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
            if (!markup.includes(cell.text) && !markup.includes(encoded)) {
                fail(
                    `${page} — <${tag}> \`${cell.name}\``,
                    'a value present in the preview fence',
                    JSON.stringify(cell.text),
                );
            }
        }
    }
}

// ------------------------------------------- 4. the website's own scripted writes

/** Every source file the site SHIPS behaviour from, `website/src` down. */
function* sourceFiles(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) yield* sourceFiles(full);
        else if (/\.(astro|mdx|ts|mts|mjs)$/.test(entry.name)) yield full;
    }
}

let receiversSeen = 0;
let scriptedSeen = 0;
for (const file of sourceFiles(join(ROOT, 'website/src'))) {
    const { receivers, writes } = scriptedAttributeWrites(readFileSync(file, 'utf8'));
    const rel = file.slice(ROOT.length + 1);
    for (const tag of receivers.values()) if ((byTag.get(tag)?.length ?? 0) > 0) receiversSeen++;
    for (const { name, tag, attr } of writes) {
        const names = byTag.get(tag);
        // An element that observes NOTHING is its parent's to read — the arm-3 exception.
        if (names === undefined || names.length === 0 || !isVocabulary(attr)) continue;
        scriptedSeen++;
        if (names.includes(attr)) continue;
        fail(
            `${rel} — \`${name}\` is an <${tag}> and writes \`${attr}\``,
            `an attribute <${tag}> observes (${names.join(', ')})`,
            'a name it never reads, so the call compiles, runs, and does nothing at all',
        );
    }
}

if (receiversSeen === 0) {
    // The same refusal the fence floor below makes: a reader that resolves no receiver
    // satisfies the loop above by never entering it, and reports a clean site.
    failures.push(
        'resolved 0 custom-element bindings in website/src — the arm-4 reader found no ' +
            'receiver to follow, so it checked nothing',
    );
}

if (blocks === 0 || cellsSeen === 0) {
    // A scanner that finds nothing passes every assertion above it. That is the failure
    // this repo keeps paying for, so it is an error rather than a quiet exit 0.
    failures.push(`read ${blocks} gallery blocks and ${cellsSeen} cells — the fence reader found nothing to check`);
}

if (failures.length > 0) {
    console.error(`check-website-attr-samples: ${failures.length} problem(s)\n`);
    for (const f of failures) console.error('  · ' + f);
    process.exit(1);
}
console.log(
    `check-website-attr-samples: ${FIXTURES.length + UNOBSERVED_FIXTURES.length + SCRIPTED_FIXTURES.length} ` +
        `fixtures and ${cellsSeen} cells across ${blocks} gallery blocks, ${unobservedSeen} unobserved ` +
        `attribute(s) written; ${scriptedSeen} scripted attribute name(s) on ${receiversSeen} resolved ` +
        'element binding(s) — ok',
);
