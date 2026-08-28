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
//
// Plain Node over the repo's own files: no install, no build, no astro render.
//
// Usage: node scripts/check-website-attr-samples.mjs [--root <dir>]

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { attributeCells, sampleAttributes } from '../website/src/components/attr-sample.mjs';
import { observedAttributes } from './adwaita-elements.mjs';

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : process.argv[rootFlag + 1];
const DOCS_DIR = join(ROOT, 'website/src/content/docs/adwaita');

const failures = [];
const fail = (what, expected, actual) => failures.push(`${what}\n      expected ${expected}\n      actual   ${actual}`);

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
        `<adw-button label="it's here" tooltip='say "hi"'></adw-button>`,
        'adw-button',
        { label: "it's here", tooltip: 'say "hi"' },
    ],
    [
        'an UNQUOTED value',
        '<adw-button label=Download can-shrink></adw-button>',
        'adw-button',
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
        '<!-- <adw-button label="commented-out"></adw-button> -->\n<adw-button can-shrink></adw-button>',
        'adw-button',
        { label: 'not used', 'can-shrink': 'set' },
    ],
    [
        'a name REPEATED on one tag',
        '<adw-button label="first" label="second"></adw-button>',
        'adw-button',
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
        '<adw-button label=""></adw-button>',
        'adw-button',
        {
            label: 'set',
        },
    ],
    ['an UPPERCASE tag', '<ADW-BUTTON LABEL="x"></ADW-BUTTON>', 'adw-button', { label: 'x' }],
    [
        'the tag inside ANOTHER element, entity-escaped as a reader would write it',
        '<adw-status-page description="use &lt;adw-button&gt;"></adw-status-page>' +
            '<adw-button label="real"></adw-button>',
        'adw-button',
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

// ------------------------------------------------- 2. every shipped preview fence

/**
 * The `preview` fence of every `<AdwWidget title="…">` block, paired with the element
 * tag the component derives from that title — the same derivation `AdwWidget.astro`
 * makes, because a second spelling of it here would be the drift this file is against.
 */
const elementTag = (title) =>
    `adw-${title
        .replace(/^(?:Adw|Gtk)\./, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()}`;

const { byTag } = observedAttributes(ROOT);
let blocks = 0;
let cellsSeen = 0;
for (const page of readdirSync(DOCS_DIR).filter((f) => f.endsWith('.mdx'))) {
    const text = readFileSync(join(DOCS_DIR, page), 'utf8');
    for (const block of text.split('<AdwWidget').slice(1)) {
        const title = /^[^>]*title="([^"]+)"/.exec(block)?.[1];
        if (title === undefined) continue;
        const tag = elementTag(title);
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
    `check-website-attr-samples: ${FIXTURES.length} fixtures and ${cellsSeen} cells across ${blocks} gallery blocks — ok`,
);
