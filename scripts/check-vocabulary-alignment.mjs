#!/usr/bin/env node
// ONE widget vocabulary across the surfaces that claim to share it — and the check proves
// itself on broken input before it looks at the repository.
//
// WHAT ADR 0027 § 9 PROMISED, and what was missing
//
// One vocabulary across native GTK, Blueprint/XML, TSX/JSX, Vue templates and the web
// pillar's `adw-*` elements is an explicit goal. ADR 0028 § 6 named the mechanism — a
// data-only vocabulary export plus "a cross-dialect NAME-AGREEMENT check against
// adwaita-web's custom elements, an independent source, which is the part that can
// actually go red" — and `status/open-todos.md` carried it as the missing piece, cheap
// once the generator existed. The generator exists. This is that check.
//
// THE THREE PARTS, and which of them can find a surprise
//
//  1. THE THREE DIALECTS. `jsx-runtime.ts`, `react-jsx-runtime.ts` and
//     `vue-components.ts` are mapped types over the GENERATED maps, so asking whether
//     they name the same widgets is, today, asking whether a mapped type agrees with its
//     own source: it does, by construction. Checking that would be the green-without-
//     measuring class this repository pays most for. So this half asserts the two things
//     that are NOT structural:
//
//       a) the four generated maps agree with the RUNTIME table and with the test-only
//          surface data — four separately emitted artifacts, three files, one generator
//          run. A tag in `WidgetPropsByTag` with no row in `generated/widgets.ts` is a
//          tag JSX accepts and `createElement` refuses, and nothing else notices;
//       b) each dialect module still DERIVES its element list from those maps. The day
//          one of them grows a list of its own, the mapped-type argument stops holding —
//          and that is exactly the hand-maintained per-framework table ADR 0027 § 7
//          exists to prevent. `src/adapters/` already has that guard
//          (`check-adapter-import-direction.mjs`); the dialect modules at `src/` did not.
//
//  2. THE WEB ELEMENTS. `packages/web/adwaita-web` registers its `adw-*` custom elements
//     from its own source, with no reference to the GIR, the descriptor table or any
//     generated file. Two independent sources, so this half can carry a surprise. Every
//     element whose spelling is not a GTK tag has to be declared — as naming the same
//     widget under a different spelling, or as deliberately web-only — and either way
//     WITH A REASON.
//
//     No count is written in this header any more. The one that used to be here ("65
//     elements against 164 GTK tags, 43 sharing a spelling exactly") was already wrong
//     when ADR 0034 cited this line: the generated table grew to 168 the same week and
//     the prose did not follow. Every number is DERIVED and printed by the summary at
//     the bottom of this file, which is the only place that cannot drift.
//
//  3. THE NATIVESCRIPT WIDGETS. `packages/nativescript-bridge/adwaita` names widgets
//     too — an `Adw<Widget>` class per `adw-<name>.ts` — and appeared in this check
//     nowhere, which is how four GTK widgets came to wear an `Adw` prefix there
//     unnoticed: `AdwButton`, `AdwDropDown`, `AdwEntry`, `AdwMenuButton`, none of which
//     libadwaita subclasses. The surface carrying the defect sat outside the world of
//     the check that would have found it, so no gate could have failed. ADR 0034 § 5
//     widens the check to every widget surface for exactly that reason, and this is the
//     NativeScript half of it. Nothing is renamed: the port is published, and a rename
//     is a separate decision the ledger exists to give a number to.
//
// WHICH HALF CAN GO RED — INCLUDING THE PARTS ADDED LAST
//
// The § 1 argument above is that a rule comparing a mapped type with its own source is
// green by construction. Every rule added since has to answer the same question, so:
//
//   CAN go red, because two independent sources disagree. Both Adwaita surfaces spell
//   their widget names BY HAND — in `customElements.define('adw-…')` on the web and in
//   the `adw-<name>.ts` filename plus its exported class on NativeScript — while the
//   widget table is emitted from the GIR by a generator that reads neither. A widget
//   with no GIR counterpart and no entry fails; an entry whose target stops being a GIR
//   type or a tag fails; an entry for a widget the surface no longer ships fails; an
//   entry for a widget whose spelling already matches fails as redundant. This is the
//   half that would have caught the four flattened GTK widgets, and the half that goes
//   red the first time either surface grows a widget under a name that is not its
//   GType's.
//
//   CANNOT go red, said here rather than left to be assumed. The REASON rules — `why`
//   required on an alias, the minimum length, `#NNNN` on a `gap` — hold a table in this
//   file against a constant in this file. They can only fail on an edit to this file and
//   can never notice anything about the tree: they refuse a shortcut, they do not
//   measure. Worth having (an alias with no reason is indistinguishable from a decision
//   nobody made, which is the hole ADR 0034 § 1 closes) and NOT evidence about the
//   repository. The empty-corpus guards cannot fire against real data either: both
//   readers in `adwaita-elements.mjs` THROW on an empty scan, so those two rules exist
//   only to keep `alignmentProblems` from passing vacuously over a world some future
//   caller built by hand — which is what the self-test does.
//
//   WHAT NO HALF PROVES: behaviour. `<adw-checkbox>` is DECLARED to mean
//   `gtk-check-button` and `AdwEntry` is DECLARED to be `GtkEntry`; nothing here asserts
//   either behaves like one. The closing criterion stays ADR 0027 § 9's conformance
//   vectors, and every surface added to this file inherits that limit unchanged.
//
// WHY THE TABLE IS NOT gtkx's `omittedProps`
//
// ADR 0029 § 4 refuses to copy gtkx's 40 hand-typed omissions because they are "two
// parallel hand-maintained tables joined by a shared `string[]` with no consistency
// check". The two tables below are hand-written too; the difference is that every entry
// is held against two live sets in both directions. A target that stops being a tag or a
// GType fails. An entry for a widget that no longer exists fails. A widget the table does
// not mention fails. An entry for a widget whose spelling already matches fails as
// redundant. Neither table can rot quietly, which is the whole objection.
//
// SELF-TEST FIRST
//
// The rules are pure functions over plain data, and every one of them runs against a
// synthetic input that must FAIL before the real data is read. A check that cannot show
// its own red is asserting its own configuration.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adwaitaNativeScriptWidgets, adwaitaWebElements, elementName, widgetClass } from './adwaita-elements.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = join('packages', 'framework', 'gtk-host', 'src');
const PROPS = join(HOST, 'generated', 'props.ts');
const WIDGETS = join(HOST, 'generated', 'widgets.ts');
const SURFACE_DATA = join(HOST, 'generated', 'surface-data.mts');

