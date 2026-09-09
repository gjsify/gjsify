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
//   5. Every `<Fragment slot="…">` inside a block names a slot `AdwWidget` renders, or
//      the markup OVERRIDE, or one of its declared CORPUS slots. Astro drops an
//      unmatched slot in SILENCE — no warning, no build failure — so a misspelled port
//      is a snippet that is written, reviewed, committed and shown to nobody. Arms 1-4
//      cannot see it: the block has a title, the title has a meta, and the page is in
//      the sidebar.
//   6. Every port in `AdwWidget`'s {@link WINDOWS} is provided by at least one block.
//      The component renders a tab only for a slot a page actually gave it, so an
//      entry nothing provides renders nowhere — a port declared to every reader of the
//      component and shipped to none of them. The two arms are each other's inverse:
//      5 refuses a page naming a port the component has not got, 6 refuses a component
//      naming a port no page has got.
//
//      AND THE CORPUS HALF. A corpus slot is one the pages AUTHOR, another arm READS,
//      and no window renders — `nativescript` is the one, because the end state of ADR
//      0034's convergence is that a block's NativeScript program IS its GJS program and
//      rendering both is the redundancy a reader noticed. Arm 5 has to let those
//      through, which is exactly the hole a misspelled slot would hide in, so arm 6
//      demands of each one that some block writes it and that some arm of THIS file
//      reads it ({@link SLOT_READERS}, derived from the arms' own input rather than
//      written out beside them). A category nothing reads is a category, not a reason.
//   7. Every WINDOW renders at least one pane on at least one block: a tab slot some
//      block provides, a data GROUP (filled or refused, so on every block), or the live
//      preview the component provides itself. A window with none of the three announces
//      a kind of implementation that renders on no block at all, and arm 6 cannot see
//      it because there is no slot to be unprovided. Same class as 6, one level up.
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
//  12. The `gjs` pane and the `nativescript` pane of one block are the SAME TEXT,
//      or the block is ledgered in {@link PANE_TEXT_DIVERGENCES} with the reason and
//      the KIND of work that would close it. ADR 0034 § Amendment 12 said the `gi://`
//      arms were "the last of the two things keeping the website's Native TypeScript
//      and NativeScript snippets from being the same text" and then left the snippets
//      alone; nothing measured how far apart they were, so nothing could say whether
//      the two stages that landed had bought anything.
//
//      THIS FILE AND NOT `check-generated-website-data.mjs`, whose arm 11 holds the
//      same claim over the gallery's two authored TREES: that arm's corpus is two
//      generated data files and it never opens an `.mdx`, while this file's corpus IS
//      the authored blocks and their `<Fragment>` panes — arm 5 already reads them.
//
//      ONE declared normalisation, and its reason: the lines that BIND the widget
//      namespaces are read as the namespaces they bind, so
//      `import { Adw, Gtk } from '@gjsify/adwaita-nativescript'` and
//      `import Adw from 'gi://Adw?version=1'` beside `import Gtk from 'gi://Gtk?version=4.0'`
//      compare equal. That equivalence is what stage 9 established, and holding it
//      here is what stops the printed distance from being bought by editing forty
//      import lines. Nothing else is normalised: an `@gjsify/adwaita-icons` or
//      `@nativescript/core` import is a real difference and stays one.
//
//      Self-retiring, the shape arm 5b and arm 11 of the sibling gate already have —
//      a ledgered block whose two panes have BECOME the same text fails, so a reason
//      cannot outlive what it was recorded for. The partition and the DISTANCE are
//      PRINTED on every run and written down nowhere: a count in a header is the
//      drift this gallery has already paid for twice.
//   9. The reader meets the RUNNING WIDGET before any source, and the markup that
//      paints it is shown. Read out of both component files, because the claim now
//      spans them: the live pane and the markup tab are ONE source (the pane mounts the
//      bytes the tab shows) and they sit in two different WINDOWS.
//
//      In {@link WIDGET_COMPONENT}: exactly one window declares `live: true`, it is
//      FIRST, it has no tabs and no groups beside the widget, and the fence it mounts
//      (`MARKUP_SLOT`) is a tab of a LATER window that some block fills. Drop that tab
//      and every block paints a widget whose markup a reader cannot read, at exit 0,
//      with the fence still authored and still gated.
//
//      In {@link WINDOW_COMPONENT}: the preview is mounted exactly once, and OUTSIDE
//      the tab view. Mounted inside it, the running widget is one tab beside its own
//      sources, which is the arrangement the first window was restructured out of and
//      which comes back by moving four lines. Nothing else would notice: arm 8 still
//      holds, every pane still renders, the fence is still authored once.
//
//      Both are source-text reads, so the files are read with their COMMENTS BLANKED
//      OUT — a marker named in prose is how a read like this goes green over the defect
//      it is named after — and each read has a floor: no tab view found, no pane map
//      found, no `MARKUP_SLOT` declared and no live window at all are all failures
//      rather than a clean run against an empty set.
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
import { stripComments } from '../packages/infra/manifest-conformance/lib/strip-comments.mjs';

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

/** The mounted preview's own element, and the expression that renders the tab pages. */
const PREVIEW_MOUNT = 'adw-widget-preview-tpl';
const PANE_MAP = 'tabbed.map(';

/**
 * The same file with its comments blanked out.
 *
 * Arms 9 and 10 are SOURCE-TEXT reads, and a source-text read that counts PROSE is how
 * a check goes green while the thing it names is gone. That is not hypothetical here:
 * `check-website-preview-not-content.mjs` shipped in exactly that state — its first
 * cut asked whether a file CONTAINED the marker string, and `AdwGalleryCard.astro`
 * carries an eight-line comment naming the marker, so deleting the marker from its
 * markup left the check green. Measured again on arm 9: put the mount back inside the
 * tab view and leave `adw-widget-preview-tpl` in a comment outside it, and the unmasked
 * read exits 0 on a window that offers the widget as a tab.
 *
 * Line comments are anchored to the start of a line so that a `https://` inside an
 * attribute is not read as one.
 */
