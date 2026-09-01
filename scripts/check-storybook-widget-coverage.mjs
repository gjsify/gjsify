#!/usr/bin/env node
// Every widget both renderers ship is either IN the storybook or in a ledger here,
// and every widget only ONE of them ships says whether that is a gap or a decision.
//
// WHAT THIS ADDS TO PARITY
//
// `check-storybook-story-parity.mjs` asks whether the three targets render the SAME
// stories. It is blind by construction to the story that exists nowhere: a widget with
// no `*.meta.ts` at all is perfectly symmetric across three targets, so parity is
// green and the reference storybook simply does not show it.
//
// Measured 2026-08-15, and the size of the hole is the argument for the check: of the
// 43 widgets implemented on BOTH renderers, NINE had no story anywhere — including
// `gtk-entry`, `gtk-drop-down`, `gtk-menu-button` and `adw-view-switcher-bar`, four
// ordinary widgets a reader would expect to find first. The GTK storybook is the
// reference implementation the other two are aligned against; a widget it never shows
// is a widget with no reference.
//
// WHAT IT CHECKS — the story ledger
//
//   1. Every `adw-<name>` the browser DEFINES as a custom element and NativeScript
//      ships as an `Adw*` view class has a `<name>.meta.ts` in the GTK showcase — or
//      an entry in `NO_STORY_OF_ITS_OWN` saying why not.
//   2. No ledger entry names a widget that HAS a story (a stale exemption reads as
//      considered when it is merely forgotten).
//   3. No ledger entry names a widget the rule cannot reach — one renderer only, or
//      no renderer at all. Same reason: it would look like cover it does not give.
//
// The both-renderers scope is deliberate. A widget on ONE renderer cannot have a
// three-target story, so demanding one here would demand a port, and that is a
// product decision this check has no business making.
//
// WHAT IT CHECKS — the asymmetry ledger
//
// Which is why the widgets that scope EXCLUDES need a ledger of their own
// (`ONE_RENDERER_ONLY`, #1195): the derived matrix already shows each of them as an
// asymmetric row, and a row cannot say whether the asymmetry is a GAP or a DECISION.
//
//   4. Every widget on exactly one renderer has an entry.
//   5. No entry names a widget now on BOTH renderers — it landed, drop it.
//   6. No entry names a widget on NEITHER — it went away, drop it.
//   7. An entry's `only` MATCHES the side the tree puts the widget on. Without this
//      an asymmetry that FLIPPED — ported one way, dropped the other — keeps reading
//      as covered while the reason next to it now describes the wrong renderer.
//   8. A `gap` resolves to a `### ` section of the open-TODO ledger that NAMES the
//      widget. Heading-only was not enough: every gap points at one shared section
//      whose own closing line retires a bullet once an issue exists, so following it
//      emptied the section while all five entries stayed green.
//
// STATUS.md's widget matrix is NOT checked here: an arm that did was removed, because
// its column and this check both call `adwaitaWebElements()` — `f(x)` against `f(x)`,
// green for every tree, and only an EDIT to the generator could ever make it fire.
//
// Plain Node over the repo's own files — no install, no build — so it runs in
// `audit-runtimes.yml` next to the other repo-scoped guards.
//
// Usage: node scripts/check-storybook-widget-coverage.mjs [--root <dir>]

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    TS_SOURCE_EXTENSIONS,
    sourceExtensionRe,
} from '../packages/infra/manifest-conformance/lib/source-extensions.mjs';

import { toPosixPath } from '../packages/infra/manifest-conformance/lib/index.mjs';
import {
    ADWAITA_NS_WIDGETS,
    ADWAITA_STORY_SRC,
    ADWAITA_WEB_SRC,
    adwaitaNativeScriptWidgets,
    adwaitaStoryMetas,
    adwaitaWebElements,
    elementName,
    stripComments,
} from './adwaita-elements.mjs';
import { todoAnchorMatches, todoSections } from './generate-status.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

/**
 * Widgets on both renderers that deliberately have no story of their own, and why.
 *
 * The bar is: a reader looking for this widget in the storybook finds what they came
 * for, under another name — or there is nothing a GTK story could honestly show. "It
 * would be work" is not a reason; those get a story.
 */