/**
 * The dialect modules, and the generated map each one must keep deriving from.
 *
 * Not `src/adapters/` — those are held by `check-adapter-import-direction.mjs`, which
 * reads the same rule from the other side (no widget knowledge in an adapter). These three
 * are the TYPE surfaces, they live one directory up, and nothing looked at them.
 */
const DIALECTS = [
    { name: 'jsx/solid', file: join(HOST, 'jsx-runtime.ts'), needs: ['WidgetPropsByTag', 'WidgetClassByTag'] },
    { name: 'react', file: join(HOST, 'react-jsx-runtime.ts'), needs: ['WidgetPropsByTag', 'WidgetClassByTag'] },
    { name: 'vue', file: join(HOST, 'vue-components.ts'), needs: ['WidgetPropsByGType', 'WidgetPropsVueAliases'] },
];

/** Named in every failure that asks for an edit to one of the tables below. */
const TABLE_SOURCE = 'WEB_ELEMENT_ALIGNMENT in scripts/check-vocabulary-alignment.mjs';
const NS_TABLE_SOURCE = 'NS_WIDGET_ALIGNMENT in scripts/check-vocabulary-alignment.mjs';

/**
 * The floor a declared divergence has to clear, borrowed rather than invented:
 * `check-storybook-widget-coverage.mjs` and `check-nativescript-theme-classes.mjs` both
 * buy an exemption with a sentence and both set it here. It refuses a blank; it judges
 * nothing, and it cannot — see the header on which rules can go red.
 */
const MIN_REASON = 40;

/**
 * The four kinds a NativeScript entry may be, and the one shape a `gap` may point at.
 *
 * Order is the order they are offered in a failure message, weakest last: `gap` is the
 * only kind that records no verdict, so it reads as the last resort it is.
 */
const NS_KINDS = ['gir', 'composes', 'own', 'gap'];
const GAP_ISSUE = /^#\d+$/;

/**
 * Every `adw-*` element whose spelling is NOT a GTK tag, and what it is instead.
 *
 * `gtk` — the same widget under a different name, so the vocabularies agree on the THING
 * and differ on the spelling. `webOnly` — no GTK widget behind it at all, with the reason,
 * because "web-only" without one is indistinguishable from an oversight.
 *
 * BOTH KINDS CARRY A REASON, and the `gtk` half did not until ADR 0034 § 1. An alias
 * satisfied this check permanently and silently, so a divergence and a decision looked
 * identical in the data — the same hole `webOnly` was given a reason to close, left open
 * on the kind that has ten entries. The ten reasons below were MOVED, not invented: eight
 * are the element header stating what the widget is, and the remaining two are derived
 * from `generated/props.ts` and from the storybook coverage ledger, both cited in place.
 *
 * The GObject-but-not-GtkWidget group is the interesting one: `AdwToggle`,
 * `AdwTabPage`, `AdwViewStackPage`, `AdwSidebarItem` and `AdwSidebarSection` are real
 * libadwaita types that descend from `GObject.Object` and not from `GtkWidget`, so they
 * have no tag in a table of concrete widgets — measured against the Adw-1 GIR. On the web
 * they must be elements, because a declarative child is the only way to write them in
 * HTML.
 */
const WEB_ELEMENT_ALIGNMENT = {
    // Same widget, different spelling. The `why` says what the widget IS and where that
    // was read; the shared half of the answer — that libadwaita subclasses none of these
    // and reaches them through a stylesheet partial instead — is the comment above.
    'adw-button': {
        gtk: 'gtk-button',
        why: 'libadwaita subclasses no button: the Adwaita look is style classes over GtkButton (.suggested-action / .destructive-action / .flat / .pill in refs/libadwaita/src/stylesheet/widgets/_buttons.scss), which is exactly what this element applies. adw-button.ts:1-7 cites that partial as its reference. The adw- prefix names the design system, not the widget.',
    },
    'adw-checkbox': {
        gtk: 'gtk-check-button',
        why: 'GTK4 has one check widget, GtkCheckButton, and libadwaita adds only _checks.scss on top of it. adw-checks.ts:1-5 defines this element and <adw-radio> in one module for the same reason upstream keeps one partial: everything but the corner radius, the glyph and the group is shared.',
    },
    'adw-drop-down': {
        gtk: 'gtk-drop-down',
        why: 'The element header states the identity outright: "the web counterpart of Gtk.DropDown" (adw-drop-down.ts:1-2). libadwaita ships no drop down; _dropdowns.scss styles the GTK one. AdwComboRow is the boxed-list ROW form and is a genuine Adw type, which is why it is not in this table.',
    },
    'adw-entry': {
        gtk: 'gtk-entry',
        why: 'libadwaita ships no entry — _entries.scss styles GtkEntry — and the element mirrors the Gtk.Entry activate signal by name (adw-entry.ts:4-5). The documentation already tells readers this in prose, on the page whose markup fence says adw-: website/src/content/docs/adwaita/controls.mdx:14-17.',
    },
    'adw-icon': {
        gtk: 'gtk-image',
        why: 'There is no Adwaita icon widget on any surface. On GTK a symbolic icon is a Gtk.Image with an icon-name, drawn inline; here it is a CSS-masked box whose glyph comes from a generated .adw-icon--<name> class (adw-icon.ts:1-5). check-storybook-widget-coverage.mjs records the same verdict for the storybook: "GTK draws a Gtk.Image inline".',
    },
    'adw-menu-button': {
        gtk: 'gtk-menu-button',
        why: 'The header says it and names the reason: "the web counterpart of Gtk.MenuButton, which libadwaita styles but never subclassed" (adw-menu-button.ts:1-2). website/src/components/AdwWidget.astro states the same mismatch in the comment where it derives the adw- prefix from a page title.',
    },
    'adw-popover': {
        gtk: 'gtk-popover',
        why: '"the web counterpart of GtkPopover as libadwaita styles it" (adw-popover.ts:1-2). _popovers.scss is a stylesheet partial over the GTK type and there is no AdwPopover; this is the ONE popover the package has, which is what keeps the radius, the shadow and the dismissal machine in one place.',
    },
    'adw-progress-bar': {
        gtk: 'gtk-progress-bar',
        why: 'libadwaita vendors no adw-progress-bar.c — the element header records that while explaining which GtkProgressBar pulse semantics it therefore cannot reproduce (adw-progress-bar.ts:9-14). _progress-bar.scss styles the GTK widget and adds no type.',
    },
    'adw-radio': {
        gtk: 'gtk-check-button',
        why: 'GTK4 has no radio TYPE. A radio is a GtkCheckButton with its group property set — "The check button whose group this widget belongs to", generated/props.ts on GtkCheckButtonProps.group — so two web elements legitimately alias one GTK tag. The exclusivity the browser gets free from <input type=radio name> is RadioGroupState in adwaita-core (adw-checks.ts:10-14).',
    },
    'adw-switch': {
        gtk: 'gtk-switch',
        why: 'libadwaita has no switch type; _switch.scss styles GtkSwitch, and this element is that stylesheet as a 44x24 track over a hidden checkbox. Its header already reasons about the GtkSwitch two-phase active/state pair and records that neither renderer models it (adw-switch.ts:9-14).',
    },
    // A libadwaita GObject that is not a GtkWidget, so it has no tag here.
    'adw-sidebar-item': { webOnly: 'AdwSidebarItem descends from GObject.Object, not GtkWidget' },
    'adw-sidebar-section': { webOnly: 'AdwSidebarSection descends from GObject.Object, not GtkWidget' },
    'adw-tab-page': { webOnly: 'AdwTabPage descends from GObject.Object, not GtkWidget' },
    // `adw-toggle` USED to be here, with the same reason. It left when the generated
    // table stopped meaning "concrete GtkWidget descendant" (ADR 0028 § Amendment,
    // 2026-08-28): `AdwToggle` still descends from GObject.Object, but it declares
    // both halves of a one-child slot and is therefore a placement carrier, so it now
    // has a GTK tag and the two surfaces share the spelling.
    //
    // The four entries around it did NOT follow, and the reason is narrower than
    // "none of them holds a child" — which is what this comment said first and is
    // false for three of them. MEASURED against Adw-1: `AdwTabPage` and
    // `AdwViewStackPage` both have a `child: Gtk.Widget` and a `get_child()`, and
    // `AdwSidebarItem` holds a widget in `suffix`. What they do not have is a
    // SETTABLE slot named `child`: those two `child` properties are construct-only,
    // and `suffix` is spelled differently. Only `AdwSidebarSection` holds no widget
    // at all. So the discriminator is `set_child`, and the rule is keyed on GTK's
    // naming convention rather than on the shape.
    'adw-view-stack-page': { webOnly: 'AdwViewStackPage descends from GObject.Object, not GtkWidget' },
    // Declarative children with no GObject of their own: on GTK these are method calls.
    'adw-alert-response': { webOnly: 'a declarative form of Adw.AlertDialog.add_response()' },
    'adw-bottom-sheet-content': { webOnly: 'a slot wrapper; on GTK the slot is set_content()' },
    'adw-bottom-sheet-sheet': { webOnly: 'a slot wrapper; on GTK the slot is set_sheet()' },
    'adw-view-switcher-page': { webOnly: 'a declarative page of the bundled switcher+stack; GTK keeps them apart' },
    // No widget behind them at all.
    'adw-card': { webOnly: 'the .adw-card style class as an element; GTK styles a container instead' },
    'adw-data-grid': { webOnly: 'a presentational aligned grid; the GTK counterpart is a plain Gtk.Grid' },
    'adw-source-view': { webOnly: 'GtkSourceView lives in the GtkSource namespace, outside the Gtk+Adw table' },
};