const withoutComments = stripComments;

/**
 * Arm 9, over the file that DRAWS a window: the preview is mounted exactly once, and
 * OUTSIDE the tab view.
 *
 * Both halves are the arm. Two preview panes render the widget twice from the same
 * markup, and one INSIDE the tab view is the widget offered to the reader as one tab
 * among its own sources — which is the arrangement the preview window was restructured
 * out of, and it comes back by moving four lines.
 *
 * The tab view and the pane map have to be FOUND for either read to mean anything: with
 * no `<adw-tab-view>` in the file, "the mount is outside the tab view" is true of a file
 * that draws no tabs at all, which is the vacuous pass this arm is most exposed to.
 *
 * Returns the reasons the file is wrong, empty when it is right.
 */
function previewMountPlacement(root) {
    const problems = [];
    const text = withoutComments(readFileSync(join(root, WINDOW_COMPONENT), 'utf8'));
    const mounts = text.split(PREVIEW_MOUNT).length - 1;
    if (mounts === 0) problems.push(`mounts no preview (\`${PREVIEW_MOUNT}\`) at all`);
    if (mounts > 1) problems.push(`mounts ${mounts} previews, and a window runs the widget once`);
    const view = /<adw-tab-view\b[\s\S]*?<\/adw-tab-view>/.exec(text);
    if (view === null) {
        problems.push('holds no <adw-tab-view> … </adw-tab-view>, so there is no tab view to be outside of');
        return problems;
    }
    const maps = view[0].split(PANE_MAP).length - 1;
    if (maps !== 1) problems.push(`renders the tab pages (\`${PANE_MAP}\`) ${maps} times inside its tab view`);
    if (view[0].includes(PREVIEW_MOUNT)) {
        problems.push('mounts the preview INSIDE its tab view, so the running widget is one tab beside its sources');
    }
    return problems;
}

/**
 * Arm 9, over the file that DECLARES the windows: exactly one window runs the widget,
 * it is FIRST, it has nothing else in it, and the markup it mounts is shown somewhere
 * after it.
 *
 * The last one is the half that is easy to lose. The live pane clones the `preview`
 * fence whether or not any window renders that fence as code, so dropping the
 * "HTML Web Components" tab leaves every block showing a widget whose markup a reader
 * cannot read — at exit 0, with the fence still authored and still gated.
 */
function livePreviewDeclaration(windows, markupSlot, provided) {
    const problems = [];
    const liveAt = windows.flatMap((win, index) => (win.live ? [index] : []));
    if (liveAt.length !== 1) {
        problems.push(
            `declares ${liveAt.length} window(s) with \`live: true\` in WINDOWS, and exactly one runs the ` +
                'widget. With none, no block shows the widget at all; with two, one of them mounts a preview ' +
                'the other already did.',
        );
        return problems;
    }
    const [index] = liveAt;
    const live = windows[index];
    if (index !== 0) {
        problems.push(
            `declares its live window at position ${index + 1} of ${windows.length}, so a reader scrolling ` +
                'the block meets source code before the widget it is source FOR. The order is the promise ' +
                "every gallery page's prose makes.",
        );
    }
    if (live.slots.length > 0 || live.groups.length > 0) {
        problems.push(
            `gives the live window "${live.id}" ${live.slots.length} tab(s) and ${live.groups.length} data ` +
                'group(s) beside the running widget. That window shows the widget and nothing else — a tab ' +
                'bar over it offers the reader a choice between the widget and its sources, as if the widget ' +
                'were one of them.',
        );
    }
    if (markupSlot === null) {
        problems.push(
            'declares no MARKUP_SLOT, so nothing here can say which fence the live pane mounts — and the ' +
                'read below would pass over any window list at all',
        );
        return problems;
    }
    const shownAt = windows.findIndex((win) => win.slots.includes(markupSlot));
    if (shownAt === -1) {
        problems.push(
            `mounts the "${markupSlot}" fence and renders it on no window at all. The pane clones those ` +
                'bytes whether or not a tab shows them, so every block would paint a widget whose markup a ' +
                'reader cannot read, at exit 0, with the fence still authored.',
        );
    } else if (shownAt <= index) {
        problems.push(
            `shows the "${markupSlot}" fence on window ${shownAt + 1}, at or before the live window ` +
                `(${index + 1}). The reader meets the widget, THEN the markup that painted it.`,
        );
    }
    if (!provided.has(markupSlot)) {
        problems.push(
            `mounts the "${markupSlot}" fence and no <AdwWidget> block provides that slot, so the live ` +
                'window renders nowhere. Arm 6 says the same of a tab slot; this is the pane the component ' +
                'itself provides, which arm 6 cannot see.',
        );
    }
    return problems;
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
 * The window model `AdwWidget` renders: each window's id, title, tab slots, data
 * groups and whether it runs the widget — plus the slot whose fence is mounted, the
 * one slot that is an override rather than a tab, and the slots that are a CORPUS.
 *
 * Read out of the component for the same reason the widget title is derived rather
 * than tabled: a second hand-written list is the thing that drifts, and this one
 * would drift in the more expensive direction — a port named here and absent from
 * `WINDOWS` would make this gate bless a tab that never renders.
 */
function componentWindows(root) {
    const text = readFileSync(join(root, WIDGET_COMPONENT), 'utf8');
    // `const NAME = 'value';` — a `slot:` may NAME one of these instead of repeating
    // the literal, and `MARKUP_SLOT` does, because the fence it names is mounted by one
    // window and shown by another and the component holds that in one place. Resolved
    // rather than tolerated: an identifier that resolves to nothing is reported below,
    // where a plain quoted-literal read would have silently found one slot fewer.
    const constants = new Map(
        [...text.matchAll(/\bconst ([A-Z][A-Z0-9_]*) = '([a-z][a-z0-9-]*)';/g)].map(([, name, value]) => [
            name,
            value,
        ]),
    );
    // The type annotation on the declaration carries its own `[` and `slot: string`,
    // and neither is matched: the array opens at the ` = [` after it, and a slot is a
    // quoted literal or an UPPERCASE identifier.
    const decl = /\bconst WINDOWS(?::[\s\S]*?)? = \[([\s\S]*?)\n\];/.exec(text);
    const windows = [];
    const unresolved = [];
    if (decl !== null) {
        // Split on the `id:` that opens each window, so every `slot:` between two ids
        // belongs to the window it follows. `split` with one capture group yields
        // [preamble, id, chunk, id, chunk, …].
        const parts = decl[1].split(/\bid:\s*'([a-z][a-z0-9-]*)',/);
        for (let i = 1; i < parts.length; i += 2) {
            const chunk = withoutComments(parts[i + 1]);
            const slots = [];
            for (const [, literal, name] of chunk.matchAll(/\bslot:\s*(?:'([a-z][a-z0-9-]*)'|([A-Z][A-Z0-9_]*))/g)) {
                if (literal !== undefined) {
                    slots.push(literal);
                    continue;
                }
                const resolved = constants.get(name);
                if (resolved === undefined) unresolved.push(`${parts[i]}: slot: ${name}`);
                else slots.push(resolved);
            }
            // The TITLE, read with the comments blanked out: every window's chunk is
            // mostly prose, and the live window's own note names other windows' titles
            // inside it.
            const title = /\btitle:\s*'([^']*)'/.exec(chunk);
            // A window with DATA GROUPS renders on every block, filled or refused. It is
            // not conditional on a page: arms 4 and 7 of
            // `check-generated-website-data.mjs` refuse a block that reaches neither the
            // snippet map nor the refusal map of a group, so each group's pane is always
            // one or the other. That is what makes arm 10 able to decide, from the source
            // alone, that such a window is on a page.
            const groups = /\bgroups:\s*\[([^\]]*)\]/.exec(chunk);
            windows.push({
                id: parts[i],
                slots,
                title: title === null ? null : title[1],
                groups: groups === null ? [] : [...groups[1].matchAll(/[A-Za-z_$][\w$]*/g)].map(([g]) => g),
                live: /\blive:\s*true/.test(chunk),
            });
        }
    }
    // The corpus category, read as a whole: an ABSENT declaration is a broken read, not
    // an empty category — the empty category is `{}`, and it is what a component with
    // every fence rendered would declare.
    const corpus = /\bconst CORPUS_SLOTS(?::[^=]*)? = \{([\s\S]*?)\n\};/.exec(text);
    return {
        windows,
        unresolved,
        markupSlot: constants.get('MARKUP_SLOT') ?? null,
        override: constants.get('MARKUP_OVERRIDE') ?? null,
        corpus:
            corpus === null ? null : [...corpus[1].matchAll(/^\s+([a-z][a-z0-9-]*):/gm)].map(([, slot]) => slot),
    };
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

