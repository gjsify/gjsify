#!/usr/bin/env node
// The website's Adwaita gallery shows every widget the storybook has a story for.
//
// THE INCIDENT
//
// `website/src/content/docs/adwaita/` is hand-derived from the storybook: a human
// reads the `*.meta.ts` set and writes an `<AdwWidget>` block per widget. On
// 2026-07-24 that was 35 against 35. Five metas landed after it, and on 2026-08-18
// the gallery pages were RE-AUTHORED wholesale (#1228) — three days later, by
// someone with every page open — and still came out 35 against 40. A human
// touching the file is demonstrably not the mechanism.
//
// The hole is not cosmetic. The five were `menu-button`, `drop-down`, `entry`,
// `shortcut-label` and `view-switcher-bar`: two of them (Drop Down, Entry) are the
// WHOLE `Controls` category, which the sidebar's own
// `STORYBOOK_CATEGORY_ORDER` already declared, so the site's category list was a
// strict subset of the storybook's with nothing saying so.
//
// WHAT IT CHECKS, BOTH WAYS
//
//   1. Every `<name>.meta.ts` has an `<AdwWidget title="…">` block, or an entry in
//      {@link NOT_IN_THE_GALLERY} saying why the gallery is not where it belongs.
//   2. Every `<AdwWidget>` block maps back to a meta. The gallery is documentation
//      of the reference implementation; a block with no story behind it documents a
//      widget no target is held to render.
//   3. No ledger entry names a widget that HAS a block, so a stale exemption cannot
//      read as considered when it is merely forgotten.
//
// The `title` IS the join: `Adw.ViewSwitcherBar` → `view-switcher-bar`, the same
// bare name the widget files, the story metas and the ledgers are already spelled
// in. Deriving it beats a second hand-written table, which is the thing that drifted.
//
// Plain Node over the repo's own files — no install, no build, no astro render —
// so it runs in `audit-runtimes.yml` next to the other repo-scoped guards. It
// therefore says NOTHING about whether a page renders; the docs-site build on
// every PR (`deploy-docs.yml`) is what holds that.
//
// Usage: node scripts/check-website-adwaita-gallery.mjs [--root <dir>]

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADWAITA_STORY_SRC, adwaitaStoryMetas } from './adwaita-elements.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

/** The gallery: one page per storybook category, each a list of `<AdwWidget>` blocks. */
const GALLERY = 'website/src/content/docs/adwaita';

/**
 * Story metas the gallery deliberately does not carry, and why.
 *
 * The bar is the one `check-storybook-widget-coverage.mjs` sets: a reader looking
 * for this widget finds what they came for, or there is nothing a gallery block
 * could honestly show. "It would be work" is not a reason — those get a block.
 */
const NOT_IN_THE_GALLERY = {
    widgets:
        'Overview/Widgets is not a widget: it composes a dozen of them into one window to answer "do these look right TOGETHER". The gallery answers that with its own index page (adwaita/index.mdx), which is that composition in the site\'s own layout — a second copy of the storybook overview would be the same picture twice.',
};

/**
 * `Adw.ViewSwitcherBar` → `view-switcher-bar`. The namespace is dropped on purpose:
 * `Gtk.Entry` and `Adw.EntryRow` are one namespace apart and two different widgets,
 * but the meta name already disambiguates them, and half the gallery documents GTK
 * widgets Adwaita only STYLES (there is no `Adw.MenuButton`, `Adw.DropDown` or
 * `Adw.Entry` — a fact this repo previously got wrong in a citation).
 */
const bareName = (title) => {
    const match = /^(?:Adw|Gtk)\.([A-Za-z][A-Za-z0-9]*)$/.exec(title);
    if (!match) return null;
    return match[1].replaceAll(/(?<!^)([A-Z])/g, '-$1').toLowerCase();
};

/**
 * Meta names whose gallery block is titled after a DIFFERENT widget, with the reason.
 *
 * One entry, and it is the shape the derivation cannot cover: a story about a
 * widget's style classes rather than about a widget.
 */
const TITLED_AFTER = {
    'button-styles': {
        title: 'Gtk.Button',
        reason: 'the story renders the plain button beside .pill/.circular/.suggested-action/.destructive-action/.flat, and its `component` is `Gtk.Button.$gtype`. Same reason check-storybook-widget-coverage.mjs ledgers `button` against it.',
    },
};