/**
 * Every NativeScript widget whose `adw-<name>` spelling is NOT a GTK tag, and what it is.
 *
 * KEYED ON THE FILE SPELLING (`adw-entry`, the class `AdwEntry` in `adw-entry.ts`) rather
 * than on the class, so the key lives in the same namespace as the tag set it is held
 * against and the "already shares a spelling" comparison is a lookup rather than a second
 * transformation. The class name is what a consumer imports, so every failure prints both.
 *
 * A DISCRIMINATED union, following `check-storybook-widget-coverage.mjs` rather than one
 * free-text field, because telling these apart is the entire value of the ledger — two of
 * the four widgets with no tag under either spelling ARE a GTK widget under another name
 * or another assembly and should converge, and two genuinely have no counterpart. ADR 0034
 * § 1 fixes the four kinds:
 *
 *   { gir: '<GType>', why }        the same widget under another spelling. It should
 *                                  converge; the `why` says what it is and why it has not.
 *   { composes: ['<GType>', …], why }
 *                                  the same UI, assembled differently because the platform
 *                                  forces it. Converges in NAME, never in shape.
 *   { own: '<reason>' }            no counterpart type at all. Declared and left.
 *   { gap: '#NNNN' }               nobody has decided. Not a reason — a pointer.
 *
 * `gir` and `composes` name a GTYPE and are held against the runtime table's GType keys,
 * not against a tag: `AdwIcon` is `GtkImage`, whose tag is `gtk-image`, and deriving one
 * spelling from the other would be this file inventing a mapping instead of reading one.
 *
 * THE FOUR `gir` ENTRIES ARE NOT A RENAME AND MUST NOT BECOME ONE HERE. The port is
 * published at 49 versions with an XML element vocabulary whose failure on a phone is a
 * silent unresolved module, and ADR 0034 rejects the rename on that cost while giving the
 * gap a number instead. What this table changes is that the gap is now countable.
 */