/**
 * How a window TITLE is spelled where a page enumerates the windows: emphasised.
 *
 * Every gallery intro already writes them that way, and reading the bare string
 * instead is what a SHORT title makes vacuous. "GJS" occurs in "GJSify", in the
 * project's own name for itself and in half the prose on the site, so
 * `prose.includes('GJS')` is satisfied by a page that never enumerates a window at
 * all — the arm would then hold nothing while reporting on ten pages. The
 * emphasised form is what the enumeration IS, so it is what the arm reads.
 */
const proseName = (title) => `**${title}**`;

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

// --- arm 12: the two authored PANES of one block, and the distance between them ---

/**
 * The two slots arm 12 READS, declared once.
 *
 * One declaration because two things need it: the fence reader below, and the corpus
 * half of arm 6, which refuses a slot filed as authored-but-unrendered that no arm
 * reads. A hand-written second list there could claim a reader this file does not
 * have, which is the one way that category becomes a hole.
 */
const PANE_PAIR_SLOTS = ['gjs', 'nativescript'];

/**
 * Which arms of this gate read a slot's FENCE, and which slots each one reads.
 *
 * Derived from the arm's own input rather than written out beside it. `nativescript`
 * is also read by `check-doc-fences.mjs` (every property write in it, against the
 * port's source), and that is deliberately not listed: this map is what THIS file can
 * prove, and a reader it cannot see is a reader it must not vouch for.
 */
const SLOT_READERS = new Map([['arm 12 (the `gjs` pane held against the `nativescript` pane)', PANE_PAIR_SLOTS]]);

/**
 * The two panes of a block, dedented, as line arrays — or null where the block has
 * fewer than two.
 *
 * The fence body and not the fragment: a `<Fragment>` carries MDX indentation and a
 * ```ts opener, neither of which is part of the program a reader copies.
 */
function panePair(body) {
    const panes = {};
    const fence = new RegExp(
        `<Fragment slot="(${PANE_PAIR_SLOTS.join('|')})">\\s*\`\`\`[a-z]*\\n([\\s\\S]*?)\`\`\``,
        'g',
    );
    for (const [, slot, code] of body.matchAll(fence)) panes[slot] = code;
    if (panes.gjs === undefined || panes.nativescript === undefined) return null;
    const dedent = (text) => {
        const lines = text.replace(/^\n+|\s+$/g, '').split('\n');
        const filled = lines.filter((line) => line.trim() !== '');
        const indent = filled.length === 0 ? 0 : Math.min(...filled.map((line) => /^ */.exec(line)[0].length));
        return lines.map((line) => line.slice(indent));
    };
    return { gjs: dedent(panes.gjs), nativescript: dedent(panes.nativescript) };
}