const NO_STORY_OF_ITS_OWN = {
    button: 'Buttons/Button Styles IS the button story — its `component` is `Gtk.Button.$gtype`, and it renders the plain button beside .pill/.circular/.suggested-action/.destructive-action/.flat. A second story would show the same widget with fewer states.',
    'toast-overlay':
        'Feedback/Toast renders it. The overlay is only ever the surface a toast appears on, so the story is named after the thing the reader is looking for.',
    'preferences-page':
        'Feedback/Preferences Dialog renders it — the story builds an `Adw.PreferencesPage`, fills it with a group of rows and adds it to the dialog. A page only ever appears inside a preferences dialog, so the story is named after the thing the reader is looking for.',
    'view-stack':
        'A stack shows exactly one page and offers no way to change it — alone it is a blank preview. Every switcher story builds one and drives it: View Switcher, Inline View Switcher, View Switcher Bar.',
    'data-grid':
        'The one widget here with no GTK renderer at all — it is an original @gjsify widget, not a libadwaita port. A GTK story would have to hand-assemble a `Gtk.Grid`, i.e. put a fourth implementation in a showcase where no package owns it. If a GTK data grid is wanted it starts as a package (#1050).',
};

/**
 * Widgets on exactly ONE renderer, and what that asymmetry IS.
 *
 *   { only: 'web' | 'nativescript', decision: '<reason>' }   the other renderer has no
 *       such concept, or expresses it differently;
 *   { only: …, gap: '#123' | an open-todos anchor }         a port nobody has written,
 *       pointing at where the work is tracked ({@link todoAnchors}).
 *
 * A DISCRIMINATED pair rather than one free-text field, because the whole value of the
 * ledger is telling those two apart: the moment "we would have to build it" is allowed
 * to sit in `decision`, every gap can be spelled as a reason and nothing is recorded.
 *
 * WHY THE ENTRIES READ LIKE CITATIONS. #1195 deliberately refused to fill this in from
 * outside the ports — "guessing eleven verdicts into a ledger produces exactly the kind
 * of confident-looking claim this repo has now deleted twice in one week (#1172,
 * #1188)". So an entry here either MOVES a reason already recorded in a source header,
 * or DERIVES one from `refs/libadwaita`; the ones that need a product decision nobody
 * has made are gaps with a pointer, and stayed gaps.
 *
 * THE UPSTREAM FACT that settles most of them, read off `G_DECLARE_*_TYPE` in the
 * headers `src/meson.build` names: only `dialog`, `window`, `navigation-page` and the
 * two carousel indicators have an Adw WIDGET behind them at all. Five more are public
 * Adw GObjects — DATA, which the browser needs a tag to declare in markup and
 * NativeScript passes as an object. The remaining thirteen have no Adw type of any
 * kind, in TWO shapes, and collapsing them into the first reads tidier than the tree
 * is: eight are stylesheet partials over a GTK primitive (`.card` in `_misc.scss`,
 * `_switch.scss`, `_popovers.scss`, `_progress-bar.scss`, `_checks.scss`,
 * `.image-button` in `_buttons.scss`, `_scale.scss`), where WHICH renderer wrapped the
 * primitive in an element is a rendering idiom, not a missing port; five are not a
 * rendered thing at all — a GtkBuildable markup child, a GtkWidget-typed property, a
 * different library, and `view-switcher-page`, which has no upstream spelling
 * whatsoever. Which of the three a given widget is, its OWN entry states.
 *
 * `vectors` is optional and names conformance tables in `@gjsify/adwaita-core` that the
 * decision leaves driven from ONE side. It is checked (see {@link vectorFailures}), so
 * the ledger doubles as the port-cost record: the tables a second renderer would
 * inherit for free are exactly the ones listed here.
 *
 * `sameWidgetAs` is optional and names the OTHER entry this one is one widget with. The
 * join here is the BARE name, so a widget the two renderers spell differently arrives as
 * two rows that each look like a missing port — `icon` on NativeScript and `image` on the
 * browser are `GtkImage` twice. Two `decision` sentences can say so, and did; nothing
 * read them, because {@link MIN_REASON} counts characters. The field is the readable half
 * of the same claim: it must name an entry that exists, that names this one back, and
 * that sits on the OTHER renderer — a pair pointing the same way is not an asymmetry
 * explained, and that is the shape a third copy of this row would take. Neither half of
 * the pair needs an exemption for the day it converges: `sameWidgetAs` cannot survive it,
 * because a widget on both renderers leaves this ledger entirely and the "it is on BOTH
 * renderers now" rule below deletes the row.
 */
