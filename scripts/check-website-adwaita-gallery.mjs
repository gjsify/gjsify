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
//   4. Every gallery page is in the site's SIDEBAR. Arm 1 makes a new meta demand a
//      new page, and Starlight's `items` list is hand-written: a page missing from it
//      exists at its URL and is offered to nobody, so the gate would force a page no
//      reader can reach. `adwaita/controls` was added there by hand in the very
//      commit that first satisfied arm 1.
//   5. Every `<Fragment slot="…">` inside a block names a slot `AdwWidget` renders.
//      Astro drops an unmatched slot in SILENCE — no warning, no build failure — so a
//      misspelled port is a snippet that is written, reviewed, committed and shown to
//      nobody. Arms 1-4 cannot see it: the block has a title, the title has a meta,
//      and the page is in the sidebar.
//   6. Every port in `AdwWidget`'s {@link WINDOWS} is provided by at least one block.
//      The component renders a tab only for a slot a page actually gave it, so an
//      entry nothing provides renders nowhere — a port declared to every reader of the
//      component and shipped to none of them. The two arms are each other's inverse:
//      5 refuses a page naming a port the component has not got, 6 refuses a component
//      naming a port no page has got.
//   7. Every WINDOW has at least one tab, and at least one tab some block provides. A
//      window is a header bar, a title and its tabs; declared with an empty `tabs` list
//      it announces a kind of implementation that renders on no block at all, and arm
//      6 cannot see it because there is no slot to be unprovided. Same class as 6, one
//      level up — the level the restructure added.
//   8. Every block providing the MARKUP OVERRIDE is ledgered in
//      {@link MARKUP_OVERRIDE_LEDGER} with its reason, and every ledger entry names a
//      block that provides it.
//
//      This is the arm that keeps the preview/markup unification honest. A block's
//      `preview` fence is BOTH what mounts and what is shown, so for 39 of 40 blocks
//      there is no second copy to drift. The override is the exception, and an
//      exception nothing counts is how the rule was lost the first time: the `web`
//      fence used to stand beside every preview saying the same thing, and measured
//      across the 40 blocks 17 were byte-identical and 23 had already diverged, with
//      nothing checking either way. One policed copy, named and reasoned, is the price
//      of the widget whose API is imperative; a second one has to say why.
//  10. Every WINDOW a page draws is NAMED in that page's prose, and every window
//      title the prose names is one that page draws. The window titles are the join
//      between the chrome and the page: what a title cannot say — the four runtimes
//      behind "Native TypeScript", the three dialects behind "UI frameworks" — the
//      intro says instead, so the two are one explanation in two files. Renaming a
//      window in the component alone left nine pages naming one that no longer
//      exists, and growing the frameworks window from three blocks to forty left
//      seven intros enumerating two windows where the reader meets three. Arms 1-9
//      see neither: the strings never leave the prose.
//   9. The LIVE PREVIEW is the FIRST pane of the window that runs the widget, in
//      {@link WINDOW_COMPONENT} — the file that draws a window, which is where pane
//      order is decided.
//
//      The preview and the markup tab beside it are ONE source: the pane mounts the
//      bytes the tab shows. Order is what makes that legible — the reader meets the
//      widget, then the markup that painted it, which is the order every gallery page's
//      prose promises ("The first one RUNS the widget"). Swapped, the window opens on a
//      block of HTML for a widget the reader has not seen yet, and NOTHING else would
//      notice: arm 8 still holds, both tabs still render, the fence is still authored
//      once. It is a source-order read because the panes are laid out in the template,
//      and this gate deliberately runs without a build — so it reads the file with its
//      COMMENTS BLANKED OUT and counts the mount, because a marker named in prose above
//      the tabs, or mounted twice, is how a source-text read goes green over the defect
//      it is named after.
//
// The `title` IS the join: `Adw.ViewSwitcherBar` → `view-switcher-bar`, the same
// bare name the widget files, the story metas and the ledgers are already spelled
// in. Deriving it beats a second hand-written table, which is the thing that drifted.
//
// Plain Node over the repo's own files — no install, no build, no astro render — so
// it runs in `audit-runtimes.yml` next to the other repo-scoped guards. It therefore
// says NOTHING about whether a page RENDERS: `deploy-docs.yml` builds the site on
// pull requests touching `website/`, `packages/` or `showcases/`, which is every
// change to the gallery — but it is path-filtered and so advisory, a signal to read
// rather than a check that blocks.
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