/**
 * A line that BINDS the widget namespaces, either way it can be spelled.
 *
 * `Gio` is deliberately absent: the `gi://` arms answer `Adw` and `Gtk` and nothing
 * else (ADR 0034 § Amendment 12), so a `gi://Gio` import is a namespace the port has
 * no counterpart for and a real difference between two panes.
 */
const NAMESPACE_IMPORT =
    /^import (?:(Adw|Gtk)|\{\s*(Adw|Gtk)(?:,\s*(Adw|Gtk))?\s*\}) from '(?:gi:\/\/(?:Adw|Gtk)\?version=[^']+|@gjsify\/adwaita-nativescript)';$/;

/**
 * THE ONE NORMALISATION. A run of namespace-import lines becomes a single marker
 * naming the namespaces it binds.
 *
 * A run and not a line, because `gi://` needs one import per namespace where the
 * package barrel needs one for both — the two spellings differ in LINE COUNT, and a
 * per-line rewrite would leave that difference standing while claiming to have
 * removed it.
 */
function normalisePane(lines) {
    const out = [];
    let bound = null;
    const flush = () => {
        if (bound === null) return;
        out.push(`«widget vocabulary: ${[...bound].sort().join(', ')}»`);
        bound = null;
    };
    for (const line of lines) {
        const match = NAMESPACE_IMPORT.exec(line.trim());
        if (match === null) {
            flush();
            out.push(line);
            continue;
        }
        bound ??= new Set();
        for (const name of match.slice(1)) if (name !== undefined) bound.add(name);
    }
    flush();
    return out;
}

/** Levenshtein over LINES: how many lines a reader would have to add, drop or retype. */
function paneDistance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
        let diagonal = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const above = row[j];
            row[j] = a[i - 1] === b[j - 1] ? diagonal : 1 + Math.min(row[j], row[j - 1], diagonal);
            diagonal = above;
        }
    }
    return row[b.length];
}

/**
 * The kinds a divergence reason may open with, and the WORK each names.
 *
 * The kind is what closing the WHOLE entry would take, so where an entry carries more
 * than one the most expensive wins: `composition` > `property` > `glyph` > `vocabulary`.
 * Without that rule the cheapest word would win every argument, and the ledger would
 * read as a rename list over a set of renderer gaps.
 */
const PANE_DIVERGENCE_KINDS = new Map([
    ['vocabulary', 'same widgets and same UI; a method, property or value is spelled differently — a rename'],
    [
        'glyph',
        "the port's icon properties take an SVG SOURCE, so the pane imports the glyph — closes when the " +
            'port resolves theme names',
    ],
    ['property', 'one side sets something the other has no counterpart for — renderer work, or never'],
    [
        'composition',
        'two different programs: an XML template plus its loader, or a @nativescript/core layout standing ' +
            'in for a widget',
    ],
]);

/** The kinds and what each one MEANS, for the two failures that ask an author to pick one. */
const paneKindMenu = () => [...PANE_DIVERGENCE_KINDS].map(([kind, means]) => `      ${kind}: ${means}`).join('\n');

/**
 * Blocks whose two panes are NOT the same text, and why.
 *
 * Every entry is self-retiring: the day its two panes agree, arm 12 fails here rather
 * than passing over a reason whose cause is gone. The blocks that DO agree are
 * deliberately absent — that set is derived and printed on every run, and writing it
 * down beside this one would be the second copy that drifts.
 */