const ONE_RENDERER_ONLY = {
    'alert-response': {
        only: 'web',
        decision:
            'No `AdwAlertResponse` type upstream — a response is an id passed to `adw_alert_dialog_add_response()`, whose MARKUP form is a GtkBuildable `<response>` child, which is what this element mirrors. NativeScript calls the method against the same `AdwAlertResponses` in adwaita-core, so only the browser needs a tag to declare one in.',
    },
    'bottom-sheet-content': {
        only: 'web',
        decision:
            '`adw_bottom_sheet_set_content()` is a GtkWidget-typed PROPERTY on AdwBottomSheet (adw-bottom-sheet.h:32), not a type. NativeScript calls the setter; the browser element is the markup spelling of GtkBuilder\'s `<child type="content">`, which leaves nothing in the tree. It is the markup form, not the only route: `_collectSlot` (packages/web/adwaita-web/src/elements/adw-bottom-sheet.ts:252) accepts a plain `slot="content"` child too.',
    },
    'bottom-sheet-sheet': {
        only: 'web',
        decision:
            '`adw_bottom_sheet_set_sheet()` is a GtkWidget-typed PROPERTY on AdwBottomSheet (adw-bottom-sheet.h:38), not a type. NativeScript calls the setter; the browser element is the markup spelling of GtkBuilder\'s `<child type="sheet">`, which leaves nothing in the tree. It is the markup form, not the only route: `_collectSlot` (packages/web/adwaita-web/src/elements/adw-bottom-sheet.ts:252) accepts a plain `slot="sheet"` child too.',
    },
    card: {
        only: 'web',
        decision:
            "`.card` is a libadwaita STYLE CLASS (stylesheet/widgets/_misc.scss:197) with no Adw type behind it. `<adw-card>` is a style class packaged as an element — its whole body is `classList.add('adw-card')` — and a NativeScript view sets `className` directly (showcases/dom/adwaita-storybook-nativescript/src/view-switching/carousel.ns.ts:28 already does), so a widget class there would carry no behaviour at all. The LOOK was a separate gap and is closed: `.card, .adw-card` is now a rule in packages/nativescript-bridge/adwaita/src/theme/adwaita.css, both spellings on one selector the way `.boxed-list` already carries the same surface. It rendered NOTHING until then, and scripts/check-nativescript-theme-classes.mjs could not see it either — that reader saw only the package's own widget sources, never an app's.",
    },
    'carousel-indicator-dots': {
        only: 'web',
        decision:
            '`AdwCarouselIndicatorDots` is placeable anywhere in GTK, but the NativeScript carousel builds its own dot row (row 1 of its GridLayout) and projects the shared `CarouselState` onto it through `applyCarouselDots` in its carousel-state.ts. The indicator is present there, just not detachable — its FIDELITY note (3) records the look that costs.',
    },
    'carousel-indicator-lines': {
        only: 'web',
        gap: 'open-todos: Adwaita renderer asymmetries with no verdict',
    },
    'check-button': {
        only: 'web',
        gap: 'open-todos: Adwaita renderer asymmetries with no verdict',
        vectors: ['RADIO_GROUP_VECTORS'],
    },
    dialog: {
        only: 'web',
        gap: 'open-todos: Adwaita renderer asymmetries with no verdict',
    },
    icon: {
        only: 'nativescript',
        sameWidgetAs: 'image',
        decision:
            'WHY the pair `sameWidgetAs` declares is still two rows: `NS_WIDGET_ALIGNMENT` in check-vocabulary-alignment.mjs declares `adw-icon` to be `GtkImage`, and that declaration is what the vocabulary distance counts. The browser element took the GIR name on 2026-09-01 (ADR 0034 clause 1, § Amendment 5) and the NativeScript port deliberately did not: ADR 0034 refuses that rename on cost — the port is published at 49 versions with an XML element vocabulary whose failure on a phone is a silent unresolved module. So this row is a NAMING asymmetry that the vocabulary gate already measures, not a missing port, and it retires the day the NativeScript widget converges.',
    },
    image: {
        only: 'web',
        sameWidgetAs: 'icon',
        decision:
            'The browser spelling of `GtkImage`; `sameWidgetAs` carries the pairing. What this entry holds that the field cannot is the STORY exemption it inherits the day the pair converges: there is no Adwaita or GTK icon WIDGET to reference; GTK draws a `Gtk.Image` inline (the navigation stories do), and the browser element exists because CSS needs a box to hang a symbolic on, so a story would demonstrate a GTK primitive rather than an Adwaita widget.',
    },
    'image-button': {
        only: 'nativescript',
        decision:
            'Recorded in adw-image-button.ts:6-8: "NativeScript\'s `Button` is text-only (it cannot host a child view), so an icon button is a tappable `GridLayout` holding a centered `Image`." Upstream `.image-button` is a style class (_buttons.scss:66); on the browser it exists only as the split button\'s CSS-node-contract mirror (adw-split-button.ts:372 toggles it on the HOST, per `splitbutton[.image-button]`) and is styled in no adwaita-web stylesheet, so no browser element carries the idiom either.',
    },
    'navigation-page': {
        only: 'web',
        decision:
            'The only widget here whose upstream type IS a widget and whose properties are already shared: tag/title/can-pop are `AdwNavigationPageProps` in adwaita-core, and NativeScript pushes any `View` with that object (`NsNavigationStack.push(viewOrTag, options)`). The page exists there as data plus a plain view; only the browser needs an element to carry the attributes.',
    },
    popover: {
        only: 'web',
        decision:
            'Recorded in packages/nativescript-bridge/adwaita/src/widgets/adw-drop-down.ts:14-16 — the NativeScript file, which no longer shares a name with the browser one: "the NS subset has none, so the options open in the platform `action()` sheet, the same substitution `AdwComboRow`, `AdwSplitButton` and `AdwMenuButton` make." Upstream has no AdwPopover either — GtkPopover styled by _popovers.scss.',
        vectors: ['POPOVER_SURFACE_VECTORS', 'POPOVER_KEY_VECTORS'],
    },
    'progress-bar': {
        only: 'web',
        gap: 'open-todos: Adwaita renderer asymmetries with no verdict',
    },
    radio: {
        only: 'web',
        gap: 'open-todos: Adwaita renderer asymmetries with no verdict',
        vectors: ['RADIO_GROUP_VECTORS'],
    },
    'sidebar-item': {
        only: 'web',
        decision:
            '`AdwSidebarItem` is declared against GObject, not GtkWidget (adw-sidebar-item.h) — it is DATA. NativeScript holds the same data as an `AdwSidebarItemSpec` in the shared `SidebarState`, so this element is the markup form of a model both renderers already run.',
    },
    'sidebar-section': {
        only: 'web',
        decision:
            '`AdwSidebarSection` is declared against GObject, not GtkWidget (adw-sidebar-section.h) — it is DATA. NativeScript holds the same data as an `AdwSidebarSectionSpec` in the shared `SidebarState`, so this element is the markup form of a model both renderers already run.',
    },
    'slider-row': {
        only: 'nativescript',
        decision:
            "Recorded in adw-slider-row.ts:3-6: it is \"the NS counterpart of the GTK storybook's `Gtk.Scale` RANGE card and the browser's `input[type=range]` `.sb-range-row`\". Both renderers SHOW a range control, but the browser's is the storybook's `.sb-range-row` (packages/web/adwaita-storybook/src/styles.ts:291), not an adwaita-web element — inside this ledger's universe the browser has none. Upstream has no AdwSliderRow (no such public header), and only NativeScript needed a widget class to get one that looks native.",
    },
    'source-view': {
        only: 'web',
        decision:
            'Not a libadwaita widget at all — the GTK twin is GtkSourceView, a separate library, and no Adw type exists. The element is an opt-in subpath (`@gjsify/adwaita-web/source-view`) binding CodeMirror 6, which renders into a DOM NativeScript does not have, so there is no port of THIS element to write.',
    },
    switch: {
        only: 'web',
        decision:
            'Upstream has no AdwSwitch: _switch.scss styles the GtkSwitch node. `@nativescript/core` ships a real `Switch` view, which `AdwSwitchRow` installs directly; the browser has no such control, so `<gtk-switch>` is the 44x24 track a hidden checkbox needs to look like one. Its own header records there is no behaviour to port either — "the state is one boolean with no derivation" (gtk-switch.ts:7-8).',
    },
    'tab-page': {
        only: 'web',
        decision:
            '`AdwTabPage` is declared against GObject, not GtkWidget (adw-tab-view.h) — it is DATA, held on NativeScript by `TabViewState` and projected through tab-view-state.ts. The browser element is that descriptor in markup, and doubles as the page panel the tab reveals.',
    },
    toggle: {
        only: 'web',
        decision:
            '`AdwToggle` is declared against GObject, not GtkWidget (adw-toggle-group.h) — it is DATA. NativeScript passes the same labels and icons through `options` / `setToggles` into the shared `ToggleGroupState`, so only the browser needs a tag to declare one in.',
    },
    'view-stack-page': {
        only: 'web',
        decision:
            '`AdwViewStackPage` is declared against GObject, not GtkWidget (adw-view-stack.h) — it is DATA. NativeScript passes the same page descriptors to `AdwViewSwitcherBase.setViews`, so only the browser needs a tag to declare one in.',
    },
    'view-switcher-page': {
        only: 'web',
        decision:
            "There is no AdwViewSwitcherPage upstream at all: a view switcher takes an AdwViewStack and reads its AdwViewStackPages. This element is this port's markup form of that same page descriptor, and NativeScript passes the descriptors to `AdwViewSwitcherBase.setViews`.",
    },
    window: {
        only: 'web',
        decision:
            'NativeScript\'s `Page` IS the window: the storybook\'s Page carries `class="adw-window"` (showcases/dom/adwaita-storybook-nativescript/app/storybook-page.xml) and the theme styles `Page.adw-window` (packages/nativescript-bridge/adwaita/src/theme/adwaita.css:23-24). `<adw-window>` exists because a browser document has no page object to hang the frame on.',
    },
};