/** The gallery's own pages — the input to both the title arm and the sidebar arm. */
const galleryPages = (root) =>
    readdirSync(join(root, GALLERY), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.mdx'))
        .map((entry) => entry.name)
        .sort();

/** `<AdwWidget … title="X">` → X, for every page in the gallery. */
function galleryTitles(root, pages) {
    /** @type {Map<string, string>} */
    const found = new Map();
    for (const page of pages) {
        const text = readFileSync(join(root, GALLERY, page), 'utf8');
        for (const [, title] of text.matchAll(/<AdwWidget\b[^>]*?\btitle="([^"]+)"/g)) {
            if (!found.has(title)) found.set(title, `${GALLERY}/${page}`);
        }
    }
    return found;
}

/** The body of every `<AdwWidget …> … </AdwWidget>`, which is where a port slot lives. */
function widgetBlocks(root, pages) {
    const blocks = [];
    for (const page of pages) {
        const text = readFileSync(join(root, GALLERY, page), 'utf8');
        const shape = /<AdwWidget\b[^>]*?\btitle="([^"]+)"[^>]*>([\s\S]*?)<\/AdwWidget>/g;
        for (const [, title, body] of text.matchAll(shape)) {
            blocks.push({ page: `${GALLERY}/${page}`, title, body });
        }
    }
    return blocks;
}

/** The tab component: the one place a port is declared. */
const WIDGET_COMPONENT = 'website/src/components/AdwWidget.astro';

/**
 * The component that DRAWS one window, as opposed to declaring it. Pane order is a
 * fact about this file: `WINDOWS` says which tabs a window has, this file says where
 * the live preview sits among them.
 */
const WINDOW_COMPONENT = 'website/src/components/AdwWidgetWindow.astro';

/** The mounted preview's own element, and the expression that renders the code tabs. */
const PREVIEW_MOUNT = 'adw-widget-preview-tpl';
const TAB_MAP = 'tabs.map(';

/**
 * The same file with its comments blanked out.
 *
 * Arm 9 is a SOURCE-TEXT read, and a source-text read that counts PROSE is how a
 * check goes green while the thing it names is gone. That is not hypothetical here:
 * `check-website-preview-not-content.mjs` shipped in exactly that state — its first
 * cut asked whether a file CONTAINED the marker string, and `AdwGalleryCard.astro`
 * carries an eight-line comment naming the marker, so deleting the marker from its
 * markup left the check green. Measured again on this arm: move the preview after
 * the code tabs and leave `adw-widget-preview-tpl` in a comment above them, and the
 * unmasked read exits 0 on a window that opens on HTML.
 *
 * Line comments are anchored to the start of a line so that a `https://` inside an
 * attribute is not read as one.
 */
const withoutComments = (text) => text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^[ \t]*\/\/.*$/gm, '');

/**
 * Arm 9: the live preview is emitted BEFORE the code tabs, inside the tab view, and
 * exactly once.
 *
 * The COUNTS are part of the arm, not tidiness: two preview panes render the widget
 * twice under two "Preview" tabs mounting the same markup, and the order read alone
 * blesses it — the first mount still precedes the tabs. Measured by duplicating the
 * pane: exit 0.
 *
 * Returns null when the file is right, or the reason it is not.
 */