/** `<AdwWidget … title="X">` → X, for every page in the gallery. */
function galleryTitles(root) {
    const dir = join(root, GALLERY);
    /** @type {Map<string, string>} */
    const found = new Map();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.mdx')) continue;
        const text = readFileSync(join(dir, entry.name), 'utf8');
        for (const [, title] of text.matchAll(/<AdwWidget\b[^>]*?\btitle="([^"]+)"/g)) {
            if (!found.has(title)) found.set(title, `${GALLERY}/${entry.name}`);
        }
    }
    return found;
}

/** @type {Map<string, {path: string, file: string, titles: string[], source: string}>} */
let metas;
try {
    metas = adwaitaStoryMetas(ROOT);
} catch (error) {
    // The reader throws on a vacuous scan by design; catch to keep this script's prefix.
    console.error(`check-website-adwaita-gallery: ${error.message}`);
    process.exit(1);
}

const gallery = galleryTitles(ROOT);
if (gallery.size === 0) {
    console.error(
        `check-website-adwaita-gallery: no <AdwWidget> block found under ${GALLERY} — that is a broken\n` +
            '  scan, not an empty gallery. Nothing is missing from an empty set.',
    );
    process.exit(1);
}

/** bare widget name → the page documenting it. */
const documented = new Map();
const failures = [];

for (const [title, page] of gallery) {
    const name = bareName(title);
    if (name === null) {
        failures.push(
            `${page}: <AdwWidget title="${title}"> is not an \`Adw.Class\` / \`Gtk.Class\` title, so nothing\n` +
                '    can say which story it documents. AdwWidget derives its upstream doc link from that\n' +
                '    shape too, so a title outside it also renders without one.',
        );
        continue;
    }
    documented.set(name, page);
}

for (const [name, meta] of metas) {
    const alias = name in TITLED_AFTER ? bareName(TITLED_AFTER[name].title) : null;
    if (documented.has(name) || (alias !== null && documented.has(alias))) {
        if (name in NOT_IN_THE_GALLERY) {
            failures.push(
                `${name}: exempted in NOT_IN_THE_GALLERY, but the gallery documents it — drop the stale entry.`,
            );
        }
        continue;
    }
    if (name in NOT_IN_THE_GALLERY) continue;
    failures.push(
        `${name}: ${meta.file} declares ${meta.titles.map((t) => `"${t}"`).join(', ')}, and no page under\n` +
            `    ${GALLERY} has an <AdwWidget> for it. Add the block, or add ${name} to\n` +
            '    NOT_IN_THE_GALLERY in this script with the reason.',
    );
}

const aliases = new Set(Object.values(TITLED_AFTER).map((entry) => bareName(entry.title)));
for (const [name, page] of documented) {
    if (metas.has(name) || aliases.has(name)) continue;
    failures.push(
        `${page} documents "${name}", which has no <name>.meta.ts under ${ADWAITA_STORY_SRC}. The gallery\n` +
            '    documents the reference implementation, so a block with no story behind it shows a widget\n' +
            '    no target is held to render — the one thing three-target parity cannot see.',
    );
}

for (const name of Object.keys(NOT_IN_THE_GALLERY)) {
    if (metas.has(name)) continue;
    failures.push(`${name}: exempted here, but no meta of that name exists — the entry covers nothing.`);
}

for (const [name, entry] of Object.entries(TITLED_AFTER)) {
    if (metas.has(name)) continue;
    failures.push(
        `${name}: TITLED_AFTER points it at "${entry.title}", but no meta of that name exists. A stale\n` +
            '    alias would let a real gap under that title pass as covered.',
    );
}

if (failures.length > 0) {
    console.error(`check-website-adwaita-gallery: ${failures.length} gallery/storybook disagreement(s):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
        '\nThe gallery is hand-derived from the storybook, and a hand is not a mechanism: it was last\n' +
            're-authored WHOLESALE three days after four of the missing metas landed, with every page open,\n' +
            'and still came out short. This is that derivation, held.',
    );
    process.exit(1);
}

const exempt = Object.keys(NOT_IN_THE_GALLERY).length;
console.log(
    `check-website-adwaita-gallery: ${metas.size} story metas — ${metas.size - exempt} documented by ` +
        `${gallery.size} <AdwWidget> blocks, ${exempt} ledgered with a reason.`,
);