/**
 * The floor `check-nativescript-theme-classes.mjs` set: it refuses a blank, it judges
 * nothing. BOTH ledgers here buy an exemption with a sentence, so both apply it.
 */
const MIN_REASON = 40;

/** Where a `gap` may point, in the two spellings `gjsify/todo-needs-anchor` already accepts. */
const GAP_ISSUE = /^#\d+$/;
const GAP_TODO = /^open-todos: (\S.*)$/;
const OPEN_TODOS = 'status/open-todos.md';

/**
 * The open-TODO sections a `gap` may point at, via `generate-status.mjs`'s OWN resolver
 * ({@link todoSections} / {@link todoAnchorMatches}) rather than a second copy — the
 * copy this replaced stripped emphasis from the heading but not the anchor, so a `gap`
 * quoting a heading verbatim was rejected here and accepted there.
 *
 * IT IS RESOLVED HERE rather than left to that rule, which does walk `scripts/`:
 * measured, its anchor pattern has to reach a `)` before the next `*`, which is the
 * shape of the `TODO(…)` comment markers it was written for. A pointer sitting in a
 * data field reaches neither, so it matches nothing at all and passes in silence — and
 * a pointer nothing resolves is precisely the failure this ledger exists to stop.
 *
 * Which is also why no comment or message in this file spells a WHOLE anchor: that rule
 * reads any complete one it finds here as a marker of this file's own, so an EXAMPLE of
 * the shape is a dangling anchor. Measured on the first run — two findings, both prose.
 */