const NS_WIDGET_ALIGNMENT = {
    // GTK widgets wearing an Adw prefix. libadwaita subclasses none of the four; it
    // styles the GTK type through a stylesheet partial, which is what each port mirrors.
    'adw-button': {
        gir: 'GtkButton',
        why: 'It extends the real NativeScript Button and applies the Adwaita style classes, which the file gives as its reason: it "Mirrors how libadwaita buttons get their look from a CSS style class rather than a distinct widget" (adw-button.ts:5-6). That is GtkButton plus _buttons.scss, so the widget is GtkButton.',
    },
    'adw-drop-down': {
        gir: 'GtkDropDown',
        why: 'libadwaita vendors no adw-drop-down.c and ships no drop down type — the file says exactly that while listing which GtkDropDown behaviour it therefore cannot reproduce (adw-drop-down.ts:19-20). AdwComboRow is the boxed-list row form, a genuine Adw type, and keeps its own spelling.',
    },
    'adw-entry': {
        gir: 'GtkEntry',
        why: 'The header states the identity: the bare input, "what Gtk.Entry is", and the counterpart of the adwaita-web <adw-entry> (adw-entry.ts:2-5). libadwaita styles GtkEntry in _entries.scss and subclasses nothing; AdwEntryRow is the row form and is a real Adw type.',
    },
    'adw-menu-button': {
        gir: 'GtkMenuButton',
        why: 'It mirrors Gtk.MenuButton driven by a Gio.Menu model, with the popover approximated by the platform action sheet, and the file states the naming fact itself: "libadwaita has no menu button of its own; it styles the GTK one" (adw-menu-button.ts:7-8).',
    },
    // No tag under either spelling — and that is three different situations, read from
    // the files rather than inferred from the names.
    'adw-icon': {
        gir: 'GtkImage',
        why: 'A non-interactive NativeScript Image rendering an Adwaita symbolic SVG (adw-icon.ts:1-3, `export class AdwIcon extends Image` at :24). That is Gtk.Image with an icon-name. adwaita-web declares the same target for its own <adw-icon> in the table above, so both renderers already agree on the widget and disagree only on the spelling.',
    },
    'adw-image-button': {
        composes: ['GtkButton', 'GtkImage'],
        why: 'Upstream .image-button is a style CLASS on button (refs/libadwaita/src/stylesheet/widgets/_buttons.scss:66, pin 42f647ff), not a type, so on GTK this is a Gtk.Button holding a Gtk.Image. The NativeScript Button is text-only and cannot host a child view, so the port builds a tappable GridLayout around a centred Image instead (adw-image-button.ts:6-8). Converges in NAME, never in shape.',
    },
    'adw-slider-row': {
        own: 'libadwaita declares no AdwSliderRow: `grep -ric sliderrow refs/libadwaita | grep -v :0 | wc -l` is 0 at pin 42f647ff, against 5 files for the AdwSpinRow control string — an empty grep and a grep that searched nothing look identical, hence the control. It is a composite the port assembles, a title-and-live-value header over a Slider, as the NS counterpart of the GTK storybook Gtk.Scale range card (adw-slider-row.ts:3-6). Nothing to converge towards; declared and left.',
    },
    'adw-data-grid': {
        own: 'An original @gjsify widget rather than a port, and the file says so: "the grid itself is a @gjsify/adwaita-* widget, not a port" (adw-data-grid.ts:51). The GTK counterpart would be a hand-assembled plain Gtk.Grid, which is an assembly and not a type to name. adwaita-web declares its own copy web-only with the same verdict in the table above.',
    },
};

// ------------------------------------------------------------------ readers

/**
 * Strip comments so a rule about DECLARATIONS is not answered by prose.
 *
 * These files explain what they deliberately do not contain, and they name those things.
 * A naive match reports the explanation as the violation — measured on the sibling check
 * for the generated surface, whose first run failed on a word inside its own header.
 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** The body of `export interface <name> { … }`, or null. */
function interfaceBody(text, name) {
    const start = text.indexOf(`export interface ${name} {`);
    if (start < 0) return null;
    const open = text.indexOf('{', start);
    const close = text.indexOf('\n}', open);
    if (close < 0) return null;
    return text.slice(open + 1, close);
}

/** `'adw-box': AdwBoxProps;` and `AdwBox: AdwBoxProps;` alike -> Map(key, value). */
function readMembers(text, name) {
    const body = interfaceBody(text, name);
    if (body === null) return null;
    const out = new Map();
    for (const [, quoted, bare, value] of body.matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*)):\s*([^;]+);/gm)) {
        out.set(quoted ?? bare, value.trim());
    }
    return out;
}

/** The runtime table: GType -> tag, from the emitted rows. */
function readRuntimeTable(text) {
    const out = new Map();
    for (const [, gtype, tag] of text.matchAll(/\{\s*gtype:\s*'([^']+)',\s*tag:\s*'([^']+)'/g)) out.set(gtype, tag);
    return out;
}

/** `export const TAGS … = { AdwBox: 'adw-box', … }` from the test-only surface data. */
function readTagsConst(text) {
    const start = text.indexOf('export const TAGS');
    if (start < 0) return null;
    const close = text.indexOf('\n}', start);
    if (close < 0) return null;
    const out = new Map();
    for (const [, gtype, tag] of text.slice(start, close).matchAll(/^\s*([A-Za-z_$][\w$]*):\s*'([^']+)',/gm)) {
        out.set(gtype, tag);
    }
    return out;
}

/**
 * Which generated maps a dialect module imports, and any widget name it spells itself.
 *
 * Both `import type { X }` and `import { type X }` count, and so does a plain value
 * import. They are the same import, and a reader that recognised only the first shape
 * made a REQUIRED job go red on a change that was correct — with a message saying the
 * module "no longer imports WidgetPropsByTag" while the import sat two lines above it.
 * A guard whose failure text is false is worse than no guard: it teaches the next
 * person to switch it off. Measured before the fix, on the real `jsx-runtime.ts`.
 */
function readDialect(source) {
    const code = stripComments(source);
    const imported = new Set();
    for (const [, names] of code.matchAll(
        /import\s+(?:type\s+)?\{([^}]+)\}\s*from\s*'\.\/generated\/props\.(?:js|ts|mjs|mts)'/g,
    )) {
        for (const name of names.split(',')) {
            // Trailing comma in a wrapped import list: `.split(',')` yields an empty tail.
            const bare = name.trim().replace(/^type\s+/, '');
            if (bare !== '') imported.add(bare);
        }
    }
    // A tag or GType literal in a dialect module is the start of a per-framework table.
    // Type ANNOTATIONS are not matched: every module writes `Gtk.Widget`, so a bare
    // `Gtk\.[A-Z]` would flag all three and be switched off within a day.
    const literals = [...code.matchAll(/'(?:gtk|adw)-[a-z0-9-]+'/g), ...code.matchAll(/'(?:Gtk|Adw)[A-Z]\w*'/g)].map(
        ([literal]) => literal,
    );
    return { imported, literals };
}

// ------------------------------------------------------------------ rules

/**
 * A declared divergence has to say WHY, in a sentence rather than a word.
 *
 * ONE helper for both tables and every kind, so an alias cannot be held to a weaker
 * standard than a `webOnly`. That asymmetry is what ADR 0034 § 1 found: the `gtk:` entries
 * carried no reason at all, so a divergence and a decision had the same shape in the data
 * and an alias satisfied the check permanently, silently, for as long as nobody read it.
 *
 * This rule can only fail on an edit to a table in this file — see the header on which
 * half can go red. It refuses a shortcut; it measures nothing.
 *
 * @param {string} subject what the failure is about, already phrased
 * @param {string|undefined} reason the field as written
 * @param {string} field how to spell the field in the fix
 * @param {string} source the table to edit
 * @returns {string[]}
 */
function reasonProblems(subject, reason, field, source) {
    const written = typeof reason === 'string' ? reason.trim() : '';
    if (written === '') {
        return [
            `${subject} with no reason. Add ${field} to ${source} saying what the widget IS and where ` +
                'that was read — a divergence with no reason is indistinguishable from a decision nobody made.',
        ];
    }
    if (written.length < MIN_REASON) {
        return [
            `${subject} with a ${written.length}-character reason, under the ${MIN_REASON}-character floor ` +
                `the sibling ledgers set: "${written}". Say what it is and cite where, in ${source}.`,
        ];
    }
    return [];
}

