#!/usr/bin/env node
// Every `adw-`/`gtk-` name in the web renderer is EITHER an element it registers OR a
// class its stylesheet declares — and the check proves both arms on broken input first.
//
// THE INCIDENT. ADR 0034 clause 1 renamed nine elements to the library that owns their
// GType, and the same nine spellings are ALSO Adwaita style classes: `<gtk-entry
// class="adw-entry">` is the intended end state, a GTK widget wearing the Adwaita skin.
// So the nine names had to be sorted into two piles per SITE — 283 occurrences in tag
// position and 119 in class position at the commit before the rename, and no name is
// reliably one shape (`adw-switch` is 15 class against 14 tag, `adw-checkbox` is 0
// against 14; the ADR § Amendment 5 prints the command). Five sites a context rule got
// wrong were caught only because a human read the diff — three `class: 'adw-icon …'`
// calls swept into tags, two prose sentences about a class that never moved. Reading is
// not a mechanism, and the two ways to get it wrong are both SILENT:
//
//   - a tag renamed that was a class: the rule stops matching and the widget loses its
//     skin. No error anywhere; it just looks wrong, on a page nobody re-opened.
//   - a tag left behind that should have moved: an unregistered custom element is an
//     inert `HTMLElement`, NOT an error. It lays out as an empty inline box and the
//     console stays clean.
//
// WHAT MAKES THEM MACHINE-SEPARABLE is that each pile has its own authoritative
// definition set, and the two are disjoint: an element exists because
// `customElements.define` names it, a class exists because a rule in `scss/` selects
// it. So the classification does not need to be judged — a token in TAG position is
// checked against the registry, a token in CLASS position against the stylesheet, and
// either pile being wrong puts a name where its definition is not.
//
// SCOPE IS THE RENDERER AND THE SURFACES THAT AUTHOR ITS MARKUP, no further. The
// website is deliberately out: it has a class vocabulary of its own in
// `website/src/styles/custom.css` (`.adw-code-window`, `.adw-pill`, ~50 more) that this
// stylesheet knows nothing about, and its two gates already own it —
// `check-generated-website-data.mjs` fails on a gallery title deriving a tag the pillar
// does not register, `check-website-preview-not-content.mjs` on markup outside a
// preview. The NativeScript port is out for the mirror-image reason: its classes live
// in its own `theme/adwaita.css`, held by `check-nativescript-theme-classes.mjs`.
//
// COMMENTS ARE STRIPPED, for the reason `check-adwaita-icon-masks.mjs` records: the
// renamed sources are full of prose about what the element USED to be spelled, and a
// reader that counts prose reports the history as a defect.
//
// WHAT IT DOES NOT ASK, and why not: "does every class APPLIED have a rule". That
// question needs the COMPILED stylesheet and cannot be answered from `scss/` at all —
// the partials nest (`.adw-menu-button { &-item { … } }`) and generate (`@each` over
// the icon masks), so 20 classes that are perfectly real appear nowhere in the source
// text. Asked from the source it is 20 false positives, and a false positive is how a
// gate gets turned off. It IS asked, against the compiled sheet, by
// `src/style-classes.spec.ts` in the browser suite — which is exactly where this gate
// cannot run, because `audit-runtimes.yml` installs and builds nothing.
//
// So the class half is asked in the ONE form that needs no stylesheet: the skin
// namespace is `adw-`, all of it, and a `gtk-` class is therefore a tag rename that
// went one token too far. Zero exemptions today, on 225 class names.
//
// Usage: node scripts/check-adwaita-tag-vs-class.mjs [--root <dir>]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toPosixPath } from '../packages/infra/manifest-conformance/lib/index.mjs';

import { adwaitaWebElements, stripComments } from './adwaita-elements.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

const SCSS_ROOT = 'packages/web/adwaita-web/scss';

/**
 * Where markup for this renderer is authored. Each entry says why it is on the list; a
 * surface missing from it is a hole, not a decision (§ SCOPE names the two deliberate
 * exclusions and who holds them instead).
 */
const SOURCES = [
    // The elements themselves and the partials that style them.
    'packages/web/adwaita-web/src',
    SCSS_ROOT,
    // The storybook SHELL — a published package that builds this renderer's elements.
    'packages/web/adwaita-storybook/src',
    // The browser half of the three-renderer storybook.
    'showcases/gtk/adwaita-storybook/src/browser',
    // A shipping app built entirely out of these elements.
    'showcases/dom/minimalist-browser/src/browser',
];

