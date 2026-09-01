#!/usr/bin/env node
// The website's Adwaita gallery shows every widget the storybook has a story for.
//
// THE INCIDENT
//
// `website/src/content/docs/{adwaita,gtk}/` is hand-derived from the storybook: a human
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
//  11. Every block is filed under the LIBRARY THAT OWNS ITS GTYPE, in both places
//      the filing is written down: the section directory the page sits in, and the
//      sidebar GROUP the page's slug is listed in. ADR 0034 § 1.
//
//      The gallery documented `Gtk.Entry`, `Gtk.DropDown`, `Gtk.Button` and
//      `Gtk.MenuButton` under a section named `Adwaita`, and `controls.mdx` carried
//      no Adwaita widget at all. Arms 1-3 could not see it: each of those blocks has
//      a title, each title has a meta, and the meta says nothing about which section
//      the page belongs to.
//
//      The SIDEBAR half is the same blindness one level up, and it is the reason arm
//      4 is not enough. Arm 4 reads Starlight's groups as one flat set of slugs, so a
//      `gtk/*` page listed inside the `Adwaita` group satisfies it completely, while
//      the reader meets a GTK page under an Adwaita heading, which is the very defect
//      this arm is named after, moved from the directory to the navigation. Same shape as
//      arm 10's known limit, which holds window TITLES and therefore cannot see a new
//      TAB inside a window whose title is already named.
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

/**
 * The gallery: one section per widget LIBRARY, each a set of pages of `<AdwWidget>`
 * blocks.
 *
 * ONE declaration carrying all three joins a section has, the directory its pages
 * live in, the GIR namespace whose widgets belong in it, and the sidebar group it is
 * navigated by. The three drifting apart is exactly what arm 11 refuses. A third
 * section (Material, say) is three strings here and nothing else.
 *
 * Spelled out rather than globbed over `content/docs`, because most sections there
 * are not gallery sections and a sweep would ask arm 1 of pages that document no
 * widget at all.
 */
const GALLERY_SECTIONS = [
    { dir: 'adwaita', namespace: 'Adw', group: 'Adwaita' },
    { dir: 'gtk', namespace: 'Gtk', group: 'Gtk' },
];

/** A section's directory, posix-spelled, because failures PRINT it. */
const sectionDir = (section) => `website/src/content/docs/${section}`;

/** Every section directory, for the messages that say where a scan looked. */
const GALLERY = GALLERY_SECTIONS.map((section) => sectionDir(section.dir)).join(' and ');

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

/**
 * The gallery's own pages, the input to the title arm, the sidebar arm and arm 11.
 *
 * Each page carries the SECTION it was found in, because that is half of what arm 11
 * decides and a bare filename cannot say it: `buttons.mdx` exists in both sections
 * and documents a different library in each.
 */
