#!/usr/bin/env node
// The website's generated data files are current, and every gallery block reaches one.
//
// THE INCIDENT, TWICE
//
// `generate-theming-tokens.mjs`'s own header states the rule this repo keeps
// paying for: "a contract TYPED OUT on the website is the drift this repo keeps
// paying for". It then emits `src/data/adwaita-tokens.ts` — and NOTHING ran it
// again. The generator is a `website` npm script, absent from every workflow, so
// the committed data could disagree with the stylesheet indefinitely and the
// `theming.mdx` sentence built on it ("68 tokens in 18 groups") had no mechanism
// behind it at all. Generating a fact and then not holding the generation is the
// same drift one step removed.
//
// The second half is what a MISS looks like. `AdwWidget` renders a widget's
// attribute table by deriving the element tag from its `title`. A title that
// resolves gets a table; a title that does not gets NOTHING — and "this widget has
// no attributes" and "I could not find this widget" render identically. `Adw.Toast`
// is legitimately in the second group (it is a plain class, not a custom element);
// a renamed element or a typo'd title would join it, silently, and the page would
// keep looking documented.
//
// WHAT IT CHECKS
//
//   1. Every generator listed in {@link GENERATORS} reproduces its committed
//      output. Run with no argument they WRITE; `--check` compares and exits 1.
//   2. Every `<AdwWidget title="…">` on a gallery page derives a tag that the web
//      pillar actually registers — or sits in {@link NO_ELEMENT} with the reason
//      its widget has none.
//   3. Nothing in {@link NO_ELEMENT} names a title that DOES resolve, so a stale
//      exemption cannot read as considered when it is merely forgotten.
//
// Plain Node over the repo's own files — no install, no build, no astro render.
//
// Usage: node scripts/check-generated-website-data.mjs [--root <dir>]

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { observedAttributes } from './adwaita-elements.mjs';

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : process.argv[rootFlag + 1];

const DOCS_DIR = join(ROOT, 'website/src/content/docs/adwaita');

/**
 * The generators whose output is committed, each with the `--check` mode that
 * compares instead of writing.
 *
 * `generate-theming-tokens.mjs` had no such mode; it grew one with this check,
 * because a generator nothing verifies is a generator nothing runs.
 */
/**
 * The generators whose output is committed. Each has a `--check` that compares
 * instead of writing; none of them had one before this file existed, and none of
 * them ran in any workflow — a generator nothing verifies is a generator nothing
 * runs.
 *
 * `generate-coverage.mjs` is here because building the site FOUND it: `run build`
 * left that tracked file dirty, and the committed numbers said 16 where the tree
 * held 17. The website was publishing coverage the repo no longer had.
 */
const GENERATORS = [
    'website/scripts/generate-adwaita-attributes.mjs',
    'website/scripts/generate-theming-tokens.mjs',
    'website/scripts/generate-coverage.mjs',
];

/**
 * Gallery titles whose widget is not a custom element, with the reason.
 *
 * Not a convenience list: each entry is a claim that gets checked back, so an
 * element that later gains a tag turns this into a failure rather than a
 * permanently silent block.
 */
const NO_ELEMENT = {
    'Adw.Toast': `A toast is not an element — \`AdwToast\` is a plain class the overlay takes, so its surface is constructor options (\`timeout\`, \`buttonLabel\`) rather than attributes. \`<adw-toast-overlay>\` IS an element and is documented on the same page; it observes nothing of its own.`,
};

const failures = [];
const notes = [];

// Before anything reads anything: a missing root is "could not look", not "found
// nothing". Checked here rather than beside its use because the element reader below
// throws first, and a Node stack trace reads like a broken gate instead of a bad
// argument.
for (const [label, path] of [
    ['the Adwaita gallery pages', DOCS_DIR],
    ['the element reader', join(ROOT, 'scripts/adwaita-elements.mjs')],
]) {
    if (!existsSync(path)) {
        console.error(`check-generated-website-data: cannot look — ${label} is not at ${path}. Wrong --root?`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// 1. every generator reproduces its committed output
// ---------------------------------------------------------------------------

for (const rel of GENERATORS) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) {
        failures.push(`${rel}: listed as a generator and not present`);
        continue;
    }
    const proc = spawnSync(process.execPath, [abs, '--check'], { cwd: ROOT, encoding: 'utf8' });
    if (proc.status === 0) {
        notes.push(`${rel} — output current`);
        continue;
    }
    const said = `${proc.stderr ?? ''}${proc.stdout ?? ''}`.trim().split('\n').slice(0, 4).join('\n    ');
    // Each generator's `--check` compares the DATA it emitted — token pairs, tag
    // rows — not the file's bytes, so it needs no formatter and cannot fail for want
    // of one, and reformatting is not mistaken for drift. A non-zero exit here is the
    // data really having changed; the generator's own message says which file.
    failures.push(`${rel}: its committed output no longer matches its source.\n    ${said}`);
}

// ---------------------------------------------------------------------------
// 2 + 3. every gallery block reaches an element, and no exemption is stale
// ---------------------------------------------------------------------------

const { byTag, unreadable } = observedAttributes(ROOT);
if (unreadable.length > 0) {
    failures.push(
        `${unreadable.length} element(s) declare an observedAttributes the reader cannot resolve — ` +
            `an unreadable one renders an EMPTY table: ${unreadable.join(', ')}`,
    );
}

const toTag = (title) =>
    `adw-${title
        .replace(/^(?:Adw|Gtk)\./, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()}`;

const seenTitles = new Set();
let blocks = 0;
let tabled = 0;

for (const page of readdirSync(DOCS_DIR).filter((f) => f.endsWith('.mdx'))) {
    const text = readFileSync(join(DOCS_DIR, page), 'utf8');
    for (const [, title] of text.matchAll(/<AdwWidget\s+title="([^"]+)"/g)) {
        blocks++;
        seenTitles.add(title);
        const tag = toTag(title);
        if (byTag.has(tag)) {
            if (byTag.get(tag).length > 0) tabled++;
            if (NO_ELEMENT[title]) {
                failures.push(
                    `${page}: "${title}" is exempted in NO_ELEMENT and DOES resolve, to <${tag}>. ` +
                        'Drop the exemption — a stale one reads as considered.',
                );
            }
            continue;
        }
        if (NO_ELEMENT[title]) continue;
        failures.push(
            `${page}: "${title}" derives <${tag}>, which the web pillar does not register, so its\n` +
                '    block renders no attribute table and looks documented anyway. Either the title or\n' +
                '    the element name is wrong, or the widget has no element — say so in NO_ELEMENT.',
        );
    }
}

for (const title of Object.keys(NO_ELEMENT)) {
    if (!seenTitles.has(title)) {
        failures.push(`NO_ELEMENT names "${title}", which no gallery page uses. Drop the entry.`);
    }
}

// A scan whose corpus is empty reports green while proving nothing.
if (blocks === 0) failures.push('no <AdwWidget> block found on any gallery page — the reader is broken');

notes.push(
    `${blocks} gallery block(s), ${tabled} rendering a generated attribute table, ` +
        `${byTag.size} registered element(s), ${Object.keys(NO_ELEMENT).length} exemption(s)`,
);

for (const note of notes) console.log(`check-generated-website-data: ${note}`);

if (failures.length > 0) {
    console.error(`\ncheck-generated-website-data: ${failures.length} problem(s):\n`);
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
}

console.log('check-generated-website-data: OK.');