const PANE_TEXT_DIVERGENCES = {
    'Adw.PreferencesGroup':
        "vocabulary: rows go in through addRow() where libadwaita's add() takes any widget, the header " +
        'button is text/styleClasses against label/add_css_class(), and it takes no alignment — the port ' +
        'places a header suffix itself.',
    'Adw.ActionRow':
        'property: the port’s Gtk.Button is text-only, so the trailing chevron is a Gtk.Image rather than ' +
        'a flat button; add_prefix/add_suffix are setPrefix/setSuffix, and both glyphs are SVG sources.',
    'Adw.ComboRow':
        'vocabulary: the model is a string array where GTK takes a Gtk.StringList. The portable value shape ' +
        'is what would close it, and it is the same question ADR 0034 § 1 asks of every value.',
    'Adw.SpinRow':
        "property: the adjustment is @gjsify/adwaita-core's AdwAdjustment where GTK takes a Gtk.Adjustment, " +
        'and the port installs no `digits` — it renders the value the state machine holds.',
    'Adw.ExpanderRow': 'vocabulary: add_row() is addRow() on the port, and nothing else differs.',
    'Adw.ButtonRow':
        'glyph: startIconName takes an SVG source rather than a theme name, so the pane imports the glyph; ' +
        'and a style class is className rather than add_css_class().',
    'Adw.ButtonContent':
        "composition: the port's Gtk.Button is text-only, so the button around the content is a " +
        '@nativescript/core StackLayout carrying the Adwaita classes; the icon is an SVG source.',
    'Adw.SplitButton':
        'vocabulary: the menu is a plain array where GTK takes a Gio.Menu with action names — a namespace ' +
        'the gi:// arms deliberately do not answer — and the icon is an SVG source.',
    'Adw.ToggleGroup':
        'property: the port has no Adw.Toggle widget; setToggles() takes plain descriptors, and each icon is ' +
        'an SVG source.',
    'Adw.Toast':
        'property: the port has no Adw.Toast widget at all — showToast() is the whole API, its timeout is in ' +
        'milliseconds, and the overlay takes its content through setContent().',
    'Adw.AlertDialog':
        'composition: heading and body are constructor positionals, the response appearance is the NICK ' +
        'rather than an Adw.ResponseAppearance constant, and present() RESOLVES to the chosen response ' +
        "instead of taking a parent — the platform's own confirm chrome stands in for the dialog.",
    'Adw.AboutDialog':
        'property: the port exposes scalar fields only — no developers, designers or licenseType — so the ' +
        'credits fold into the developer line and the application icon is a character rather than a theme name.',
    'Adw.PreferencesDialog':
        "glyph: the page icon is an SVG source; beside it the group's rows go in through addRow()/addGroup(), " +
        'the combo model is an array and the adjustment is the portable shape.',
    'Adw.Clamp':
        'composition: the NativeScript window splits into an XML template and a loader, so this pane is the ' +
        '`~/adw` barrel the template’s xmlns resolves to plus a Builder.load(), not a widget construction.',
    'Adw.HeaderBar':
        'composition: same split as Adw.Clamp — two barrels (`~/adw`, `~/gtk`) and the loader; the tree the ' +
        'gjs pane builds is the XML tab beside this one.',
    'Adw.ToolbarView':
        'composition: same split as Adw.Clamp, plus the three glyphs an XML attribute cannot carry, which the ' +
        'loader hands to views the template gave ids.',
    'Adw.WrapBox':
        'composition: same split as Adw.Clamp — the chip run is a fixed tree, so it lives in the template and ' +
        'this pane loads it.',
    'Adw.NavigationSplitView':
        'property: the port has no Adw.NavigationPage, Adw.SidebarSection or Adw.SidebarItem, so the sidebar ' +
        'takes a flat label list and each pane is a toolbar view directly.',
    'Adw.OverlaySplitView': 'property: the same three missing widgets as Adw.NavigationSplitView, one block over.',
    'Adw.NavigationView':
        'property: pages are pushed by TAG rather than by widget, there is no Adw.NavigationPage to wrap them, ' +
        'and the port’s Gtk.Button is text-only with a `tap` listener rather than a `clicked` signal.',
    'Adw.Sidebar':
        'composition: the port’s sidebar takes a flat label list with no per-item subtitle or icon, the ' +
        'selection notify is an event NAME, and the two panes sit in a @nativescript/core GridLayout.',
    'Adw.BottomSheet':
        'composition: @nativescript/core’s StackLayout and Label stand in for Gtk.Box and Gtk.Label, which ' +
        'the port does not ship, and the boxed list is built without prefixes.',
    'Adw.Avatar':
        'glyph: iconName takes the SVG SOURCE rather than a theme name, so the fallback glyph is imported and ' +
        'handed in. Everything else about the two panes is already one text.',
    'Adw.Banner':
        'composition: the gjs pane wraps the banner in a sized Gtk.Box to give a full-width widget something ' +
        'to fill; the port lays that out itself, and its banner label is plain text with no markup subset.',
    'Adw.Spinner':
        'property: the port sizes a spinner with `size`, where GTK asks for a width, a height and two ' +
        'alignments — the port has no layout surface to put a size request on.',
    'Adw.StatusPage':
        'glyph: the icon is an SVG source; beside it `child` is setChild() and the button’s caption and ' +
        'classes are text/styleClasses.',
    'Adw.ViewSwitcher':
        'property: the port has no Adw.ViewStack page API behind the switcher — setViews() takes title, icon ' +
        'and content together — and each icon is an SVG source.',
    'Adw.ViewSwitcherBar':
        'property: the port’s view stack has no items-changed signal, so refresh() stands in for it by hand, ' +
        'and each page icon is an SVG source.',
    'Adw.TabView':
        'property: the port has no Adw.TabBar and no Adw.TabPage; setViews() carries the chips and the pages ' +
        'together, and the page icon is an SVG source.',
    'Adw.InlineViewSwitcher':
        'property: the port has no displayMode enum — an empty title is icons-only and an absent icon is ' +
        'labels-only — and the switcher takes its pages through setViews() rather than binding a stack.',
    'Adw.Carousel':
        'composition: the port has no Adw.CarouselIndicatorDots (the carousel draws its own row) and no ' +
        'Gtk.Box or Gtk.Label, so each card is a @nativescript/core StackLayout.',
    'Gtk.Button':
        'property: the port’s Gtk.Button is text-only, so the circular icon-only variant has no counterpart ' +
        'at all; label/add_css_class() are text/styleClasses and the wrap box takes no alignment.',
    'Gtk.MenuButton':
        'property: the menu is a plain array where GTK takes a Gio.Menu with action names, there is no popover ' +
        'so `primary` has no counterpart, and the icon is an SVG source.',
    'Gtk.Entry':
        'property: widthRequest and halign are GTK size and alignment requests, and the port has no layout ' +
        'surface to put them on.',
    'Gtk.DropDown':
        'property: the port has no Gtk.PropertyExpression, no Gtk.StringObject and no search field, so the ' +
        'model is a string array and enableSearch has no counterpart.',
};

/**
 * The rules of arm 12, over a world of pairs — a pure function, so the vectors below
 * can break each one with no gallery on disk.
 */