/** Build outputs and the compiled stylesheet inlined as a TS string, which contains
 *  every class and every element selector by construction — reading either would make
 *  both arms vacuous. */
const SKIP_FILE = ['styles.generated.ts', '_icons.generated.scss'];
const SKIP_DIR = ['node_modules', 'dist', 'lib'];
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.scss', '.css', '.html'];

const TOKEN = String.raw`(?:adw|gtk)-[a-z0-9-]+`;
/** `<gtk-entry …>` / `</gtk-entry>`, in markup, a template literal or an `.html`. */
const MARKUP = new RegExp(String.raw`</?(${TOKEN})(?=[\s/>])`, 'g');
/** `customElements.define('gtk-entry', …)` and `document.createElement('gtk-entry')`. */
const ELEMENT_CALL = new RegExp(
    String.raw`(?:customElements\s*\.\s*(?:define|get)|createElement)\(\s*['"\`](${TOKEN})['"\`]`,
    'g',
);
/** The selector string of a DOM query, which carries BOTH kinds and is split below. */
const QUERY = /(?:querySelector|querySelectorAll|closest|matches)\(\s*['"`]([^'"`]*)['"`]/g;
/** `class="a b"` / `className = 'a'` / `class: 'a b'` — the class-list spellings. */
const CLASS_LIST = /class(?:Name)?\s*[=:]\s*['"`]([^'"`]*)['"`]/g;
/** `classList.add('a', 'b')` and its four siblings. */
const CLASS_LIST_CALL = /classList\s*\.\s*(?:add|remove|toggle|contains|replace)\(([^)]*)\)/g;
/** `.gtk-entry` anywhere a selector may appear — a stylesheet or a query string. */
const CLASS_SELECTOR = new RegExp(String.raw`\.(${TOKEN})`, 'g');
/** A bare element token at selector position: line start or after a combinator/comma. */
const ELEMENT_SELECTOR = new RegExp(String.raw`(?:^|[\s,>~+])(${TOKEN})(?=[\s,{:.[])`, 'gm');

/**
 * One file's `adw-`/`gtk-` tokens, split into the two piles by SYNTAX alone.
 *
 * It takes the text rather than a path so the self-test can drive it, and it strips
 * comments itself so no caller can forget to.
 *
 * @param {string} text
 * @param {boolean} isStyle whether selector syntax is the file's top level
 * @returns {{ tags: Set<string>, classes: Set<string> }}
 */
export function classifyTokens(text, isStyle) {
    const code = stripComments(text);
    const tags = new Set();
    const classes = new Set();

    for (const [, tag] of code.matchAll(MARKUP)) tags.add(tag);
    for (const [, tag] of code.matchAll(ELEMENT_CALL)) tags.add(tag);
    for (const [, selector] of code.matchAll(QUERY)) {
        for (const [, name] of selector.matchAll(CLASS_SELECTOR)) classes.add(name);
        // The `.foo` forms are removed first, so `div.adw-entry` contributes its class
        // and not a tag called `div`, and `gtk-entry .adw-entry` still contributes both.
        for (const [, tag] of selector.replaceAll(CLASS_SELECTOR, ' ').matchAll(ELEMENT_SELECTOR)) tags.add(tag);
    }
    if (isStyle) {
        for (const [, name] of code.matchAll(CLASS_SELECTOR)) classes.add(name);
        for (const [, tag] of code.replaceAll(CLASS_SELECTOR, ' ').matchAll(ELEMENT_SELECTOR)) tags.add(tag);
    } else {
        for (const [, list] of code.matchAll(CLASS_LIST)) {
            for (const name of list.split(/\s+/)) if (new RegExp(`^${TOKEN}$`).test(name)) classes.add(name);
        }
        for (const [, args_] of code.matchAll(CLASS_LIST_CALL)) {
            for (const [, name] of args_.matchAll(new RegExp(String.raw`['"\`](${TOKEN})['"\`]`, 'g'))) {
                classes.add(name);
            }
        }
    }
    return { tags, classes };
}

/**
 * The `adw-`-prefixed names in `scss/` that are NEITHER a tag nor a class, so the tag
 * arm does not read them as elements: `@keyframes adw-dialog-fade-in` and the `@mixin`
 * / `@include` pair, both of which sit at selector position and share the prefix and
 * the shape of a tag. They are subtracted rather than exempted because they are not
 * widget names at all — SCSS has three namespaces here and only one of them is the DOM.
 */
function nonSelectorNames() {
    const names = new Set();
    const SHAPES = [
        String.raw`@keyframes\s+(${TOKEN})`,
        String.raw`animation[^;]*?\b(${TOKEN})`,
        String.raw`@(?:mixin|include)\s+(${TOKEN})`,
    ];
    for (const file of filesUnder(SCSS_ROOT)) {
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const shape of SHAPES) {
            for (const [, name] of code.matchAll(new RegExp(shape, 'g'))) names.add(name);
        }
    }
    return names;
}

/**
 * Every readable file under `root`.
 *
 * A MISSING ROOT THROWS. It returned `[]` while this check was being written, and
 * `packages/dom/minimalist-browser/src/browser` — which lives under `showcases/`, not
 * `packages/` — contributed nothing to either arm with the gate printing OK: a whole
 * shipping surface out of scope, spelled as if it were in. That is the same shape as
 * the `refs/libadwaita` grep the ADR carries a control string for, one directory up.
 */
function filesUnder(root) {
    const base = join(ROOT, root);
    const found = [];
    if (!existsSync(base)) {
        throw new Error(
            `${root} does not exist. A source that resolves to nothing contributes nothing to either ` +
                'arm and reads as a clean surface — fix the path, or drop the entry.',
        );
    }
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIP_DIR.includes(entry.name)) walk(path);
                continue;
            }
            if (!EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
            if (SKIP_FILE.includes(entry.name)) continue;
            found.push(path);
        }
    };
    walk(base);
    return found;
}