function todoAnchors() {
    return todoSections(readFileSync(join(ROOT, OPEN_TODOS), 'utf8'));
}

/**
 * Every TypeScript source under `dir`, specs INCLUDED — a conformance table is driven
 * from a spec. The extension set is the shared one; `.ts` alone would drop a `.mts` or
 * `.tsx` widget out of the coverage ledger as though it did not exist.
 */
const SOURCE_RE = sourceExtensionRe(TS_SOURCE_EXTENSIONS);
function typescriptFiles(dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...typescriptFiles(path));
        else if (SOURCE_RE.test(entry.name)) found.push(path);
    }
    return found;
}

/** The conformance tables `@gjsify/adwaita-core` publishes — what a `vectors` entry may name. */
const CORE_CONFORMANCE = 'packages/web/adwaita-core/src/conformance';

/** Each renderer's package source root, which is where its specs live too. */
const RENDERER_SRC = {
    web: join(ROOT, ADWAITA_WEB_SRC),
    nativescript: resolve(ROOT, ADWAITA_NS_WIDGETS, '..'),
};

const OTHER_RENDERER = { web: 'nativescript', nativescript: 'web' };
const SIDE_LABEL = { web: 'the browser only', nativescript: 'NativeScript only' };
const SIDES = Object.keys(OTHER_RENDERER);