/**
 * Every rule, as one pure function over plain data.
 *
 * Pure so the self-test can hand it a broken world without materialising files, and so a
 * rule that cannot fail is visible as a rule with no failing vector.
 *
 * @param {{
 *   runtime: Map<string,string>, tags: Map<string,string>|null,
 *   byTag: Map<string,string>|null, byGType: Map<string,string>|null,
 *   classByTag: Map<string,string>|null, vueAliases: Map<string,string>|null,
 *   dialects: {name: string, needs: string[], imported: Set<string>, literals: string[]}[],
 *   webElements: string[], table: Record<string, {gtk?: string, webOnly?: string, why?: string}>,
 *   nsWidgets: string[],
 *   nsTable: Record<string, {gir?: string, composes?: string[], own?: string, gap?: string, why?: string}>,
 * }} world
 * @returns {string[]} problems, empty when aligned
 */
export function alignmentProblems(world) {
    const problems = [];
    const { runtime, tags, byTag, byGType, classByTag, vueAliases, dialects, webElements, table } = world;
    const { nsWidgets, nsTable } = world;

    // A reader that found nothing makes every set difference empty, so the whole check
    // passes vacuously. That is the one failure this file exists to avoid.
    if (runtime.size === 0) problems.push('the runtime widget table is empty — the reader or the file moved');
    for (const [name, map] of [
        ['WidgetPropsByTag', byTag],
        ['WidgetPropsByGType', byGType],
        ['WidgetClassByTag', classByTag],
        ['WidgetPropsVueAliases', vueAliases],
        ['TAGS', tags],
    ]) {
        if (map === null) problems.push(`${name} not found — the generated shape changed and this reader did not`);
    }
    if (webElements.length === 0) problems.push('no adw-* web elements found — the independent half is not being read');
    if (nsWidgets.length === 0) {
        problems.push('no NativeScript Adw* widgets found — the NativeScript half is not being read');
    }
    if (problems.length > 0) return problems;

    const runtimeTags = new Set(runtime.values());
    const runtimeGTypes = new Set(runtime.keys());

    const compare = (label, actual, expected) => {
        const missing = [...expected].filter((key) => !actual.has(key));
        const extra = [...actual].filter((key) => !expected.has(key));
        if (missing.length > 0)
            problems.push(`${label} is missing ${missing.length}: ${missing.slice(0, 8).join(', ')}`);
        if (extra.length > 0)
            problems.push(`${label} has ${extra.length} nothing else knows: ${extra.slice(0, 8).join(', ')}`);
    };

    compare('WidgetPropsByTag', new Set(byTag.keys()), runtimeTags);
    compare('WidgetClassByTag', new Set(classByTag.keys()), runtimeTags);
    compare('WidgetPropsByGType', new Set(byGType.keys()), runtimeGTypes);
    compare('surface-data TAGS', new Set(tags.keys()), runtimeGTypes);

    // The join: for one GType the tag map, the props maps and the class map must all be
    // talking about the same widget. A tag/GType pair that drifts apart would let the JSX
    // and Vue dialects accept different sets while every key set still matched.
    for (const [gtype, tag] of runtime) {
        if (tags.get(gtype) !== tag) {
            problems.push(
                `surface-data TAGS maps ${gtype} to ${tags.get(gtype) ?? '(nothing)'}, the table says ${tag}`,
            );
        }
        const byTagIface = byTag.get(tag);
        const byGTypeIface = byGType.get(gtype);
        if (byTagIface !== undefined && byGTypeIface !== undefined && byTagIface !== byGTypeIface) {
            problems.push(`${tag} offers ${byTagIface} to JSX and ${byGTypeIface} to Vue`);
        }
    }

    // The Vue aliases exist only to reach widgets Volar's camelize cannot; each must still
    // be a real tag offering the same interface its GType does.
    for (const [tag, iface] of vueAliases) {
        if (!runtimeTags.has(tag)) problems.push(`Vue alias '${tag}' is not a tag in the widget table`);
        else if (byTag.get(tag) !== iface) {
            problems.push(`Vue alias '${tag}' offers ${iface}, JSX offers ${byTag.get(tag)}`);
        }
    }

    // Each dialect still derives its element list from the generated maps, and spells no
    // widget of its own.
    for (const dialect of dialects) {
        for (const need of dialect.needs) {
            if (!dialect.imported.has(need)) {
                problems.push(
                    `the ${dialect.name} surface no longer imports ${need} from generated/props.js — ` +
                        'a dialect with its own element list is the hand-maintained per-framework table ' +
                        'ADR 0027 § 7 refuses',
                );
            }
        }
        for (const literal of dialect.literals) {
            problems.push(`the ${dialect.name} surface spells a widget itself: ${literal}`);
        }
    }

    // The independent half.
    const declared = new Set(Object.keys(table));
    for (const element of webElements) {
        const entry = table[element];
        if (runtimeTags.has(element)) {
            if (entry) {
                problems.push(
                    `<${element}> already shares its spelling with a GTK tag, so its alignment entry is ` +
                        `redundant — delete it from ${TABLE_SOURCE} rather than leaving two answers`,
                );
            }
            continue;
        }
        if (!entry) {
            problems.push(
                `<${element}> has no GTK tag of the same name and no alignment entry. Add one to ` +
                    `${TABLE_SOURCE}: a 'gtk' target if it is the same widget under another ` +
                    "spelling, or a 'webOnly' reason if there is no GTK widget behind it.",
            );
            continue;
        }
        if (entry.gtk && entry.webOnly) problems.push(`<${element}> is declared both an alias and web-only`);
        else if (entry.gtk && !runtimeTags.has(entry.gtk)) {
            problems.push(`<${element}> aliases '${entry.gtk}', which is not a tag in the widget table`);
        } else if (!entry.gtk && !entry.webOnly) {
            problems.push(`<${element}> has an alignment entry with neither a 'gtk' target nor a 'webOnly' reason`);
        } else if (entry.gtk) {
            problems.push(...reasonProblems(`<${element}> aliases '${entry.gtk}'`, entry.why, "a 'why'", TABLE_SOURCE));
        } else {
            problems.push(
                ...reasonProblems(
                    `<${element}> is declared web-only`,
                    entry.webOnly,
                    "a 'webOnly' reason",
                    TABLE_SOURCE,
                ),
            );
        }
    }
    const present = new Set(webElements);
    for (const element of declared) {
        if (!present.has(element)) {
            problems.push(
                `the alignment table declares <${element}>, which adwaita-web no longer registers — ` +
                    `drop the entry from ${TABLE_SOURCE}`,
            );
        }
    }

    // The NativeScript half. The same shape over a second independent source: these names
    // are a widget FILENAME plus the class it exports, hand-typed, and the generator that
    // emits the tag table reads neither. Every failure names the CLASS, because that is
    // what a consumer imports and what a `.mdx` fence or an XML element spells.
    const nsDeclared = new Set(Object.keys(nsTable));
    for (const widget of nsWidgets) {
        const klass = widgetClass(elementName(widget));
        const entry = nsTable[widget];
        if (runtimeTags.has(widget)) {
            if (entry) {
                problems.push(
                    `${klass} already shares its spelling with the GTK tag '${widget}', so its alignment ` +
                        `entry is redundant — delete it from ${NS_TABLE_SOURCE} rather than leaving two answers`,
                );
            }
            continue;
        }
        if (!entry) {
            problems.push(
                `${klass} (${widget}) has no GTK tag of the same name and no alignment entry. Add one to ` +
                    `${NS_TABLE_SOURCE}: 'gir' if it is the same widget under another spelling, 'composes' ` +
                    "if the platform forces a different assembly, 'own' if there is no counterpart type at " +
                    "all, or 'gap' with an issue number if nobody has decided yet.",
            );
            continue;
        }
        const kinds = NS_KINDS.filter((kind) => entry[kind] !== undefined);
        if (kinds.length !== 1) {
            problems.push(
                `${klass} has an alignment entry declaring ${kinds.length === 0 ? 'no kind at all' : kinds.join(' and ')} — ` +
                    `exactly one of ${NS_KINDS.map((kind) => `'${kind}'`).join(', ')} says what the widget is, ` +
                    'and two answers is none',
            );
            continue;
        }
        if (entry.gir !== undefined) {
            if (!runtimeGTypes.has(entry.gir)) {
                problems.push(`${klass} is declared to be '${entry.gir}', which is not a GType in the widget table`);
            } else {
                problems.push(
                    ...reasonProblems(
                        `${klass} is declared to be '${entry.gir}'`,
                        entry.why,
                        "a 'why'",
                        NS_TABLE_SOURCE,
                    ),
                );
            }
        } else if (entry.composes !== undefined) {
            const missing = entry.composes.filter((gtype) => !runtimeGTypes.has(gtype));
            if (entry.composes.length < 2) {
                problems.push(
                    `${klass} composes ${entry.composes.length} GType(s), and a composition is at least ` +
                        "two — one GType under another spelling is a 'gir' alias, which is the entry that " +
                        'says it should converge',
                );
            } else if (missing.length > 0) {
                problems.push(`${klass} composes ${missing.join(', ')}, not a GType in the widget table`);
            } else {
                problems.push(
                    ...reasonProblems(
                        `${klass} composes ${entry.composes.join(' + ')}`,
                        entry.why,
                        "a 'why'",
                        NS_TABLE_SOURCE,
                    ),
                );
            }
        } else if (entry.own !== undefined) {
            problems.push(
                ...reasonProblems(
                    `${klass} is declared to have no GIR counterpart`,
                    entry.own,
                    "an 'own' reason",
                    NS_TABLE_SOURCE,
                ),
            );
        } else if (!GAP_ISSUE.test(entry.gap)) {
            problems.push(
                `${klass} points its gap at '${entry.gap}', which is not an issue number. A gap is a ` +
                    'POINTER at tracked work and never a reason: the moment "it would be work" is allowed ' +
                    'to sit in a reason field, every gap can be spelled as one and nothing is recorded.',
            );
        }
    }
    const nsPresent = new Set(nsWidgets);
    for (const widget of nsDeclared) {
        if (!nsPresent.has(widget)) {
            problems.push(
                `the alignment table declares ${widgetClass(elementName(widget))}, which ` +
                    `@gjsify/adwaita-nativescript no longer ships — drop the entry from ${NS_TABLE_SOURCE}`,
            );
        }
    }

    return problems;
}