// ------------------------------------------------------------------ 1. the self-test
//
// Each vector is markup whose ONE token the classifier has to put in the named pile.
// The interesting ones are the collisions: the same string in both piles on one line,
// and the two shapes the ADR says a human got wrong.
const VECTORS = [
    ['an element tag', '<gtk-entry></gtk-entry>', false, { tags: ['gtk-entry'], classes: [] }],
    ['a class on a plain element', '<input class="adw-entry">', false, { tags: [], classes: ['adw-entry'] }],
    [
        'BOTH on one line — the intended end state',
        '<gtk-entry class="adw-entry"></gtk-entry>',
        false,
        { tags: ['gtk-entry'], classes: ['adw-entry'] },
    ],
    [
        'the shape the diff got wrong three times',
        "h('span', { class: 'adw-icon' })",
        false,
        { tags: [], classes: ['adw-icon'] },
    ],
    ['a registration', "customElements.define('gtk-switch', GtkSwitch)", false, { tags: ['gtk-switch'], classes: [] }],
    ['a createElement', "document.createElement('adw-card')", false, { tags: ['adw-card'], classes: [] }],
    [
        'a query naming both kinds',
        "el.querySelector('gtk-popover .adw-popover-item')",
        false,
        { tags: ['gtk-popover'], classes: ['adw-popover-item'] },
    ],
    [
        'a class on a NON-widget element in a query',
        "el.querySelector('div.adw-entry')",
        false,
        { tags: [], classes: ['adw-entry'] },
    ],
    [
        'a classList call',
        "el.classList.add('adw-linked', 'adw-card')",
        false,
        { tags: [], classes: ['adw-linked', 'adw-card'] },
    ],
    ['a stylesheet element rule', 'gtk-entry {\n  display: flex;\n}', true, { tags: ['gtk-entry'], classes: [] }],
    ['a stylesheet class rule', '.adw-entry {\n  border: none;\n}', true, { tags: [], classes: ['adw-entry'] }],
    [
        'a stylesheet descendant of both',
        'gtk-button .adw-button.icon-only {\n  padding: 0;\n}',
        true,
        { tags: ['gtk-button'], classes: ['adw-button'] },
    ],
    [
        'PROSE about the old name is not a use',
        '// `<adw-entry>` observed five attributes.\nconst x = 1;',
        false,
        { tags: [], classes: [] },
    ],
];