/**
 * Table names matched in the CODE of `dir`, comments blanked out first — load-bearing
 * on the `driven` side, where a MENTION is not a consumer: both trees name `_VECTORS`
 * tables in prose, and `split-view-state.spec.ts` has a comment recording that a table
 * has NO consumer there, the exact opposite of driving it.
 *
 * @param {string} dir @param {RegExp} pattern @returns {Set<string>}
 */
function tableNames(dir, pattern) {
    const found = new Set();
    for (const file of typescriptFiles(dir)) {
        for (const [, name] of stripComments(readFileSync(file, 'utf8')).matchAll(pattern)) found.add(name);
    }
    return found;
}

/**
 * Hold a `vectors` claim: each table must EXIST in adwaita-core, and the renderer that
 * does NOT have the widget must not drive it.
 *
 * Only that direction. The renderer that HAS the widget is not required to drive the
 * table, because a table may legitimately be driven by core's own spec alone —
 * `POPOVER_KEY_VECTORS` is, today. Requiring the positive arm would fail on the honest
 * case and teach people to delete the claim.
 *
 * What it buys: the entry retires itself. The day a NativeScript checkbox spec drives
 * `RADIO_GROUP_VECTORS`, the port has happened and this says so.
 *
 * @param {string} name widget name, for the message
 * @param {{only: string, vectors?: string[]}} entry
 * @param {() => Set<string>} exported
 * @returns {string[]}
 */
function vectorFailures(name, entry, exported) {
    if (entry.vectors === undefined) return [];
    // Unchecked, a bare string spreads into 19 findings about the letter `R`.
    if (!Array.isArray(entry.vectors)) {
        return [
            `${spell(name)}: \`vectors\` must be a LIST of conformance table names, not a ${typeof entry.vectors}.`,
        ];
    }
    const problems = [];
    const other = OTHER_RENDERER[entry.only];
    const driven = tableNames(RENDERER_SRC[other], /\b([A-Z][A-Z0-9_]*_VECTORS)\b/g);
    for (const table of entry.vectors) {
        if (!exported().has(table)) {
            problems.push(
                `${spell(name)}: \`vectors\` names ${table}, which ${CORE_CONFORMANCE} does not export. ` +
                    'A table that is not there strands nothing.',
            );
        } else if (driven.has(table)) {
            problems.push(
                `${spell(name)}: \`vectors\` claims ${table} is driven from one side, but the ${other} renderer ` +
                    'drives it too — the asymmetry this entry describes is over, so re-read the entry.',
            );
        }
    }
    return problems;
}

/**
 * The three things `sameWidgetAs` claims, each of which can be wrong on its own: the
 * partner EXISTS, it names this entry BACK, and it is on the OTHER renderer. Only the
 * third distinguishes "one widget, two spellings" from two rows that happen to mention
 * each other, and it is the one a copied entry gets wrong.
 */
function pairFailures(name, entry) {
    if (entry.sameWidgetAs === undefined) return [];
    const partner = ONE_RENDERER_ONLY[entry.sameWidgetAs];
    if (partner === undefined) {
        return [
            `${spell(name)}: \`sameWidgetAs\` names \`${entry.sameWidgetAs}\`, which is not an entry here. ` +
                'One widget under two spellings is two rows in THIS ledger, or it is not this shape at all.',
        ];
    }
    if (partner.sameWidgetAs !== name) {
        return [
            `${spell(name)}: \`sameWidgetAs\` names \`${entry.sameWidgetAs}\`, which does not name it back. ` +
                'A pairing one side believes in is a claim about the other side that nobody made.',
        ];
    }
    if (partner.only === entry.only) {
        return [
            `${spell(name)}: \`sameWidgetAs\` pairs it with \`${entry.sameWidgetAs}\`, but both are ` +
                `\`only: '${entry.only}'\`. A pair on ONE renderer explains no asymmetry — it is two widgets ` +
                'that renderer ships, or one row too many.',
        ];
    }
    return [];
}

/** @type {Map<string, string>} */
let defines;
/** @type {Map<string, string>} */
let ns;
/** @type {Set<string>} */
let stories;
try {
    defines = adwaitaWebElements(ROOT);
    ns = adwaitaNativeScriptWidgets(ROOT);
    stories = new Set(adwaitaStoryMetas(ROOT).keys());
} catch (error) {
    // All three readers throw on a vacuous scan by design; catch to keep this script's prefix.
    console.error(`check-storybook-widget-coverage: ${error.message}`);
    process.exit(1);
}