// ------------------------------------------------------------------ self-test

/**
 * A reason long enough to clear {@link MIN_REASON}, so the fixtures test the rule the
 * vectors are about rather than accidentally tripping the reason floor first.
 */
const FIXTURE_REASON = 'a fixture reason, written long enough to clear the floor this file sets';

/**
 * `AdwBin` is in the fixture on purpose: without a widget whose spelling ALREADY matches
 * a tag there is nothing for the redundancy rules to be redundant about, on either
 * surface, and both would be vectorless.
 */
const WORLD = () => ({
    runtime: new Map([
        ['AdwBin', 'adw-bin'],
        ['GtkBox', 'gtk-box'],
        ['GtkButton', 'gtk-button'],
    ]),
    tags: new Map([
        ['AdwBin', 'adw-bin'],
        ['GtkBox', 'gtk-box'],
        ['GtkButton', 'gtk-button'],
    ]),
    byTag: new Map([
        ['adw-bin', 'AdwBinProps'],
        ['gtk-box', 'GtkBoxProps'],
        ['gtk-button', 'GtkButtonProps'],
    ]),
    byGType: new Map([
        ['AdwBin', 'AdwBinProps'],
        ['GtkBox', 'GtkBoxProps'],
        ['GtkButton', 'GtkButtonProps'],
    ]),
    classByTag: new Map([
        ['adw-bin', 'Adw.Bin'],
        ['gtk-box', 'Gtk.Box'],
        ['gtk-button', 'Gtk.Button'],
    ]),
    vueAliases: new Map(),
    dialects: [
        { name: 'jsx/solid', needs: ['WidgetPropsByTag'], imported: new Set(['WidgetPropsByTag']), literals: [] },
    ],
    webElements: ['adw-bin', 'adw-box', 'adw-button'],
    table: {
        'adw-box': { webOnly: FIXTURE_REASON },
        'adw-button': { gtk: 'gtk-button', why: FIXTURE_REASON },
    },
    nsWidgets: ['adw-bin', 'adw-button', 'adw-icon-button', 'adw-grid'],
    nsTable: {
        'adw-button': { gir: 'GtkButton', why: FIXTURE_REASON },
        'adw-icon-button': { composes: ['GtkButton', 'GtkBox'], why: FIXTURE_REASON },
        'adw-grid': { own: FIXTURE_REASON },
    },
});