function panePartitionProblems(world) {
    const problems = [];
    let identical = 0;
    let distance = 0;
    for (const { title, gjs, nativescript } of world.pairs) {
        const a = normalisePane(gjs);
        const b = normalisePane(nativescript);
        const gap = paneDistance(a, b);
        const same = gap === 0;
        if (same) identical += 1;
        distance += gap;
        const ledgered = Object.hasOwn(world.ledger, title);
        if (same && ledgered) {
            problems.push(
                `${title}: ledgered as a pane divergence and its two panes are now the SAME TEXT. The reason ` +
                    'has been closed — delete the entry, so the gallery stops carrying a reason for a difference ' +
                    'that is gone.',
            );
        }
        if (!same && !ledgered) {
            problems.push(
                `${title}: its \`gjs\` and \`nativescript\` panes are ${gap} line(s) apart and ` +
                    'nothing says why. ADR 0034 stages 8 and 9 make the two the same text wherever the port has ' +
                    'the widget and the property; where it does not, record the reason and its kind in ' +
                    `PANE_TEXT_DIVERGENCES:\n${paneKindMenu()}`,
            );
        }
    }
    const titles = new Set(world.pairs.map((pair) => pair.title));
    for (const [title, reason] of Object.entries(world.ledger)) {
        if (!titles.has(title)) {
            problems.push(
                `${title}: ledgered as a pane divergence, and no block has both a \`gjs\` and a ` +
                    '`nativescript` pane under that title. A stale entry reads as considered when it is merely ' +
                    'forgotten.',
            );
        }
        const kind = /^([a-z]+):/.exec(reason)?.[1];
        if (kind !== undefined && PANE_DIVERGENCE_KINDS.has(kind)) continue;
        problems.push(
            `${title}: its divergence reason opens with ${kind === undefined ? 'no kind' : `"${kind}"`}, and a ` +
                `reason must open with one of:\n${paneKindMenu()}`,
        );
    }
    if (world.pairs.length === 0) {
        problems.push('no gallery block carries both a `gjs` and a `nativescript` pane — arm 12 proved nothing');
    }
    return { problems, identical, distance };
}

/**
 * Vectors for arm 12, every one of which must FAIL before a page is read.
 *
 * The last two are about the NORMALISATION itself and are the reason this list exists:
 * one proves it applies (the two import spellings really do compare equal), the other
 * that it is no WIDER than declared (a glyph import is not erased with them). A
 * normalisation that quietly grew would make every pane agree and every ledger entry
 * fail as stale, which reads like progress.
 */
const PANE_VECTORS = [
    ['the aligned baseline', { pairs: [{ title: 'A', gjs: ['x'], nativescript: ['x'] }], ledger: {} }, null],
    [
        'two panes apart with nothing saying why',
        { pairs: [{ title: 'A', gjs: ['x'], nativescript: ['y'] }], ledger: {} },
        'nothing says why',
    ],
    [
        'a ledger entry whose two panes have become one text',
        { pairs: [{ title: 'A', gjs: ['x'], nativescript: ['x'] }], ledger: { A: 'vocabulary: gone' } },
        'now the SAME TEXT',
    ],
    [
        'a ledger entry for a block with no pair',
        {
            pairs: [{ title: 'A', gjs: ['x'], nativescript: ['y'] }],
            ledger: { A: 'vocabulary: r', B: 'vocabulary: r' },
        },
        'no block has both',
    ],
    [
        'a reason that opens with no kind',
        { pairs: [{ title: 'A', gjs: ['x'], nativescript: ['y'] }], ledger: { A: 'they differ' } },
        'opens with no kind',
    ],
    [
        'a reason that opens with a kind nothing declares',
        { pairs: [{ title: 'A', gjs: ['x'], nativescript: ['y'] }], ledger: { A: 'style: they differ' } },
        'opens with "style"',
    ],
    ['no pair at all', { pairs: [], ledger: {} }, 'arm 12 proved nothing'],
    [
        'THE NORMALISATION APPLIES: the two import spellings are one text',
        {
            pairs: [
                {
                    title: 'A',
                    gjs: ["import Adw from 'gi://Adw?version=1';", "import Gtk from 'gi://Gtk?version=4.0';", 'x'],
                    nativescript: ["import { Adw, Gtk } from '@gjsify/adwaita-nativescript';", 'x'],
                },
            ],
            ledger: { A: 'vocabulary: stale, because the two are one text' },
        },
        'now the SAME TEXT',
    ],
    [
        // A CONTROL, clean on purpose: its cleanliness is what a WIDER normalisation
        // would destroy. The marker carries the namespaces it binds, so a pane that
        // reaches for `Gtk` and one that does not are still two texts. Drop the names
        // from the marker — the tempting simplification, since every marker then reads
        // alike — and these two become one text, at which point the self-retiring rule
        // fires on an entry that is still true. Measured both ways.
        'THE NORMALISATION IS NO WIDER: binding Gtk is not the same as not binding it',
        {
            pairs: [
                {
                    title: 'A',
                    gjs: ["import Adw from 'gi://Adw?version=1';", "import Gtk from 'gi://Gtk?version=4.0';", 'x'],
                    nativescript: ["import Adw from 'gi://Adw?version=1';", 'x'],
                },
            ],
            ledger: { A: 'property: the port has no counterpart for the Gtk widget beside it' },
        },
        null,
    ],
];

/**
 * What the one normalisation does, asserted directly.
 *
 * The partition vectors above can only see a widening that changes a VERDICT, and the
 * dangerous ones mostly do not: swallowing a glyph import into the marker run still
 * leaves two panes two texts, because the marker names what it binds. Measured — with
 * the specifier alternative widened to `@gjsify/*`, every partition vector stayed
 * green and only the distance moved. So the transform is held on its own OUTPUT, which
 * is the only place "one declared normalisation" is a fact rather than a claim in a
 * comment.
 */
const PANE_NORMALISATION_VECTORS = [
    [
        ["import Adw from 'gi://Adw?version=1';", "import Gtk from 'gi://Gtk?version=4.0';", 'x'],
        ['«widget vocabulary: Adw, Gtk»', 'x'],
    ],
    [
        ["import { Adw, Gtk } from '@gjsify/adwaita-nativescript';", 'x'],
        ['«widget vocabulary: Adw, Gtk»', 'x'],
    ],
    [["import { Adw } from '@gjsify/adwaita-nativescript';"], ['«widget vocabulary: Adw»']],
    // NOT normalised, each for its own reason: a glyph is a value the port needs and
    // libadwaita does not, `@nativescript/core` is a toolkit GJS has no counterpart
    // for, and `gi://Gio` is a namespace the arms deliberately do not answer.
    [
        ["import { folderSymbolic } from '@gjsify/adwaita-icons/places';"],
        ["import { folderSymbolic } from '@gjsify/adwaita-icons/places';"],
    ],
    [["import { StackLayout } from '@nativescript/core';"], ["import { StackLayout } from '@nativescript/core';"]],
    [["import Gio from 'gi://Gio?version=2.0';"], ["import Gio from 'gi://Gio?version=2.0';"]],
    // A RUN, not a line: only lines that sit together collapse into one marker.
    [
        ["import Adw from 'gi://Adw?version=1';", '', "import Gtk from 'gi://Gtk?version=4.0';"],
        ['«widget vocabulary: Adw»', '', '«widget vocabulary: Gtk»'],
    ],
];