// The WEB side keyed on its bare name, alongside the tag it is actually registered
// under. Both are needed and they are no longer the same string with `adw-` in front:
// a web element is named after the library that owns its GType (ADR 0034 clause 1), so
// `image` is `<gtk-image>` and `check-button` is `<gtk-check-button>` while `sidebar` is
// still `<adw-sidebar>`. Rebuilding a tag by prefixing `adw-` found no file for the
// renamed ones and printed an empty parenthesis where the path belongs.
const webTags = new Map([...defines.keys()].map((tag) => [elementName(tag), tag]));
const web = new Set(webTags.keys());

/**
 * How to SPELL a widget in a message: its web tag where the browser has one, else the
 * NativeScript file spelling, which is `adw-` throughout.
 */
const spell = (name) => webTags.get(name) ?? `adw-${name}`;

const onBothRenderers = [...web].filter((name) => ns.has(name)).sort();
const failures = [];

for (const name of onBothRenderers) {
    if (stories.has(name)) continue;
    if (name in NO_STORY_OF_ITS_OWN) continue;
    failures.push(
        `${spell(name)}: shipped by both renderers, rendered by no story. Add ${name}.meta.ts + its three\n` +
            '    renderings, or add it to NO_STORY_OF_ITS_OWN in this script with the reason.',
    );
}

for (const [name, reason] of Object.entries(NO_STORY_OF_ITS_OWN)) {
    if (stories.has(name)) {
        failures.push(`${spell(name)}: exempted here, but ${name}.meta.ts exists — drop the stale exemption.`);
    } else if (!web.has(name) || !ns.has(name)) {
        const where = web.has(name) ? 'the browser only' : ns.has(name) ? 'NativeScript only' : 'neither renderer';
        failures.push(
            `${spell(name)}: exempted here, but it is on ${where} — outside this check's scope, so the entry covers nothing.`,
        );
    } else if (reason.trim().length < MIN_REASON) {
        // Without this, `icon: ''` bought a story exemption in silence while
        // `decision: ''` did not — one file, two ledgers, one bar.
        failures.push(
            `${spell(name)}: exempted here with no real reason — say where the reader finds this widget ` +
                'instead, or why a GTK story could show nothing honest.',
        );
    }
}

/** Widget name → the side the TREE puts it on. The question `only` has to agree with. */
const asymmetric = new Map();
for (const name of web) if (!ns.has(name)) asymmetric.set(name, 'web');
for (const name of ns.keys()) if (!web.has(name)) asymmetric.set(name, 'nativescript');

const unverdicted = [];
let exportedTables;
const exported = () =>
    (exportedTables ??= tableNames(join(ROOT, CORE_CONFORMANCE), /export const ([A-Z][A-Z0-9_]*_VECTORS)\b/g));
const anchors = todoAnchors();

for (const [name, side] of [...asymmetric].sort()) {
    if (name in ONE_RENDERER_ONLY) continue;
    const file = toPosixPath(defines.get(spell(name)) ?? ns.get(name) ?? '');
    unverdicted.push(
        `${spell(name)} (${file}): on ${SIDE_LABEL[side]}, and nothing says whether that is a gap or a\n` +
            `    decision. Add it to ONE_RENDERER_ONLY as { only: '${side}', decision: '…' } — or, if the port\n` +
            `    is simply unwritten, { only: '${side}', gap: '#<issue>' } — or an open-todos anchor.`,
    );
}