/** Each vector breaks exactly one rule, and names the substring its failure must contain. */
const VECTORS = [
    ['the aligned baseline', (w) => w, null],
    ['an empty runtime table', (w) => ({ ...w, runtime: new Map() }), 'runtime widget table is empty'],
    ['a generated map the reader cannot find', (w) => ({ ...w, byTag: null }), 'WidgetPropsByTag not found'],
    ['no web elements at all', (w) => ({ ...w, webElements: [] }), 'independent half is not being read'],
    [
        'a tag in the props map with no runtime row',
        (w) => ({ ...w, byTag: new Map([...w.byTag, ['gtk-ghost', 'GtkGhostProps']]) }),
        'nothing else knows',
    ],
    [
        'a runtime row the props map lost',
        (w) => ({ ...w, byTag: new Map([...w.byTag].filter(([tag]) => tag !== 'gtk-button')) }),
        'WidgetPropsByTag is missing 1',
    ],
    [
        'TAGS disagreeing with the table',
        (w) => ({ ...w, tags: new Map([...w.tags, ['GtkButton', 'gtk-btn']]) }),
        'the table says gtk-button',
    ],
    [
        'JSX and Vue offered different interfaces for one widget',
        (w) => ({ ...w, byGType: new Map([...w.byGType, ['GtkButton', 'GtkOtherProps']]) }),
        'to JSX and GtkOtherProps to Vue',
    ],
    [
        'a Vue alias for a tag that does not exist',
        (w) => ({ ...w, vueAliases: new Map([['gtk-ghost', 'GtkGhostProps']]) }),
        "Vue alias 'gtk-ghost' is not a tag",
    ],
    [
        'a dialect that stopped importing the generated map',
        (w) => ({ ...w, dialects: [{ ...w.dialects[0], imported: new Set() }] }),
        'no longer imports WidgetPropsByTag',
    ],
    [
        'a dialect spelling a widget itself',
        (w) => ({ ...w, dialects: [{ ...w.dialects[0], literals: ["'gtk-box'"] }] }),
        'spells a widget itself',
    ],
    ['an undeclared web element', (w) => ({ ...w, table: {} }), 'no alignment entry'],
    [
        'a web element aliasing a tag that does not exist',
        (w) => ({ ...w, table: { ...w.table, 'adw-button': { gtk: 'gtk-ghost' } } }),
        "aliases 'gtk-ghost'",
    ],
    [
        'a redundant entry for an element that already matches',
        (w) => ({
            ...w,
            webElements: [...w.webElements, 'gtk-box'],
            table: { ...w.table, 'gtk-box': { webOnly: 'redundant' } },
        }),
        'alignment entry is redundant',
    ],
    [
        'a stale entry for an element that is gone',
        (w) => ({ ...w, table: { ...w.table, 'adw-vanished': { webOnly: 'gone' } } }),
        'no longer registers',
    ],
    [
        'an entry that is both an alias and web-only',
        (w) => ({ ...w, table: { ...w.table, 'adw-button': { gtk: 'gtk-button', webOnly: 'both' } } }),
        'both an alias and web-only',
    ],
    // ADR 0034 § 1: the reason is required on the alias kind too. Before this, an alias
    // satisfied the check permanently and a divergence looked exactly like a decision.
    [
        'an alias with no reason at all',
        (w) => ({ ...w, table: { ...w.table, 'adw-button': { gtk: 'gtk-button' } } }),
        "<adw-button> aliases 'gtk-button' with no reason",
    ],
    [
        'an alias whose reason is one word',
        (w) => ({ ...w, table: { ...w.table, 'adw-button': { gtk: 'gtk-button', why: 'legacy' } } }),
        "<adw-button> aliases 'gtk-button' with a 6-character reason",
    ],
    [
        'a web-only reason under the floor',
        (w) => ({ ...w, table: { ...w.table, 'adw-box': { webOnly: 'because' } } }),
        '<adw-box> is declared web-only with a 7-character reason',
    ],
    // The NativeScript half.
    ['no NativeScript widgets at all', (w) => ({ ...w, nsWidgets: [] }), 'NativeScript half is not being read'],
    [
        'an undeclared NativeScript widget',
        (w) => ({ ...w, nsTable: {} }),
        'AdwButton (adw-button) has no GTK tag of the same name and no alignment entry',
    ],
    [
        'a gir target that is not a GType in the table',
        (w) => ({ ...w, nsTable: { ...w.nsTable, 'adw-button': { gir: 'GtkGhost', why: FIXTURE_REASON } } }),
        "AdwButton is declared to be 'GtkGhost', which is not a GType",
    ],
    [
        'a gir alias with no reason',
        (w) => ({ ...w, nsTable: { ...w.nsTable, 'adw-button': { gir: 'GtkButton' } } }),
        "AdwButton is declared to be 'GtkButton' with no reason",
    ],
    [
        'a composes member that is not a GType',
        (w) => ({
            ...w,
            nsTable: { ...w.nsTable, 'adw-icon-button': { composes: ['GtkButton', 'GtkGhost'], why: FIXTURE_REASON } },
        }),
        'AdwIconButton composes GtkGhost, not a GType',
    ],
    [
        'a composition of one',
        (w) => ({
            ...w,
            nsTable: { ...w.nsTable, 'adw-icon-button': { composes: ['GtkButton'], why: FIXTURE_REASON } },
        }),
        'a composition is at least',
    ],
    [
        'a composition with no reason',
        (w) => ({ ...w, nsTable: { ...w.nsTable, 'adw-icon-button': { composes: ['GtkButton', 'GtkBox'] } } }),
        'AdwIconButton composes GtkButton + GtkBox with no reason',
    ],
    [
        'an own entry whose reason is a word',
        (w) => ({ ...w, nsTable: { ...w.nsTable, 'adw-grid': { own: 'none' } } }),
        'AdwGrid is declared to have no GIR counterpart with a 4-character reason',
    ],
    [
        'a NativeScript entry answering twice',
        (w) => ({ ...w, nsTable: { ...w.nsTable, 'adw-grid': { gir: 'GtkBox', own: FIXTURE_REASON } } }),
        'declaring gir and own',
    ],
    [
        'a NativeScript entry answering not at all',
        (w) => ({ ...w, nsTable: { ...w.nsTable, 'adw-grid': { why: FIXTURE_REASON } } }),
        'declaring no kind at all',
    ],
    [
        'a gap pointing at prose instead of tracked work',
        (w) => ({ ...w, nsTable: { ...w.nsTable, 'adw-grid': { gap: 'someone should look at this' } } }),
        'not an issue number',
    ],
    [
        'a redundant entry for a widget that already matches',
        (w) => ({ ...w, nsTable: { ...w.nsTable, 'adw-bin': { own: FIXTURE_REASON } } }),
        "AdwBin already shares its spelling with the GTK tag 'adw-bin'",
    ],
    [
        'a stale entry for a widget that is gone',
        (w) => ({ ...w, nsTable: { ...w.nsTable, 'adw-vanished': { own: FIXTURE_REASON } } }),
        'AdwVanished, which @gjsify/adwaita-nativescript no longer ships',
    ],
];