const paneSelfTestFailures = [];
for (const [input, want] of PANE_NORMALISATION_VECTORS) {
    const got = normalisePane(input);
    if (got.join('\n') === want.join('\n')) continue;
    paneSelfTestFailures.push(
        `normalisePane(${JSON.stringify(input)}) produced ${JSON.stringify(got)} and must produce ` +
            `${JSON.stringify(want)}. The one declared normalisation is not the one that runs.`,
    );
}
for (const [label, world, expected] of PANE_VECTORS) {
    const { problems } = panePartitionProblems(world);
    if (expected === null) {
        if (problems.length > 0) paneSelfTestFailures.push(`${label} should be clean, got: ${problems.join(' | ')}`);
        continue;
    }
    if (problems.length === 0) paneSelfTestFailures.push(`${label} produced NO problem — that rule is not holding`);
    else if (!problems.some((problem) => problem.includes(expected))) {
        paneSelfTestFailures.push(
            `${label} failed for the wrong reason (wanted "${expected}"): ${problems.join(' | ')}`,
        );
    }
}
if (paneSelfTestFailures.length > 0) {
    console.error('check-website-adwaita-gallery: arm 12 SELF-TEST failed — the check itself is broken:');
    for (const failure of paneSelfTestFailures) console.error(`  - ${failure}`);
    process.exit(1);
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

const { windows, unresolved, markupSlot, override, corpus } = componentWindows(ROOT);
const ports = new Set(windows.flatMap((w) => w.slots));
if (windows.length === 0 || ports.size === 0) {
    console.error(
        `check-website-adwaita-gallery: no window or no port found in the WINDOWS array of\n` +
            `  ${WIDGET_COMPONENT} — that is a broken scan, not a component with no tabs. Nothing is\n` +
            '  unprovided in an empty set, and no window is dead in one either.',
    );
    process.exit(1);
}
if (unresolved.length > 0) {
    console.error(
        `check-website-adwaita-gallery: ${unresolved.length} slot(s) in the WINDOWS array of\n` +
            `  ${WIDGET_COMPONENT} name a constant this reader cannot resolve (${unresolved.join(', ')}).\n` +
            '  A slot read as nothing is a port arm 5 then reports as unknown on every page that fills it.',
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
if (corpus === null) {
    console.error(
        `check-website-adwaita-gallery: no CORPUS_SLOTS declared in ${WIDGET_COMPONENT}. The empty\n` +
            '  category is `{}`; an absent declaration is a broken read, and every authored-but-unrendered\n' +
            '  fence would come back from arm 5 as a misspelled port.',
    );
    process.exit(1);
}
const corpusSlots = new Set(corpus);

const blocks = widgetBlocks(ROOT, pages);
if (blocks.length === 0) {
    console.error(
        `check-website-adwaita-gallery: no <AdwWidget> … </AdwWidget> body matched under ${GALLERY}, while\n` +
            `  ${gallery.size} opening tag(s) did — the block reader is broken, not the gallery.`,
    );
    process.exit(1);
}

const provided = new Set();
/** Every slot ANY block writes, rendered or not — the corpus half of arm 6 reads this. */
const authored = new Set();
/** The blocks that override the preview window's markup tab — arm 8's input. */
const overriding = new Map();
for (const block of blocks) {
    for (const [, slot] of block.body.matchAll(/<Fragment slot="([^"]+)"/g)) {
        authored.add(slot);
        if (ports.has(slot)) {
            provided.add(slot);
            continue;
        }
        if (slot === override) {
            overriding.set(block.title, block.page);
            continue;
        }
        if (corpusSlots.has(slot)) continue;
        failures.push(
            `${block.page}: <AdwWidget title="${block.title}"> provides a "${slot}" fragment, and AdwWidget\n` +
                '    renders no slot of that name. Astro drops an unmatched slot in SILENCE — no warning, no\n' +
                '    build failure — so the snippet is written, reviewed, committed and shown to nobody.\n' +
                `    Ports: ${[...ports].join(', ')}. Markup override: ${override}. Corpus slots:\n` +
                `    ${[...corpusSlots].join(', ') || '(none)'}.`,
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

// The CORPUS half of arm 6. A corpus slot is authored on the pages, read by an arm and
// deliberately not rendered — and the category only stays honest while all three of
// those are held, because "not rendered" is otherwise indistinguishable from the
// misspelling arm 5 exists to catch. The READERS are derived from the arms themselves
// ({@link SLOT_READERS}), so a slot cannot be filed here against a reader that is not
// there.
for (const slot of corpusSlots) {
    if (ports.has(slot)) {
        failures.push(
            `${WIDGET_COMPONENT} declares "${slot}" in CORPUS_SLOTS and renders it as a tab. A corpus\n` +
                '    slot is one no window renders; the two lists cannot both be right.',
        );
        continue;
    }
    if (!authored.has(slot)) {
        failures.push(
            `${WIDGET_COMPONENT} declares "${slot}" in CORPUS_SLOTS, and no <AdwWidget> block under\n` +
                `    ${GALLERY} writes that fragment. The category covers nothing, and an empty corpus is a\n` +
                '    reason recorded for a fence nobody authors. Write the first one, or drop the entry.',
        );
    }
    const readers = [...SLOT_READERS].filter(([, slots]) => slots.includes(slot)).map(([arm]) => arm);
    if (readers.length > 0) continue;
    failures.push(
        `${WIDGET_COMPONENT} declares "${slot}" in CORPUS_SLOTS and no arm of this gate reads it. An\n` +
            '    unrendered fence that nothing reads either is a fence written for nobody — which is exactly\n' +
            '    what arm 5 refuses of a misspelled slot, so this category would be the hole to hide one in.\n' +
            `    Arms that read a fence: ${[...SLOT_READERS.keys()].join('; ')}.`,
    );
}

for (const window of windows) {
    // Every way a window can put a pane on some block: a tab slot a page filled, a data
    // group (filled or refused, so on every block), or the live preview the component
    // provides itself. A window with none of the three is a header bar over nothing.
    if (window.live || window.groups.length > 0 || window.slots.some((slot) => provided.has(slot))) continue;
    if (window.slots.length === 0) {
        failures.push(
            `${WIDGET_COMPONENT} declares the window "${window.id}" with no pane source at all: no tab, no\n` +
                '    data group, and it does not run the widget. It announces a kind of implementation that\n' +
                '    renders on no block — and arm 6 cannot see it, because there is no slot to be\n' +
                '    unprovided. Give it a pane, or drop the window.',
        );
        continue;
    }
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

// --- arm 9: the reader meets the RUNNING WIDGET before any source ---
//
// The live pane and the markup tab are ONE source: the pane mounts the bytes the tab
// shows. What makes that legible is ORDER — the widget, then the markup that painted
// it — and the two are in different WINDOWS now, so the order is a fact about the
// WINDOWS array as well as about the file that draws a window. Nothing else notices
// either half: every pane still renders, the fence is still authored once, and arm 8
// still holds.

for (const problem of previewMountPlacement(ROOT)) {
    failures.push(
        `${WINDOW_COMPONENT} ${problem}. The window that RUNS the widget shows the widget alone,\n` +
            '    directly under its header bar — see arm 9.',
    );
}
for (const problem of livePreviewDeclaration(windows, markupSlot, provided)) {
    failures.push(`${WIDGET_COMPONENT} ${problem}`);
}

// --- arm 10: a window a page SHOWS is a window the page's prose NAMES ---

/**
 * The window titles a page renders, and the ones its prose enumerates, held against
 * each other in both directions.
 *
 * THE INCIDENT. `Vanilla TypeScript` was renamed to `Native TypeScript` in
 * {@link WIDGET_COMPONENT} and nowhere else. Every gallery page's intro enumerates
 * the windows BY THESE EXACT STRINGS — the component's own note says so and relies on
 * it — so nine pages were left naming a window no block on them draws. In the same
 * commit the frameworks window went from three blocks to all forty, and seven of those
 * intros still enumerated two windows where the reader now meets three. Nothing saw
 * either: the strings never leave the prose, so the site builds and arms 1-9 stay
 * green.
 *
 * READ AS THE ENUMERATION WRITES THEM, emphasised — see {@link proseName} for the
 * short title that makes the bare read vacuous.
 *
 * WHICH WINDOWS A PAGE SHOWS, from the source alone. A window is on a page if some
 * block there provides one of its tab slots, or if it declares DATA GROUPS — those are
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
 *   · rename the window in the component alone — exit 1, on every page that draws
 *     it, which is the defect this arm is named after
 *   · drop "UI frameworks" from one page's intro — exit 1, on that page
 *   · take the `gjs` fragments off one page, so it stops drawing a window it still
 *     names — exit 1, the inverse direction
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
        if (window.groups.length > 0 || window.slots.some((slot) => slots.has(slot))) {
            shownBy.get(block.page).add(window.title);
        }
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
        const named = prose.includes(proseName(title));
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

// --- arm 12: the same block, written twice, and how far apart the two are ---

const panePairs = blocks.flatMap((block) => {
    const pair = panePair(block.body);
    return pair === null ? [] : [{ title: block.title, ...pair }];
});
const panePartition = panePartitionProblems({ pairs: panePairs, ledger: PANE_TEXT_DIVERGENCES });
failures.push(...panePartition.problems);

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
        `${windows
            .map((w) => `${w.id} [${[...(w.live ? ['«the widget»'] : []), ...w.slots, ...w.groups].join(' ')}]`)
            .join(', ')} — each rendering a pane on at least one of ${blocks.length} blocks, every fragment ` +
        `slot they write is one the component renders or a corpus slot an arm reads (${[...corpusSlots].join(
            ', ',
        )}), ${overriding.size} block(s) override the markup tab, all ledgered, and the widget is mounted ` +
        `once, outside ${WINDOW_COMPONENT}'s tab view, ahead of the window that shows its markup.`,
);

/** The ledger's own partition, by kind, so a run says what the remaining work IS. */
const paneKindCounts = new Map([...PANE_DIVERGENCE_KINDS.keys()].map((kind) => [kind, 0]));
for (const reason of Object.values(PANE_TEXT_DIVERGENCES)) {
    if (reason === null) continue;
    const kind = /^([a-z]+):/.exec(reason)?.[1];
    if (paneKindCounts.has(kind)) paneKindCounts.set(kind, paneKindCounts.get(kind) + 1);
}
console.log(
    `check-website-adwaita-gallery: ${panePairs.length} block(s) written twice — ` +
        `${panePartition.identical} are the SAME TEXT after one normalisation (the widget-namespace import ` +
        `lines), ${panePairs.length - panePartition.identical} ledgered [` +
        [...paneKindCounts].map(([kind, count]) => `${kind} ${count}`).join(', ') +
        `] — distance ${panePartition.distance} line(s) over all pairs.`,
);