for (const [name, entry] of Object.entries(ONE_RENDERER_ONLY)) {
    const side = asymmetric.get(name);
    if (side === undefined) {
        const where = web.has(name) && ns.has(name) ? 'on BOTH renderers now — it landed' : 'on NEITHER renderer';
        unverdicted.push(`${spell(name)}: ledgered as one-renderer-only, but it is ${where}. Drop the entry.`);
        continue;
    }
    // BEFORE the side comparison: a missing or misspelled `only` is not a flipped
    // asymmetry, and reporting it as one sends the author to re-read a sound reason.
    if (!SIDES.includes(entry.only)) {
        unverdicted.push(
            `${spell(name)}: \`only\` is \`${JSON.stringify(entry.only)}\` — it must be one of ${SIDES.map((s) => `'${s}'`).join(' / ')}, ` +
                'the two renderers this ledger compares.',
        );
        continue;
    }
    if (entry.only !== side) {
        unverdicted.push(
            `${spell(name)}: ledgered as \`only: '${entry.only}'\`, but the tree has it on ${SIDE_LABEL[side]}. ` +
                'The asymmetry flipped, so the reason recorded here is about the wrong renderer — re-read it.',
        );
        continue;
    }

    const gap = typeof entry.gap === 'string';
    if (gap === (typeof entry.decision === 'string')) {
        unverdicted.push(
            `${spell(name)}: needs exactly one of \`decision\` (the other renderer expresses it differently) ` +
                'and `gap` (a port nobody has written). Neither, or both, records nothing.',
        );
    } else if (gap) {
        const todo = GAP_TODO.exec(entry.gap);
        if (!GAP_ISSUE.test(entry.gap) && todo === null) {
            unverdicted.push(
                `${spell(name)}: \`gap\` must be \`#<issue>\`, or the open-todos anchor — that word, a colon and ` +
                    `enough of a \`### \` heading in ${OPEN_TODOS} to name it. "${entry.gap}" points nowhere.`,
            );
        } else if (todo !== null) {
            const matched = todoAnchorMatches(anchors, todo[1]);
            if (matched.length === 0) {
                unverdicted.push(
                    `${spell(name)}: \`gap\` anchors to "${entry.gap}", but no \`### \` heading in ${OPEN_TODOS} ` +
                        'contains that text — the entry was renamed or deleted, or it was never written.',
                );
            } else if (!matched.some((section) => section.body.includes(spell(name)))) {
                unverdicted.push(
                    `${spell(name)}: \`gap\` anchors to "${entry.gap}", but that section of ${OPEN_TODOS} never ` +
                        `names ${spell(name)}. A heading is not a record — either write what this gap is waiting ` +
                        'on there, or re-point the `gap` at the issue that now tracks it.',
                );
            }
        }
    } else if (entry.decision.trim().length < MIN_REASON) {
        unverdicted.push(
            `${spell(name)}: \`decision\` with no real reason — say what the other renderer does INSTEAD, or ` +
                'why there is nothing there to do.',
        );
    }
    unverdicted.push(...pairFailures(name, entry));

    unverdicted.push(...vectorFailures(name, entry, exported));
}

let failed = false;

if (failures.length > 0) {
    failed = true;
    console.error(`check-storybook-widget-coverage: ${failures.length} story problem(s):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
        '\nThe GTK storybook is the reference the other two targets are aligned against, so a widget it\n' +
            'never shows is a widget with no reference — and story-set parity cannot see that, because a\n' +
            'story missing from all three targets is perfectly symmetric.\n' +
            `  elements: ${ADWAITA_WEB_SRC}    widgets: ${ADWAITA_NS_WIDGETS}    stories: ${ADWAITA_STORY_SRC}`,
    );
}

if (unverdicted.length > 0) {
    failed = true;
    console.error(`\ncheck-storybook-widget-coverage: ${unverdicted.length} asymmetry problem(s):\n`);
    for (const failure of unverdicted) console.error(`  - ${failure}`);
    console.error(
        '\nA widget on one renderer only is either a DECISION (the other has no such concept, or expresses\n' +
            'it differently) or a GAP (a port nobody has written). The derived matrix shows the asymmetry and\n' +
            'cannot tell you which, so the verdict is recorded next to the widget — and a gap may not be\n' +
            'spelled as a reason, which is why the two are separate keys.\n' +
            `  ledger: ONE_RENDERER_ONLY in ${toPosixPath(relative(ROOT, fileURLToPath(import.meta.url)))}`,
    );
}

if (failed) process.exit(1);

const exempt = Object.keys(NO_STORY_OF_ITS_OWN).length;
const gaps = Object.values(ONE_RENDERER_ONLY).filter((entry) => typeof entry.gap === 'string').length;
console.log(
    `check-storybook-widget-coverage: ${onBothRenderers.length} widgets on both renderers — ` +
        `${onBothRenderers.length - exempt} with a story, ${exempt} ledgered with a reason; ` +
        `${asymmetric.size} on one renderer — ${asymmetric.size - gaps} a decision, ${gaps} an open gap.`,
);