/**
 * The READERS get their own vectors, because the rules cannot cover them.
 *
 * `alignmentProblems` takes plain data, so every vector above proves a rule and none of
 * them proves that the thing which BUILT the data read the file correctly. That gap is
 * not hypothetical: `readDialect` recognised `import type { X }` and not `import { type
 * X }`, so a correct, semantically identical edit turned this required job red with a
 * message asserting the opposite of the file it had just read. A reader that under-reads
 * does not fail quietly here — it fails LOUDLY and wrongly, which is the more expensive
 * shape, because the fix that makes CI green is deleting the check.
 *
 * Each vector is a source fragment plus what the reader must find in it.
 */
const READER_VECTORS = [
    ["import type { A, B } from './generated/props.js';", ['A', 'B'], []],
    ["import { type A, type B } from './generated/props.js';", ['A', 'B'], []],
    ["import { A } from './generated/props.js';", ['A'], []],
    ["import type {\n    A,\n    B,\n} from './generated/props.js';", ['A', 'B'], []],
    ["import type { A } from './generated/props.ts';", ['A'], []],
    // Not this module's map, so not an answer to "does it still derive from ours".
    ["import type { A } from './other.js';", [], []],
    // The literal half: a tag or GType spelled in the module, and the shapes that are not.
    ["const t = 'gtk-box';", [], ["'gtk-box'"]],
    ["const g = 'AdwToolbarView';", [], ["'AdwToolbarView'"]],
    ["throw new Error('GtkWidget expected here');", [], []],
    ["// 'gtk-box' in a comment is prose, not a table\nconst x = 1;", [], []],
    ['let w: Gtk.Widget | null = null;', [], []],
];

function readerSelfTest() {
    const failures = [];
    for (const [source, wantImports, wantLiterals] of READER_VECTORS) {
        const { imported, literals } = readDialect(source);
        const got = [...imported].sort().join(',');
        if (got !== [...wantImports].sort().join(',')) {
            failures.push(`readDialect(${JSON.stringify(source)}) imported [${got}], wanted [${wantImports}]`);
        }
        if (literals.sort().join(',') !== [...wantLiterals].sort().join(',')) {
            failures.push(
                `readDialect(${JSON.stringify(source)}) found literals [${literals}], wanted [${wantLiterals}]`,
            );
        }
    }
    return failures;
}

function selfTest() {
    const failures = [];
    // The baseline has to be GREEN, or every vector below "fails" for the wrong reason and
    // the suite reports a working check over a world that was already broken.
    for (const [label, mutate, expected] of VECTORS) {
        const problems = alignmentProblems(mutate(WORLD()));
        if (expected === null) {
            if (problems.length > 0) failures.push(`${label} should be clean, got: ${problems.join(' | ')}`);
            continue;
        }
        if (problems.length === 0) failures.push(`${label} produced NO problem — that rule is not holding`);
        else if (!problems.some((problem) => problem.includes(expected))) {
            failures.push(`${label} failed for the wrong reason (wanted "${expected}"): ${problems.join(' | ')}`);
        }
    }
    return failures;
}

// ------------------------------------------------------------------ run

const selfTestFailures = [...readerSelfTest(), ...selfTest()];
if (selfTestFailures.length > 0) {
    console.error('check-vocabulary-alignment: SELF-TEST failed — the check itself is broken:');
    for (const failure of selfTestFailures) console.error(`  - ${failure}`);
    process.exit(1);
}

const read = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8');

let world;
try {
    const props = read(PROPS);
    world = {
        runtime: readRuntimeTable(read(WIDGETS)),
        tags: readTagsConst(read(SURFACE_DATA)),
        byTag: readMembers(props, 'WidgetPropsByTag'),
        byGType: readMembers(props, 'WidgetPropsByGType'),
        classByTag: readMembers(props, 'WidgetClassByTag'),
        vueAliases: readMembers(props, 'WidgetPropsVueAliases'),
        dialects: DIALECTS.map((dialect) => ({ ...dialect, ...readDialect(read(dialect.file)) })),
        webElements: [...adwaitaWebElements(ROOT).keys()],
        table: WEB_ELEMENT_ALIGNMENT,
        // The reader returns bare names; the table is keyed in the tag namespace it is
        // held against, so the `adw-` goes back on exactly once, here.
        nsWidgets: [...adwaitaNativeScriptWidgets(ROOT).keys()].map((name) => `adw-${name}`),
        nsTable: NS_WIDGET_ALIGNMENT,
    };
} catch (error) {
    console.error(`check-vocabulary-alignment: cannot read an input — ${error.message}`);
    console.error('If a file moved, teach this check where it went. Do not delete it.');
    process.exit(1);
}

const problems = alignmentProblems(world);
if (problems.length > 0) {
    console.error('check-vocabulary-alignment: the surfaces do not name the same widgets:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}

// EVERY NUMBER HERE IS DERIVED. The literals this line replaced sat in the header, were
// quoted from there into ADR 0034, and were wrong in both places within a week — the tag
// table went 164 → 168 and the prose did not. A count nothing recomputes is folklore.
const tagSet = new Set(world.runtime.values());
const kindCount = (table, kind) => Object.values(table).filter((entry) => entry[kind] !== undefined).length;
const aliased = kindCount(WEB_ELEMENT_ALIGNMENT, 'gtk');
const webOnly = kindCount(WEB_ELEMENT_ALIGNMENT, 'webOnly');
const shared = world.webElements.filter((element) => tagSet.has(element)).length;
const nsShared = world.nsWidgets.filter((widget) => tagSet.has(widget)).length;
const nsConverge = kindCount(NS_WIDGET_ALIGNMENT, 'gir') + kindCount(NS_WIDGET_ALIGNMENT, 'composes');
const nsOwn = kindCount(NS_WIDGET_ALIGNMENT, 'own');
const nsGap = kindCount(NS_WIDGET_ALIGNMENT, 'gap');
console.log(
    `check-vocabulary-alignment: self-test green — ${VECTORS.length - 1} failing vector(s), ` +
        `${READER_VECTORS.length} reader vector(s). ` +
        `${world.runtime.size} GTK tags across ${DIALECTS.length} dialect surfaces + the runtime table + the ` +
        `surface data; ${world.webElements.length} adw-* web elements — ${shared} share a spelling, ` +
        `${aliased} alias one, ${webOnly} declared web-only; ` +
        `${world.nsWidgets.length} NativeScript Adw* widgets — ${nsShared} share a spelling, ` +
        `${nsConverge} should converge, ${nsOwn} declared own, ${nsGap} undecided. ` +
        `Distance to one vocabulary on NativeScript: ${nsConverge} widget name(s), and it can only go down.`,
);