const galleryPages = (root) =>
    GALLERY_SECTIONS.flatMap(({ dir }) =>
        readdirSync(join(root, sectionDir(dir)), { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.mdx'))
            .map((entry) => entry.name)
            .sort()
            .map((file) => ({ dir, file, path: `${sectionDir(dir)}/${file}` })),
    );

/** `<AdwWidget … title="X">` → X, for every page in the gallery. */
function galleryTitles(root, pages) {
    /** @type {Map<string, string>} */
    const found = new Map();
    for (const page of pages) {
        const text = readFileSync(join(root, page.path), 'utf8');
        for (const [, title] of text.matchAll(/<AdwWidget\b[^>]*?\btitle="([^"]+)"/g)) {
            if (!found.has(title)) found.set(title, page.path);
        }
    }
    return found;
}

/** The body of every `<AdwWidget …> … </AdwWidget>`, which is where a port slot lives. */
function widgetBlocks(root, pages) {
    const blocks = [];
    for (const page of pages) {
        const text = readFileSync(join(root, page.path), 'utf8');
        const shape = /<AdwWidget\b[^>]*?\btitle="([^"]+)"[^>]*>([\s\S]*?)<\/AdwWidget>/g;
        for (const [, title, body] of text.matchAll(shape)) {
            blocks.push({ page: page.path, dir: page.dir, title, body });
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
const withoutComments = (text) => text.replaceAll(/^[ \t]*\/\/.*$/gm, '').replaceAll(/\/\*[\s\S]*?\*\//g, '');

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
const SIDEBAR_SLUG = new RegExp(
    `\\bslug:\\s*'((?:${GALLERY_SECTIONS.map(({ dir }) => dir).join('|')})(?:\\/[a-z0-9-]+)?)'`,
    'g',
);

/** The index page of a section is spelled as the bare section slug. */
const SECTION_INDEX = 'index.mdx';

/** `{dir: 'gtk', file: 'controls.mdx'}` → `gtk/controls`. */
const pageSlug = (page) =>
    page.file === SECTION_INDEX ? page.dir : `${page.dir}/${page.file.slice(0, -'.mdx'.length)}`;

/**
 * The slugs listed inside one hand-written sidebar GROUP, or null if no group of
 * that label exists.
 *
 * Arm 4 reads every `slug:` in the file as one flat set, which is all it needs, since
 * a page is reachable or it is not. Arm 11's sidebar half needs the group each slug
 * sits IN, because a `gtk/*` page listed under `Adwaita` is reachable and filed
 * wrong, and only the second read can tell those apart.
 *
 * A Starlight `items:` array here holds one object per line and no nested array, so
 * the first `]` after the opening one closes it. The vacuity guard below is what
 * catches the day that stops being true: a group whose slugs come back empty is
 * reported, not passed over.
 */
function sidebarGroup(text, label) {
    const open = new RegExp(`\\blabel: '${label}',\\s*\\n\\s*items: \\[`).exec(text);
    if (open === null) return null;
    const start = open.index + open[0].length;
    const end = text.indexOf(']', start);
    if (end === -1) return null;
    return [...text.slice(start, end).matchAll(/\bslug:\s*'([^']+)'/g)].map(([, slug]) => slug);
}

// A section declares the GIR namespace its widgets carry, and `bareName` decides
// which titles the gallery accepts at all. Two hardcoded lists, and if they drift the
// drift is SILENT in the expensive direction: arm 1 would reject every block of the
// new section as a malformed title, so the section would look empty rather than
// misfiled, and arm 11 would have nothing to file. Held here, before any data is read.
for (const { namespace, group } of GALLERY_SECTIONS) {
    if (bareName(`${namespace}.Widget`) !== null) continue;
    console.error(
        `check-website-adwaita-gallery: the ${group} section declares the namespace "${namespace}", and\n` +
            `  bareName() does not accept "${namespace}.Widget". Arm 1 would reject every block in that\n` +
            '  section as a malformed title and arm 11 would file none of them, so the section would be\n' +
            '  policed by nothing at all. Widen bareName() to the namespaces GALLERY_SECTIONS declares.',
    );
    process.exit(1);
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

const sidebarSource = readFileSync(join(ROOT, SIDEBAR), 'utf8');
const navigated = new Set([...sidebarSource.matchAll(SIDEBAR_SLUG)].map(([, slug]) => slug));
if (navigated.size === 0) {
    console.error(
        `check-website-adwaita-gallery: no gallery entry found in ${SIDEBAR} — that is a broken scan,\n` +
            '  not a site with no navigation.',
    );
    process.exit(1);
}
for (const page of pages) {
    if (navigated.has(pageSlug(page))) continue;
    failures.push(
        `${page.path} is in no sidebar group of ${SIDEBAR}. Starlight lists what that array\n` +
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
 * That union is PER SECTION, not over the whole gallery. `gtk/index.mdx` introduces
 * the GTK pages and nothing else, so a window only the Adwaita pages draw is one its
 * prose must not name. A gallery-wide union would let a section index describe
 * windows a reader never meets there, in the exact voice this arm exists to keep
 * honest.
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
const titledWindows = windows.filter((window) => window.title !== null);
if (titledWindows.length === 0) {
    failures.push(
        `${WIDGET_COMPONENT}: no window in WINDOWS has a title, so arm 10 would hold every page against\n` +
            '    an empty set and pass vacuously. The title read is broken, not the component.',
    );
}

/** page path → the titled windows its own blocks draw. */
const shownBy = new Map(pages.map((page) => [page.path, new Set()]));
for (const block of blocks) {
    const slots = new Set([...block.body.matchAll(/<Fragment slot="([^"]+)"/g)].map(([, slot]) => slot));
    for (const window of titledWindows) {
        if (window.data || window.slots.some((slot) => slots.has(slot))) shownBy.get(block.page).add(window.title);
    }
}
/** section dir → the union over that section's own pages, which its index stands for. */
const sectionWindows = new Map(GALLERY_SECTIONS.map(({ dir }) => [dir, new Set()]));
for (const page of pages) {
    for (const title of shownBy.get(page.path)) sectionWindows.get(page.dir).add(title);
}

for (const page of pages) {
    const shown = page.file === SECTION_INDEX ? sectionWindows.get(page.dir) : shownBy.get(page.path);
    // A page with no block draws nothing, and the index stands for its section.
    if (shown.size === 0) continue;
    const prose = pageProse(readFileSync(join(ROOT, page.path), 'utf8'));
    for (const title of titledWindows.map((window) => window.title)) {
        const named = prose.includes(title);
        if (named === shown.has(title)) continue;
        failures.push(
            named
                ? `${page.path} names the window "${title}" in its prose, and no block on it draws\n` +
                      '    that window. A reader is told to look for a window that is not there — and the\n' +
                      '    enumeration is the only place the window titles are explained, so being wrong\n' +
                      '    there is worse than being silent.'
                : `${page.path} draws the window "${title}" and its prose never names it. Every\n` +
                      `    gallery page introduces the stack of windows by title, and ${WIDGET_COMPONENT}\n` +
                      '    relies on that: what a window title cannot say (the four runtimes, the three\n' +
                      '    dialects) the page says instead. Rename a window here and nowhere else, or grow\n' +
                      '    the stack by one, and the intro describes a page that no longer exists.',
        );
    }
}

// --- arm 11: a block is filed under the library that owns its GType ---
//
// Two reads of the same fact, because the filing is written down twice. The
// directory is what a page IS; the sidebar group is what a reader MEETS. Getting
// either one wrong puts a widget under the name of a library it does not belong to,
// and neither arm above can see it.

/** dir → the section, for the block half. */
const sectionOf = new Map(GALLERY_SECTIONS.map((section) => [section.dir, section]));
/** namespace → the section a block of that namespace belongs in. */
const sectionOfNamespace = new Map(GALLERY_SECTIONS.map((section) => [section.namespace, section]));

/**
 * The namespace a block's title opens with, built FROM the table.
 *
 * A literal `/^(Adw|Gtk)\./` here would be a second list beside `GALLERY_SECTIONS`,
 * and the day they disagreed arm 11 would skip every block of the unlisted namespace
 * in silence, which is the one failure mode this arm must not have. The guard above
 * holds the same pair against `bareName`, so all three move together or one of them
 * goes red.
 */
const TITLE_NAMESPACE = new RegExp(`^(${GALLERY_SECTIONS.map(({ namespace }) => namespace).join('|')})\\.`);

for (const block of blocks) {
    const namespace = TITLE_NAMESPACE.exec(block.title);
    // A title outside `Adw.Class` / `Gtk.Class` is already arm 1's failure; reporting
    // it twice would say the same thing in two voices.
    if (namespace === null) continue;
    const belongs = sectionOfNamespace.get(namespace[1]);
    if (belongs.dir === block.dir) continue;
    failures.push(
        `${block.page}: <AdwWidget title="${block.title}"> is a ${namespace[1]} widget filed under the\n` +
            `    ${sectionOf.get(block.dir)?.group ?? block.dir} section. ADR 0034 § 1 names a widget after the\n` +
            '    library that owns its GType, and the documentation follows the same split. A widget\n' +
            '    documented under a library it does not belong to has moved the inconsistency, not removed\n' +
            `    it. Move the block to ${sectionDir(belongs.dir)}/.`,
    );
}

for (const section of GALLERY_SECTIONS) {
    const listed = sidebarGroup(sidebarSource, section.group);
    if (listed === null) {
        failures.push(
            `${SIDEBAR} declares no sidebar group labelled "${section.group}", so every page under\n` +
                `    ${sectionDir(section.dir)} is filed under some other library's heading or under none.`,
        );
        continue;
    }
    if (listed.length === 0) {
        failures.push(
            `${SIDEBAR}: the "${section.group}" group parsed to zero slugs, so arm 11's sidebar half would\n` +
                '    hold this section against an empty set and pass vacuously. The group reader is broken,\n' +
                '    not the sidebar.',
        );
        continue;
    }
    for (const slug of listed) {
        const dir = slug.split('/')[0];
        if (dir === section.dir) continue;
        failures.push(
            `${SIDEBAR}: the "${section.group}" sidebar group lists { slug: '${slug}' }, which is a page of\n` +
                `    the ${sectionOf.get(dir)?.group ?? dir} section. Arm 4 cannot see this: it reads every group as\n` +
                '    one flat set, so the page is reachable and still meets the reader under the wrong\n' +
                '    library.',
        );
    }
    for (const page of pages.filter((entry) => entry.dir === section.dir)) {
        if (listed.includes(pageSlug(page))) continue;
        if (!navigated.has(pageSlug(page))) continue; // arm 4 already reports it as unreachable
        failures.push(
            `${page.path} is listed in ${SIDEBAR}, but not in the "${section.group}" group its section is\n` +
                "    named by. It is reachable under another library's heading, which is the defect this\n" +
                '    section split exists to remove.',
        );
    }
}

for (const section of GALLERY_SECTIONS) {
    if (blocks.some((block) => block.dir === section.dir)) continue;
    failures.push(
        `${sectionDir(section.dir)} holds no <AdwWidget> block at all, so arm 11 polices an empty set for\n` +
            `    the ${section.group} section. A declared section with no widget in it is a heading offered to\n` +
            '    the reader with nothing behind it.',
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
        `${gallery.size} <AdwWidget> blocks across ${pages.length} pages, all of them in the sidebar, ` +
        `${exempt} ledgered with a reason.`,
);
console.log(
    `check-website-adwaita-gallery: ${GALLERY_SECTIONS.length} section(s) — ` +
        GALLERY_SECTIONS.map(
            ({ dir, namespace, group }) =>
                `${group} [${blocks.filter((block) => block.dir === dir).length} ${namespace}.* block(s), ` +
                `${(sidebarGroup(sidebarSource, group) ?? []).length} sidebar slug(s)]`,
        ).join(', ') +
        ' — every block under the library that owns its GType, and every page in the sidebar group its ' +
        'section is named by.',
);
console.log(
    `check-website-adwaita-gallery: ${windows.length} window(s) in ${WIDGET_COMPONENT} — ` +
        `${windows.map((w) => `${w.id} [${w.slots.join(' ')}]`).join(', ')} — each with a tab at least one ` +
        `of ${blocks.length} blocks provides, every fragment slot they write is one the component renders, ` +
        `${overriding.size} block(s) override the markup tab, all ledgered, and ${WINDOW_COMPONENT} mounts ` +
        'the live preview ahead of them.',
);