function previewPanePosition(root) {
    const text = withoutComments(readFileSync(join(root, WINDOW_COMPONENT), 'utf8'));
    const view = /<adw-tab-view\b[\s\S]*?<\/adw-tab-view>/.exec(text);
    if (view === null) {
        return `holds no <adw-tab-view> … </adw-tab-view>, so there is no pane order to read`;
    }
    const mounts = view[0].split(PREVIEW_MOUNT).length - 1;
    const maps = view[0].split(TAB_MAP).length - 1;
    if (mounts === 0) return `mounts no preview (\`${PREVIEW_MOUNT}\`) inside its tab view`;
    if (maps === 0) return `renders no code tabs (\`${TAB_MAP}\`) inside its tab view`;
    if (mounts > 1) return `mounts ${mounts} previews inside its tab view, and a window runs the widget once`;
    if (maps > 1) return `renders the code tabs ${maps} times inside its tab view`;
    if (view[0].indexOf(PREVIEW_MOUNT) > view[0].indexOf(TAB_MAP)) return `mounts the preview AFTER the code tabs`;
    return null;
}

/**
 * Blocks whose `preview` fence is NOT the markup a reader should copy, so the
 * component shows a hand-written `web` fragment on that tab instead — and why.
 *
 * The bar is high on purpose. Every other block has ONE markup: the fence that the
 * live preview mounts is the fence the tab shows, so there is nothing to keep in
 * step. An entry here restores exactly the two-copies-one-hand arrangement that
 * left 23 of 40 blocks quietly disagreeing with their own preview, and it earns
 * that only where the widget cannot be expressed as markup at all.
 */
const MARKUP_OVERRIDE_LEDGER = {
    'Adw.Toast':
        "`<adw-toast-overlay>` has no declarative toast child — `addToast()` is the whole API — so the markup that PAINTS a toast in a static preview is the overlay's own internal DOM (`.adw-toast.visible` and friends), which is the one thing a reader must not copy. The preview depicts the result; the tab teaches the call.",
};

/**
 * The window model `AdwWidget` renders: each window's id and the tab slots under it,
 * plus the one slot that is an override rather than a tab.
 *
 * Read out of the component for the same reason the widget title is derived rather
 * than tabled: a second hand-written list is the thing that drifts, and this one
 * would drift in the more expensive direction — a port named here and absent from
 * `WINDOWS` would make this gate bless a tab that never renders.
 */
function componentWindows(root) {
    const text = readFileSync(join(root, WIDGET_COMPONENT), 'utf8');
    const decl = /\bconst WINDOWS = \[([\s\S]*?)\n\];/.exec(text);
    const windows = [];
    if (decl !== null) {
        // Split on the `id:` that opens each window, so every `slot:` between two ids
        // belongs to the window it follows. `split` with one capture group yields
        // [preamble, id, chunk, id, chunk, …].
        const parts = decl[1].split(/\bid:\s*'([a-z][a-z0-9-]*)',/);
        for (let i = 1; i < parts.length; i += 2) {
            const chunk = withoutComments(parts[i + 1]);
            const slots = [...chunk.matchAll(/\bslot:\s*'([a-z][a-z0-9-]*)'/g)].map(([, s]) => s);
            // The TITLE, read with the comments blanked out: every window's chunk is
            // mostly prose, and the live window's own note names two other windows'
            // titles inside it.
            const title = /\btitle:\s*'([^']*)'/.exec(chunk);
            // A window with DATA panes renders on every block, filled or refused —
            // `code:` is the list of them. It is not conditional on a page: arm 4 of
            // `check-generated-website-data.mjs` refuses a block that reaches neither
            // the snippet map nor the refusal map, so the pane is always one or the
            // other. That is what makes arm 10 able to decide, from the source alone,
            // that such a window is on a page.
            const data = /\bcode:\s*[A-Za-z_$]/.test(chunk);
            windows.push({ id: parts[i], slots, title: title === null ? null : title[1], data });
        }
    }
    const override = /\bconst MARKUP_OVERRIDE = '([a-z][a-z0-9-]*)';/.exec(text);
    return { windows, override: override === null ? null : override[1] };
}

/**
 * A gallery page's PROSE: no frontmatter, no fenced code.
 *
 * Arm 10 asks whether a page NAMES a window, and every gallery page carries fenced
 * NativeScript and GJS snippets that say "NativeScript" and "TypeScript" inside them.
 * Read unmasked, a page would satisfy the arm with a code sample — the same
 * source-text-read failure arm 9 blanks comments for.
 *
 * Whitespace is COLLAPSED, because these files are hard-wrapped and Markdown reads a
 * line break as a space: "**UI\nframeworks**" is one phrase to every reader and two
 * to a naive `includes`. Measured while writing this — the arm's first run failed on
 * a page that named the window correctly, wrapped.
 */