const selfTestFailures = [];
for (const [what, source, isStyle, expected] of VECTORS) {
    const got = classifyTokens(source, isStyle);
    for (const pile of ['tags', 'classes']) {
        const actual = [...got[pile]].sort().join(' ');
        const wanted = [...expected[pile]].sort().join(' ');
        if (actual !== wanted) {
            selfTestFailures.push(`  ${what}\n    ${pile}: expected [${wanted}], got [${actual}]`);
        }
    }
}
if (selfTestFailures.length > 0) {
    process.stderr.write('check-adwaita-tag-vs-class: its own classifier is broken, so it proves nothing.\n');
    for (const failure of selfTestFailures) process.stderr.write(`${failure}\n`);
    process.exit(2);
}

// ------------------------------------------------------------------ 2. the real tree

let registered;
let notSelectors;
try {
    // Both throw rather than answer "nothing" — the element reader on a vacuous scan,
    // {@link filesUnder} on a source path that resolves nowhere. Caught here so the
    // message carries this script's prefix instead of arriving as a stack trace.
    registered = new Set(adwaitaWebElements(ROOT).keys());
    notSelectors = nonSelectorNames();
} catch (error) {
    console.error(`check-adwaita-tag-vs-class: ${error.message}`);
    process.exit(1);
}

/** token → the posix-spelled files using it that way. */
const tagUses = new Map();
const classUses = new Map();
const record = (map, token, file) => map.set(token, [...(map.get(token) ?? []), file]);

let scanned = 0;
try {
    for (const source of SOURCES) {
        for (const file of filesUnder(source)) {
            scanned++;
            const rel = toPosixPath(relative(ROOT, file));
            const { tags, classes } = classifyTokens(readFileSync(file, 'utf8'), /\.s?css$/.test(file));
            for (const tag of tags) record(tagUses, tag, rel);
            for (const name of classes) record(classUses, name, rel);
        }
    }
} catch (error) {
    console.error(`check-adwaita-tag-vs-class: ${error.message}`);
    process.exit(1);
}

const failures = [];

for (const [tag, files] of [...tagUses].sort()) {
    if (registered.has(tag) || notSelectors.has(tag)) continue;
    failures.push(
        `<${tag}> is written as an element in ${files.sort().join(', ')}, and no customElements.define ` +
            'registers it. An unregistered custom element is an inert HTMLElement, not an error: it lays ' +
            'out as an empty inline box with a clean console. Either the tag is misspelled, or it is a ' +
            'CSS class and belongs in a `class` attribute',
    );
}

for (const [name, files] of [...classUses].sort()) {
    if (!name.startsWith('gtk-')) continue;
    failures.push(
        `\`.${name}\` is applied as a CLASS in ${files.sort().join(', ')}. The skin namespace is \`adw-\`: ` +
            'the tag names the widget and follows the GIR, the class names the Adwaita look and does not ' +
            "move with it. A `gtk-` class is a tag rename that took the stylesheet's half too, and the rule " +
            'it used to match still says `adw-`, so the widget silently loses its skin',
    );
}

// The discriminator. Both piles are non-empty in any tree this check has a job in, so
// an empty one means the walk or the classifier stopped working, not that the renderer
// stopped using its own vocabulary.
if (tagUses.size === 0 || classUses.size === 0) {
    failures.push(
        `the scan found ${tagUses.size} tag(s) and ${classUses.size} class(es) across ${scanned} file(s) — ` +
            'one of the two piles is empty, so that half compared nothing and passed vacuously',
    );
}

process.stdout.write(
    `check-adwaita-tag-vs-class: self-test green — ${VECTORS.length} vector(s). ${scanned} file(s); ` +
        `${tagUses.size} element name(s) against ${registered.size} registered, ` +
        `${classUses.size} class name(s), every one of them \`adw-\`.\n`,
);

if (failures.length > 0) {
    process.stderr.write(`\ncheck-adwaita-tag-vs-class: ${failures.length} problem(s):\n\n`);
    for (const failure of failures) process.stderr.write(`  - ${failure}.\n`);
    process.stderr.write(
        '\nThe TAG names the widget and follows the GIR (ADR 0034 clause 1); the CLASS names the\n' +
            'Adwaita skin and stays `adw-`. `<gtk-entry class="adw-entry">` is one widget wearing one\n' +
            'skin, and the two halves have separate definitions — a name in the wrong half is defined\n' +
            'nowhere, and neither browsers nor the type checker say so.\n',
    );
    process.exit(1);
}

process.exit(0);