const pageProse = (text) =>
    text
        .replace(/^---\n[\s\S]*?\n---\n/, '')
        .replaceAll(/```[\s\S]*?```/g, '')
        .replaceAll(/`[^`\n]*`/g, '')
        .replaceAll(/\s+/g, ' ');

/** Where the site's navigation is hand-written, and how a page is spelled in it. */
const SIDEBAR = 'website/astro.config.mjs';
const SIDEBAR_SLUG = /\bslug:\s*'(adwaita(?:\/[a-z0-9-]+)?)'/g;

/** `controls.mdx` → `adwaita/controls`; the index page is the bare section slug. */
const pageSlug = (page) => (page === 'index.mdx' ? 'adwaita' : `adwaita/${page.slice(0, -'.mdx'.length)}`);

/** @type {Map<string, {path: string, file: string, titles: string[], source: string}>} */
let metas;
try {
    metas = adwaitaStoryMetas(ROOT);
} catch (error) {
    // The reader throws on a vacuous scan by design; catch to keep this script's prefix.
    console.error(`check-website-adwaita-gallery: ${error.message}`);
    process.exit(1);
}

const pages = galleryPages(ROOT);
const gallery = galleryTitles(ROOT, pages);
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

const navigated = new Set(
    [...readFileSync(join(ROOT, SIDEBAR), 'utf8').matchAll(SIDEBAR_SLUG)].map(([, slug]) => slug),
);
if (navigated.size === 0) {
    console.error(
        `check-website-adwaita-gallery: no adwaita entry found in ${SIDEBAR} — that is a broken scan,\n` +
            '  not a site with no navigation.',
    );
    process.exit(1);
}
for (const page of pages) {
    if (navigated.has(pageSlug(page))) continue;
    failures.push(
        `${GALLERY}/${page} is in no sidebar group of ${SIDEBAR}. Starlight lists what that array\n` +
            `    names and nothing else, so the page exists at /${pageSlug(page)}/ and is offered to nobody.\n` +
            `    Add { slug: '${pageSlug(page)}' }, in the position the storybook's category order puts it.`,
    );
}

// --- the window/tab arms: what a page provides against what the component renders ---

const { windows, override } = componentWindows(ROOT);
const ports = new Set(windows.flatMap((w) => w.slots));
if (windows.length === 0 || ports.size === 0) {
    console.error(
        `check-website-adwaita-gallery: no window or no port found in the WINDOWS array of\n` +
            `  ${WIDGET_COMPONENT} — that is a broken scan, not a component with no tabs. Nothing is\n` +
            '  unprovided in an empty set, and no window is dead in one either.',
    );
    process.exit(1);
}
if (override === null) {
    console.error(
        `check-website-adwaita-gallery: no MARKUP_OVERRIDE declared in ${WIDGET_COMPONENT}. Without it\n` +
            '  the override slot reads as an unknown one, and arm 8 would police an empty set.',
    );
    process.exit(1);
}

const blocks = widgetBlocks(ROOT, pages);
if (blocks.length === 0) {
    console.error(
        `check-website-adwaita-gallery: no <AdwWidget> … </AdwWidget> body matched under ${GALLERY}, while\n` +
            `  ${gallery.size} opening tag(s) did — the block reader is broken, not the gallery.`,
    );
    process.exit(1);
}

const provided = new Set();
/** The blocks that override the preview window's markup tab — arm 8's input. */
const overriding = new Map();
for (const block of blocks) {
    for (const [, slot] of block.body.matchAll(/<Fragment slot="([^"]+)"/g)) {
        if (ports.has(slot)) {
            provided.add(slot);
            continue;
        }
        if (slot === override) {
            overriding.set(block.title, block.page);
            continue;
        }
        failures.push(
            `${block.page}: <AdwWidget title="${block.title}"> provides a "${slot}" fragment, and AdwWidget\n` +
                '    renders no slot of that name. Astro drops an unmatched slot in SILENCE — no warning, no\n' +
                '    build failure — so the snippet is written, reviewed, committed and shown to nobody.\n' +
                `    Ports: ${[...ports].join(', ')}. Markup override: ${override}.`,
        );
    }
}

for (const port of ports) {
    if (provided.has(port)) continue;
    failures.push(
        `${WIDGET_COMPONENT} declares the port "${port}" in WINDOWS, and no <AdwWidget> block under\n` +
            `    ${GALLERY} provides it. The component renders a tab only where a page gave it that slot, so\n` +
            '    the entry renders nowhere at all: a port declared to every reader of the component and\n' +
            '    shipped to none of them. Write the first snippet, or drop the entry.',
    );
}

for (const window of windows) {
    if (window.slots.length === 0) {
        failures.push(
            `${WIDGET_COMPONENT} declares the window "${window.id}" with no tabs at all. A window is a\n` +
                '    header bar, a title and its tabs, so an empty one announces a kind of implementation\n' +
                '    that renders on no block at all — and arm 6 cannot see it, because there is no slot to\n' +
                '    be unprovided. Give it a tab, or drop the window.',
        );
        continue;
    }
    if (window.slots.some((slot) => provided.has(slot))) continue;
    failures.push(
        `${WIDGET_COMPONENT} declares the window "${window.id}" (${window.slots.join(', ')}), and no\n` +
            `    <AdwWidget> block under ${GALLERY} provides any of its tabs. The window renders nowhere:\n` +
            '    a kind of implementation announced to every reader of the component and shown to none.',
    );
}

// --- arm 8: the markup override, and the reason it is allowed to exist ---

for (const [title, page] of overriding) {
    if (title in MARKUP_OVERRIDE_LEDGER) continue;
    failures.push(
        `${page}: <AdwWidget title="${title}"> provides a "${override}" fragment, which OVERRIDES the\n` +
            "    markup tab of its own live preview. That is a second copy of the widget's markup, kept by\n" +
            '    hand, next to the one that actually renders — the arrangement that left 23 of 40 blocks\n' +
            '    disagreeing with their own preview. Delete it and let the preview fence be the tab, or add\n' +
            `    "${title}" to MARKUP_OVERRIDE_LEDGER in this script with the reason it cannot be.`,
    );
}

for (const title of Object.keys(MARKUP_OVERRIDE_LEDGER)) {
    if (overriding.has(title)) continue;
    failures.push(
        `${title}: ledgered in MARKUP_OVERRIDE_LEDGER as needing a "${override}" fragment, and no block\n` +
            '    under ' +
            `${GALLERY} provides one. A stale exemption reads as considered when it is merely\n` +
            '    forgotten, and this one would license the next hand-kept copy.',
    );
}

// --- arm 9: the live preview is the first pane of the window that runs the widget ---

const panePosition = previewPanePosition(ROOT);
if (panePosition !== null) {
    failures.push(
        `${WINDOW_COMPONENT} ${panePosition}. The preview and the markup tab beside it are ONE\n` +
            '    source — the pane mounts the bytes the tab shows — and the order is what makes that\n' +
            '    legible: the reader meets the widget, then the markup that painted it, which is the order\n' +
            "    every gallery page's prose promises. Swapped, the window opens on a block of HTML for a\n" +
            '    widget the reader has not seen yet, and nothing else here would notice: both tabs still\n' +
            '    render and the fence is still authored once.',
    );
}

// --- arm 10: a window a page SHOWS is a window the page's prose NAMES ---

/**
 * The window titles a page renders, and the ones its prose enumerates, held against
 * each other in both directions.
 *
 * THE INCIDENT. `Vanilla TypeScript` was renamed to `Native TypeScript` in
 * {@link WIDGET_COMPONENT} and nowhere else. Every gallery page's intro enumerates
 * the windows BY THESE EXACT STRINGS — the component's own note says so and relies on
 * it ("the four runtimes are named by the PAGE") — so nine pages were left naming a
 * window no block on them draws. In the same commit the frameworks window went from
 * three blocks to all forty, and seven of those intros still enumerated two windows
 * where the reader now meets three. Nothing saw either: the strings never leave the
 * prose, so the site builds and arms 1-9 stay green.
 *
 * WHICH WINDOWS A PAGE SHOWS, from the source alone. A window is on a page if some
 * block there provides one of its tab slots, or if it declares DATA panes — those are
 * looked up per block and, where a block has none, replaced by the recorded reason,
 * so such a window is on every block (see `componentWindows`).
 *
 * A page with NO blocks is skipped, because it draws no window at all — with one
 * exception that is not a special case so much as the same rule at section scope: the
 * gallery's index page introduces the section, so what it must name is the union over
 * the pages it introduces. It carried the stale name too, and skipping it would have
 * left the one page a reader meets first outside the rule.
 *
 * MEASURED against the four ways it can be wrong, each restored afterwards:
 *
 *   · rename the window in the component alone — exit 1, on all 9 pages, which is
 *     the defect this arm is named after
 *   · drop "UI frameworks" from one page's intro — exit 1, on that page
 *   · remove the two `nativescript` fragments from `controls.mdx`, so the page stops
 *     drawing a window it still names — exit 1, the inverse direction
 *   · break the title read (`title:` -> `heading:`) — exit 1 on the vacuity guard,
 *     not a green run against an empty set
 */
const SECTION_INDEX = 'index.mdx';
const titledWindows = windows.filter((window) => window.title !== null);
if (titledWindows.length === 0) {
    failures.push(
        `${WIDGET_COMPONENT}: no window in WINDOWS has a title, so arm 10 would hold every page against\n` +
            '    an empty set and pass vacuously. The title read is broken, not the component.',
    );
}

/** page → the titled windows its own blocks draw. */
const shownBy = new Map(pages.map((page) => [page, new Set()]));
for (const block of blocks) {
    const page = block.page.slice(`${GALLERY}/`.length);
    const slots = new Set([...block.body.matchAll(/<Fragment slot="([^"]+)"/g)].map(([, slot]) => slot));
    for (const window of titledWindows) {
        if (window.data || window.slots.some((slot) => slots.has(slot))) shownBy.get(page).add(window.title);
    }
}
const everywhere = new Set([...shownBy.values()].flatMap((titles) => [...titles]));

for (const page of pages) {
    const shown = page === SECTION_INDEX ? everywhere : shownBy.get(page);
    // A page with no block draws nothing, and the index stands for the section.
    if (shown.size === 0) continue;
    const prose = pageProse(readFileSync(join(ROOT, GALLERY, page), 'utf8'));
    for (const title of titledWindows.map((window) => window.title)) {
        const named = prose.includes(title);
        if (named === shown.has(title)) continue;
        failures.push(
            named
                ? `${GALLERY}/${page} names the window "${title}" in its prose, and no block on it draws\n` +
                      '    that window. A reader is told to look for a window that is not there — and the\n' +
                      '    enumeration is the only place the window titles are explained, so being wrong\n' +
                      '    there is worse than being silent.'
                : `${GALLERY}/${page} draws the window "${title}" and its prose never names it. Every\n` +
                      `    gallery page introduces the stack of windows by title, and ${WIDGET_COMPONENT}\n` +
                      '    relies on that: what a window title cannot say (the four runtimes, the three\n' +
                      '    dialects) the page says instead. Rename a window here and nowhere else, or grow\n' +
                      '    the stack by one, and the intro describes a page that no longer exists.',
        );
    }
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
        `${gallery.size} <AdwWidget> blocks across ${pages.length} pages, all of them in the sidebar, ` +
        `${exempt} ledgered with a reason.`,
);
console.log(
    `check-website-adwaita-gallery: ${windows.length} window(s) in ${WIDGET_COMPONENT} — ` +
        `${windows.map((w) => `${w.id} [${w.slots.join(' ')}]`).join(', ')} — each with a tab at least one ` +
        `of ${blocks.length} blocks provides, every fragment slot they write is one the component renders, ` +
        `${overriding.size} block(s) override the markup tab, all ledgered, and ${WINDOW_COMPONENT} mounts ` +
        'the live preview ahead of them.',
);
