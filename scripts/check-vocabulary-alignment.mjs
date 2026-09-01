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
//  4. THE PROPERTY LEDGER. One level below the names. `NS_PROPERTY_ALIGNMENT` holds every
//     settable property of a NativeScript widget that its GIR counterpart's props
//     interface has no key for — `AdwEntry.placeholder` against
//     `Gtk.Entry:placeholder-text` — and each one is a different SPELLING for the same
//     control (it should converge), a control the counterpart's writable surface cannot
//     express (declared and left), or undecided, which is what fails. Collapsing those
//     into one bucket would leave a number nobody can act on.
//
//     The comparison target is `packages/framework/gtk-host/src/generated/props.ts`,
//     resolved through its `extends` chain. It is a second READER of our own source, not
//     a second source — that file imports `@girs/*`, and ADR 0034 says so in the section
//     the ledger's own header cites. Held to one surface, named in the summary.
//
//  5. ENROLMENT. Which surfaces exist is a per-package DECLARATION —
//     `gjsify.widgetVocabulary` — joined to the readers in `scripts/widget-surfaces.mjs`,
//     and a declared surface with no reader FAILS. Before that, this file knew about its
//     surfaces because they were named in it, and a list binds exactly what is on it: the
//     NativeScript port, the surface carrying the defect, sat outside the list for its
//     whole life. `manifest-conformance`'s `field-coverage` rule then refuses any
//     `gjsify.*` key no rule claims, so the declaration arrived with
//     `scripts/manifest-conformance/rules/widget-vocabulary.mjs` beside it — the same
//     mechanism, one level up.
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
//   CAN go red, on the property half, for the same reason one level down. The setters are
//   hand-typed accessors in the port; `generated/props.ts` is emitted from the GIR by a
//   generator that reads none of them. A settable property that is neither a key nor
//   declared fails; a convergence target that stops being a key fails; an entry for a
//   property the widget no longer sets fails; an entry for a property that IS a key fails
//   as redundant. This half goes red the first time somebody adds an accessor under a
//   name GTK does not use — which is the event the 52 entries below all are.
//
//   CAN go red, on enrolment, in BOTH directions, because the declarations live in
//   `package.json` files and the readers live in `scripts/widget-surfaces.mjs`. A package
//   that declares itself a widget surface with no reader fails; a reader whose package
//   stopped declaring fails; two references, or no renderer, fails.
//
//   CANNOT go red, said here rather than left to be assumed. The REASON rules — `why`
//   required on an alias, the minimum length, `#NNNN` on a `gap`, and the same three on
//   every property entry — hold a table in this file against a constant in this file. They can only fail on an edit to this file and
//   can never notice anything about the tree: they refuse a shortcut, they do not
//   measure. Worth having (an alias with no reason is indistinguishable from a decision
//   nobody made, which is the hole ADR 0034 § 1 closes) and NOT evidence about the
//   repository. The empty-corpus guards cannot fire against real data either: both
//   readers in `adwaita-elements.mjs` THROW on an empty scan, so those two rules exist
//   only to keep `alignmentProblems` from passing vacuously over a world some future
//   caller built by hand — which is what the self-test does.
//
//   CANNOT go red, second instance, and it is the one worth naming twice: the PROPERTY
//   counts are held against a file this repository generates from the same `.gir`
//   ts-for-gir reads. Agreement between them is evidence about two hand-typed
//   vocabularies and is NOT evidence about GTK. `AdwSpinner`'s empty writable surface is
//   a fact about `generated/props.ts`, which is a fact about the GIR — one source, read
//   twice.
//
//   WHAT NO HALF PROVES: behaviour. `<gtk-check-button>` SHARES a spelling with the GTK
//   tag, `AdwEntry` is DECLARED to be `GtkEntry`, and `AdwEntry.placeholder` is DECLARED
//   to be `placeholder-text`; nothing here asserts any of the three behaves like one.
//   Sharing the name is if anything the weaker of the two — a declaration at least says
//   somebody looked. The closing criterion stays ADR 0027 § 9's conformance vectors, and
//   every surface added to this file inherits that limit unchanged.
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

import {
    adwaitaNativeScriptWidgets,
    elementName,
    settablePropertiesOfClass,
    widgetClass,
} from './adwaita-elements.mjs';
import { WIDGET_SURFACE_READERS, declaredWidgetSurfaces, enrolmentProblems } from './widget-surfaces.mjs';

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
const RN_TABLE_SOURCE = 'RN_WIDGET_ALIGNMENT in scripts/check-vocabulary-alignment.mjs';
const NS_PROPERTY_TABLE_SOURCE = 'NS_PROPERTY_ALIGNMENT in scripts/check-vocabulary-alignment.mjs';

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
 * The three kinds a PROPERTY entry may be — the widget union minus `composes`.
 *
 * A composition is something a WIDGET can be (one class assembled from several GTypes);
 * a property is a name, so the same case — `AdwSpinRow.min`/`max`/`step` against one
 * `Gtk.Adjustment` — is several `gir` entries pointing at one key. Weakest last, as
 * above: `gap` records no verdict and reads as the last resort it is.
 */
const PROPERTY_KINDS = ['gir', 'own', 'gap'];

/**
 * Every element whose spelling is NOT a GTK tag, and what it is instead.
 *
 * `gtk` — the same widget under a different name, so the vocabularies agree on the THING
 * and differ on the spelling. `webOnly` — no GIR name for it to converge ON, with the
 * reason, because "web-only" without one is indistinguishable from an oversight.
 *
 * THE `gtk` HALF IS EMPTY, and that is the measurement ADR 0034 § Amendment 5 records:
 * the nine elements that held it — `<adw-entry>` for `GtkEntry`, `<adw-icon>` for
 * `GtkImage`, and seven more — were RENAMED to the tag of the library that owns their
 * GType, so they share a spelling and the rule below deletes their entries as redundant.
 * The kind stays because the rule reads it: the next element written under a name that is
 * not its GType's declares here or fails here, which is the whole of clause 3.
 *
 * `webOnly` NOW COVERS TWO SHAPES, and the second one arrived with that rename. The
 * original is "no GTK widget behind it at all" (`<adw-card>` is a style class,
 * `<adw-alert-response>` is a method call). The second is a widget that HAS a GType and
 * cannot carry its name, because a sibling element already does: `<adw-radio>` is a
 * `GtkCheckButton` with its group set, and `<gtk-check-button>` is the tag. Both are the
 * same verdict — there is no GIR name left for this element to converge on — which is why
 * they are one kind and not two, and each entry says which shape it is.
 *
 * The GObject-but-not-GtkWidget group is the interesting one: `AdwToggle`,
 * `AdwTabPage`, `AdwViewStackPage`, `AdwSidebarItem` and `AdwSidebarSection` are real
 * libadwaita types that descend from `GObject.Object` and not from `GtkWidget`, so they
 * have no tag in a table of concrete widgets — measured against the Adw-1 GIR. On the web
 * they must be elements, because a declarative child is the only way to write them in
 * HTML.
 */
const WEB_ELEMENT_ALIGNMENT = {
    // The grouped check button. Its plain sibling took the GIR name; this one cannot.
    'adw-radio': {
        webOnly:
            'GTK4 has no radio TYPE. A radio is a GtkCheckButton with its group property set — "The check button whose group this widget belongs to", generated/props.ts on GtkCheckButtonProps.group — and <gtk-check-button> now carries that GType under its GIR name. One tag cannot name two constructors, so this is the grouped convenience form with no GType of its own to be named after, the same shape as <adw-card>. The exclusivity the browser gets free from <input type=radio name> is RadioGroupState in adwaita-core (checks.ts:10-14).',
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
        why: 'The header states the identity: the bare input, "what Gtk.Entry is", and the counterpart of the adwaita-web element that is now spelled <gtk-entry> (adw-entry.ts:2-5). libadwaita styles GtkEntry in _entries.scss and subclasses nothing; AdwEntryRow is the row form and is a real Adw type.',
    },
    'adw-menu-button': {
        gir: 'GtkMenuButton',
        why: 'It mirrors Gtk.MenuButton driven by a Gio.Menu model, with the popover approximated by the platform action sheet, and the file states the naming fact itself: "libadwaita has no menu button of its own; it styles the GTK one" (adw-menu-button.ts:7-8).',
    },
    // No tag under either spelling — and that is three different situations, read from
    // the files rather than inferred from the names.
    'adw-icon': {
        gir: 'GtkImage',
        why: 'A non-interactive NativeScript Image rendering an Adwaita symbolic SVG (adw-icon.ts:1-3, `export class AdwIcon extends Image` at :24). That is Gtk.Image with an icon-name. adwaita-web reached the same verdict about its own copy and acted on it — the element is <gtk-image> there since ADR 0034 § Amendment 5 — so the two renderers agree on the widget and this entry is the whole of what is left of the disagreement.',
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

/**
 * The React Native surface's divergences — empty, and that is a measurement.
 *
 * Both widgets `@gjsify/adwaita-react-native` ships, `AdwBin` and `AdwClamp`, already
 * share a spelling with a GTK tag, so there is nothing to declare. The table exists
 * anyway because the rules below run over it: the first widget added there under a name
 * that is not its GType's fails HERE, on the day it is added, which is the state the
 * NativeScript port never had. Same four kinds as `NS_WIDGET_ALIGNMENT`, same reasons.
 */
const RN_WIDGET_ALIGNMENT = {};

/**
 * Every settable property of a NativeScript widget that its GIR counterpart's props
 * interface has no key for, and what it is instead.
 *
 * THE WIDGET NAMES ARE HELD; THE PROPERTY NAMES WERE NOT. `NS_WIDGET_ALIGNMENT` above
 * makes a widget spelling countable and prints the distance. One level down, the same
 * surface hand-types a property name per accessor, against a generated interface nobody
 * compared it with — which is how `AdwEntry.placeholder` sits beside
 * `GtkEntry:placeholder-text` with every gate green.
 *
 * KEYED `<widget-tag>.<property>`, so a key names one row of the comparison and can be
 * held in both directions: an entry for a widget the port no longer ships fails, an entry
 * for a property the widget no longer sets fails, and an entry for a property that IS a
 * key fails as redundant.
 *
 * THE COMPARISON TARGET is `packages/framework/gtk-host/src/generated/props.ts`, resolved
 * through its `extends` chain — in-repo, GIR-derived, no install. **It is a second READER
 * of our own source, not a second source**, and ADR 0034 § *How large is the gap against
 * `@girs`* says so outright: that file imports `@girs/adw-1` and six siblings, so
 * ts-for-gir's derivation is already inside the surface being compared against and both
 * derivations read the same `.gir`. Agreement here is evidence about two hand-typed
 * vocabularies, never proof about GTK.
 *
 * THREE KINDS, the widget ledger's minus one:
 *
 *   { gir: '<key>', why }   the counterpart expresses this control, under `<key>`. It
 *                           SHOULD converge; the `why` says what differs — spelling,
 *                           value type, or shape — and why it has not. The count of these
 *                           is the printed property distance.
 *   { own: '<reason>' }     the counterpart's WRITABLE surface has no key for it. Four
 *                           situations, and the reason says which: GTK has no such
 *                           concept; GTK expresses it as a method; GTK exposes it
 *                           read-only (this file compares against writable slots only);
 *                           or GTK expresses it on a DIFFERENT type. Declared and left.
 *   { gap: '#NNNN' }        nobody has decided. Not a reason — a pointer.
 *
 * NO `composes` KIND, and the reason is not that the case does not arise. It does:
 * `AdwSpinRow.min`/`max`/`step` are one `Gtk.Adjustment` on GTK. A composition of GTYPES
 * is what a WIDGET can be; a property is a name, so the same case is three `gir` entries
 * pointing at one key — the many-to-one the web table already carries with `adw-checkbox`
 * and `adw-radio` both aliasing `gtk-check-button`. Inventing a fourth kind for it would
 * be a second way to say what the table can already say.
 *
 * AN UNDECLARED DISAGREEMENT IS UNDECIDED, AND UNDECIDED FAILS. That is the whole
 * mechanism: `gap` is the tracked deferral, absence is not.
 *
 * ONE SURFACE, DELIBERATELY. `@gjsify/adwaita-web`'s attribute vocabulary and
 * `@gjsify/adwaita-react-native`'s prop types are two further corpora and are NOT in this
 * table; the summary line names the surface it measured for that reason. A distance
 * printed without its surface would be the "measurement narrower than the claim" this
 * file's header already refuses elsewhere.
 */
const NS_PROPERTY_ALIGNMENT = {
    // ── The same control under another spelling. This is the printed distance. ────────
    'adw-bottom-sheet.openState': {
        gir: 'open',
        why: '`Adw.BottomSheet:open` is the same slot, and the port says so in its own doc ("Whether the sheet is open", adw-bottom-sheet.ts:185). It is spelled `openState` because the class also carries `open()` and `close()` methods and one JS class cannot hold both under one name — so converging renames the METHODS, not the property.',
    },
    'adw-button.variant': {
        gir: 'cssClasses',
        why: 'On GTK the Adwaita button variants are STYLE CLASSES over GtkButton — `.suggested-action` / `.destructive-action` / `.flat` / `.pill` in refs/libadwaita/src/stylesheet/widgets/_buttons.scss — which is what `GtkWidget:css-classes` carries. The setter swaps exactly one such class (adw-button.ts:48), so the control is the class list under an enum-shaped name.',
    },
    'adw-button-content.icon': {
        gir: 'iconName',
        why: '`Adw.ButtonContent:icon-name` is the same slot and `AdwButtonContentProps.iconName` is the key. The port stores an Adwaita symbolic SVG STRING there rather than a theme name, because NativeScript resolves no icon theme (adw-button-content.ts:104-108) — a value-type difference under one name, not a second property.',
    },
    'adw-button-row.startIcon': {
        gir: 'startIconName',
        why: '`Adw.ButtonRow:start-icon-name`, whose key is `startIconName` in AdwButtonRowProps. Same slot; the port holds an inline symbolic SVG string because there is no icon theme to name into (adw-button-row.ts:130-134).',
    },
    'adw-button-row.endIcon': {
        gir: 'endIconName',
        why: 'The doc names the counterpart itself — "`Adw.ButtonRow:end-icon-name`" (adw-button-row.ts:142) — and `endIconName` is the key in AdwButtonRowProps. Same slot, an SVG string instead of a theme name.',
    },
    'adw-combo-row.options': {
        gir: 'model',
        why: '`Adw.ComboRow:model` is where the selectable items live on GTK: a `Gio.ListModel` walked by a factory. The port takes a plain array because NativeScript has no list model and its `action()` sheet takes strings (adw-combo-row.ts:137-141). Same slot, a different container.',
    },
    'adw-combo-row.selectedIndex': {
        gir: 'selected',
        why: '`Adw.ComboRow:selected` IS the index — a uint position into the model — and it is the key in AdwComboRowProps. This is the plainest rename in the table: the two names mean the same number (adw-combo-row.ts:146-150).',
    },
    'adw-drop-down.options': {
        gir: 'model',
        why: '`Gtk.DropDown:model` holds the items on GTK, and `model` is the key in GtkDropDownProps. The port keeps a plain array for the same reason `AdwComboRow` does: no list model on NativeScript, and the native chooser takes strings (adw-drop-down.ts:121-125).',
    },
    'adw-entry.placeholder': {
        gir: 'placeholderText',
        why: '`Gtk.Entry:placeholder-text` — "The text that will be displayed in the `GtkEntry` when it is empty and unfocused", generated/props.ts on GtkEntryProps. Nothing differs but the spelling, and this is the example ADR 0034 opens the property section with (adw-entry.ts:137-141).',
    },
    'adw-header-bar.title': {
        gir: 'titleWidget',
        why: 'GTK puts no string on the header bar: `Adw.HeaderBar:title-widget` holds a widget, conventionally an `Adw.WindowTitle`, whose own `title` carries the text. The port forwards to exactly that default (adw-header-bar.ts:81-85), so the slot is `title-widget` and the string is the shortcut into it.',
    },
    'adw-header-bar.subtitle': {
        gir: 'titleWidget',
        why: "The second half of the same slot: `Adw.WindowTitle:subtitle` inside the header bar's `title-widget`, which the port forwards to (adw-header-bar.ts:92-96). Two NativeScript names reaching one GIR key is the many-to-one the web table already carries for `adw-checkbox`/`adw-radio`.",
    },
    'adw-header-bar.flat': {
        gir: 'cssClasses',
        why: 'The port\'s own doc says what this is — "matching `Adw.HeaderBar`\'s `.flat` style. Toggling swaps the `flat` class" (adw-header-bar.ts:106). A style class is `GtkWidget:css-classes` on GTK, the same slot `AdwButton.variant` above reaches.',
    },
    'adw-icon.icon': {
        gir: 'iconName',
        why: '`AdwIcon` is declared to be `GtkImage` by NS_WIDGET_ALIGNMENT above, and a symbolic icon on GTK is `Gtk.Image:icon-name`. The port holds the SVG string itself because it resolves no icon theme (adw-icon.ts:69-73) — the same value-type difference as every other icon slot here.',
    },
    'adw-image-button.icon': {
        gir: 'iconName',
        why: 'The widget composes `GtkButton` + `GtkImage`, and the icon half of that assembly is `Gtk.Image:icon-name` (also `Gtk.Button:icon-name` on the button half, one key either way). The port stores the symbolic SVG string (adw-image-button.ts:92-96).',
    },
    'adw-menu-button.menuItems': {
        gir: 'menuModel',
        why: '`Gtk.MenuButton:menu-model` is the slot: a `Gio.MenuModel` GTK builds the popover from. NativeScript has no `Gio.MenuModel` and opens a native `action()` sheet, so the port holds the items as a list (adw-menu-button.ts:62-66). Same slot, a different container.',
    },
    'adw-spin-row.min': {
        gir: 'adjustment',
        why: 'GTK keeps the whole range in one object: `Adw.SpinRow:adjustment`, a `Gtk.Adjustment` whose `lower` this is. The port carries three scalars instead because NativeScript has no adjustment type (adw-spin-row.ts:114-118). Three names into one key, which is what convergence here would collapse them to.',
    },
    'adw-spin-row.max': {
        gir: 'adjustment',
        why: 'The `upper` of the same `Gtk.Adjustment` that `Adw.SpinRow:adjustment` holds (adw-spin-row.ts:123-127). Split out for the same reason as `min`: there is no adjustment object on NativeScript to put it in.',
    },
    'adw-spin-row.step': {
        gir: 'adjustment',
        why: 'The `step-increment` of the same `Gtk.Adjustment` (adw-spin-row.ts:132-136). Named `step` because the port applies it directly per button press; on GTK the button press reads it off the adjustment.',
    },
    'adw-split-button.actionIcon': {
        gir: 'iconName',
        why: "`Adw.SplitButton:icon-name` is the action half's icon, and `iconName` is the key in AdwSplitButtonProps. The port stores the symbolic SVG string and enforces the same label/icon mutual exclusion the C does, which its doc cites at adw-split-button.c:749-771 (adw-split-button.ts:220-224).",
    },
    'adw-split-button.menu': {
        gir: 'menuModel',
        why: "`Adw.SplitButton:menu-model` is the dropdown half's model. NativeScript opens a native `action()` sheet and holds the entries as a list (adw-split-button.ts:229-233) — the same slot as `AdwMenuButton.menuItems` above, under a shorter name.",
    },
    'adw-split-button.disabled': {
        gir: 'sensitive',
        why: 'GTK spells the same state `GtkWidget:sensitive`, with the opposite polarity — "dimmed, and emitting neither signal" (adw-split-button.ts:270) is `sensitive: false`. A convergence here is a rename AND an inversion, which is why it is recorded rather than done quietly.',
    },
    'adw-status-page.icon': {
        gir: 'iconName',
        why: '`Adw.StatusPage:icon-name` is the slot, and the port\'s own doc says it "Matches `Adw.StatusPage`\'s themed icon" (adw-status-page.ts:107-111). The value is a symbolic SVG string rather than a theme name, for the same reason as every other icon slot on this surface.',
    },
    'adw-tab-view.selected': {
        gir: 'selectedPage',
        why: "`Adw.TabView:selected-page` is the same slot, holding an `Adw.TabPage` where the port holds its index (adw-tab-view.ts:173-177). NativeScript has no tab-page object to hand back, so the index is the port's shape of the same selection.",
    },
    'adw-toggle-group.selected': {
        gir: 'active',
        why: '`Adw.ToggleGroup:active` IS the index of the active toggle, and it is the key in AdwToggleGroupProps (`activeName` is the by-name sibling). The port calls the same number `selected` (adw-toggle-group.ts:139-143).',
    },
    'adw-view-stack.visibleChildIndex': {
        gir: 'visibleChildName',
        why: 'GTK selects the page by widget (`visible-child`) or by name (`visible-child-name`); the port selects it by index (adw-view-stack.ts:119-123). The convergent spelling is the NAME one, because a name is a string and a string is what survives an XML attribute — the same argument ADR 0034 § 4 makes for enum nicks.',
    },

    // ── The counterpart's writable surface has no key for it. Declared and left. ──────
    'adw-about-dialog.open': {
        own: 'GTK presents and dismisses a dialog with METHODS — `adw_dialog_present()` / `adw_dialog_close()` — and AdwAboutDialogProps carries no `open`. The port keeps both methods and adds this boolean on top of them (adw-about-dialog.ts:222-226) because an XML builder assigns attributes and calls nothing.',
    },
    'adw-preferences-dialog.open': {
        own: 'The same method-versus-property split as `adw-about-dialog.open`: presentation is `adw_dialog_present()` on GTK, and AdwPreferencesDialogProps has no `open` key. The boolean exists so the dialog is reachable from an XML attribute (adw-preferences-dialog.ts:169-173).',
    },
    'adw-button-content.hostButton': {
        own: 'On GTK the button ancestor is FOUND, not set: `adw_button_content_root()` walks up the widget tree, which is why AdwButtonContentProps has no such key. NativeScript gives a view no equivalent root hook, so the port takes an explicit back-reference and applies `image-text-button` through it (adw-button-content.ts:84-88).',
    },
    'adw-button-content.iconColor': {
        own: 'GTK recolours a symbolic icon through the stylesheet — the icon node inherits `color` — so no GIR type carries an icon-colour property at all. The port pre-colours the bitmap and therefore has to expose the colour (adw-button-content.ts:119-123); its own doc records that CSS cannot recolour it afterwards.',
    },
    'adw-button-row.startIconColor': {
        own: 'The same stylesheet-versus-bitmap split as `adw-button-content.iconColor`, and the port states it in place: "the icon bitmap is pre-coloured, so CSS cannot recolour it" (adw-button-row.ts:156). GTK has no icon-colour property to converge towards on any type.',
    },
    'adw-icon.iconColor': {
        own: 'No GIR type has an icon-colour property; on GTK a symbolic icon takes its colour from the CSS `color` of its node. The port pins a hex value into the rendered SVG so a context colour survives both schemes (adw-icon.ts:81-85).',
    },
    'adw-image-button.iconColor': {
        own: 'Same as the other three icon colours on this surface: a stylesheet concern on GTK, with no writable key on `Gtk.Image` or `Gtk.Button` to name. The port pins it because the SVG is rendered rather than themed (adw-image-button.ts:105-109).',
    },
    'adw-status-page.iconColor': {
        own: 'The fourth instance of the same fact, on `Adw.StatusPage`: GTK colours the symbolic through CSS, AdwStatusPageProps has no icon-colour key, and the port has to expose the value it bakes into the SVG (adw-status-page.ts:137-141).',
    },
    'adw-carousel.position': {
        own: '`Adw.Carousel:position` exists in the GIR and is READ-ONLY, so it is not a writable slot and not a key here — generated/props.ts emits writable properties only. GTK moves the carousel with `adw_carousel_scroll_to()`, a method; the port drives its own scroll offsets and therefore sets the number (adw-carousel.ts:246-258).',
    },
    'adw-carousel.pageWidth': {
        own: 'GTK sizes carousel pages from the allocation, so there is no page-width property on `Adw.Carousel` to converge towards. The port needs an explicit DIP number because its scroll arithmetic is its own — "Set this to the carousel\'s on-screen width so `scrollToPage` lands cleanly" (adw-carousel.ts:285-289).',
    },
    'adw-combo-row.selectedValue': {
        own: "GTK exposes the selected ITEM as `Adw.ComboRow:selected-item`, which is read-only and therefore not a writable key. The port returns the selected option's `value`, or `''` when out of range (adw-combo-row.ts:156-160) — a convenience over the index, with nothing settable on the GTK side to name it after.",
    },
    'adw-drop-down.selectedValue': {
        own: 'The same read-only counterpart as `adw-combo-row.selectedValue`: `Gtk.DropDown:selected-item` is not writable, so GtkDropDownProps has no key for it. The port derives the string from its own options array (adw-drop-down.ts:140-144).',
    },
    'adw-drop-down.chooserTitle': {
        own: 'A declared SUBSTITUTION rather than a port: the file says so itself — "GTK\'s popover has no title, but a bare native sheet gives no clue what is being chosen" (adw-drop-down.ts:158). There is no popover-title property anywhere in GtkDropDownProps to converge towards.',
    },
    'adw-menu-button.menuTitle': {
        own: 'The sibling of `adw-drop-down.chooserTitle` and the same substitution: a native action sheet needs a heading where a `Gtk.Popover` needs none, and `Gtk.MenuButton` has no title property (adw-menu-button.ts:71-75).',
    },
    'adw-navigation-split-view.sidebarTag': {
        own: "`tag` is a property of `Adw.NavigationPage`, the CHILD, not of the split view — AdwNavigationSplitViewProps holds `sidebar` (a page) and no tag. The port ships no navigation-page type, so it flattens the child's tag onto the parent (adw-navigation-split-view.ts:169-173).",
    },
    'adw-navigation-split-view.contentTag': {
        own: 'The content half of the same flattening: `Adw.NavigationPage:tag` lives on the page GTK puts in `content`, and the port has no page type to put it on (adw-navigation-split-view.ts:178-182).',
    },
    'adw-password-entry-row.revealed': {
        own: 'AdwPasswordEntryRowProps is EMPTY in generated/props.ts — the row adds no writable property of its own. Clear text is `Gtk.Text:visibility` on the inner text widget, a different type, which the port cites in place (adw-password-entry-row.ts:88-92).',
    },
    'adw-password-entry-row.peeking': {
        own: 'An explicitly legacy spelling of `revealed`, and the file says neither name is in the C: "The web port called it `revealed`, this one called it `peeking` … kept so existing NativeScript callers keep working while `revealed` is the shared name" (adw-password-entry-row.ts:101). The published alias is the reason it is declared rather than deleted.',
    },
    'adw-sidebar.items': {
        own: 'Items are ADDED on GTK — `adw_sidebar_append()` — and AdwSidebarProps carries no item list (its writable keys are `dropPreload`, `filter`, `menuModel`, `mode`, `placeholder`, `selected`). The port takes the labels as a flat array because its list view is index-driven (adw-sidebar.ts:165-169).',
    },
    'adw-sidebar.sections': {
        own: 'The same method-shaped construction one level up: sections are `Adw.SidebarSection` objects appended on GTK, with no writable key on the sidebar. `AdwSidebarSection` is also one of the types the web table declares web-only for descending from `GObject.Object` (adw-sidebar.ts:174-178).',
    },
    'adw-spinner.spinning': {
        own: 'MEASURED: AdwSpinnerProps is empty — `Adw.Spinner` declares no writable property at all and animates while it is mapped. `Gtk.Spinner:spinning` belongs to a different type, and this widget is not one. The port gates its own animation and must expose the gate (adw-spinner.ts:94-98).',
    },
    'adw-spinner.size': {
        own: 'GTK sizes a spinner with `width-request`/`height-request`, which are MINIMA; this is an exact box size floored at 16 and not capped (adw-spinner.ts:112-116). ADR 0034 measured that non-equivalence — "`View.width` is an *exact* size where GTK\'s `width-request` is a *minimum*" — so naming this `widthRequest` would claim an equivalence that was checked and refused.',
    },
    'adw-status-page.iconText': {
        own: 'A glyph fallback with no GIR counterpart: `Adw.StatusPage` takes `icon-name` or a `paintable`, never a text glyph. The port keeps it for callers that have no symbolic SVG and declares it mutually exclusive with `icon` (adw-status-page.ts:125-129).',
    },
    'adw-tab-view.autohide': {
        own: '`autohide` is `Adw.TabBar:autohide` — a property of the tab BAR, a separate GType the port merges into this widget, which the file cites at adw-tab-bar.c:142-164. AdwTabViewProps has no such key, so there is nothing on this counterpart to converge towards (adw-tab-view.ts:329-333).',
    },
    'adw-tab-view.views': {
        own: 'Pages are appended on GTK (`adw_tab_view_append()`, returning an `Adw.TabPage`), and `Adw.TabView:pages` is a read-only selection model, so neither is a writable key. The port takes the pages as a plain list because it has no tab-page type (adw-tab-view.ts:375-383).',
    },
    'adw-tab-view.tabs': {
        own: 'A second name for `views` on the same surface — "Alias of {@link views}, matching the widget\'s own vocabulary" (adw-tab-view.ts:388). It inherits `views`\' answer: there is no writable page-list key on `Adw.TabView` for either spelling to converge towards.',
    },
    'adw-toggle-group.options': {
        own: 'Toggles are `Adw.Toggle` objects added with `adw_toggle_group_add()`; AdwToggleGroupProps has no list key (`active`, `activeName`, `canShrink`, `homogeneous` are the writable ones). The port rebuilds the group from a label array instead (adw-toggle-group.ts:82-86).',
    },
};

/**
 * Which alignment table each declared RENDERER's widget names are held against.
 *
 * Keyed on the package name, so it joins to `WIDGET_SURFACE_READERS` and therefore to the
 * per-package declaration: a surface that enrols and gets a reader but no table would be
 * READ and never COMPARED, which is the same hole enrolment closes one level up wearing a
 * different hat. `alignmentProblems` fails on a declared renderer missing from here.
 *
 * `@gjsify/adwaita-web` is deliberately absent and is held by its own half above:
 * `WEB_ELEMENT_ALIGNMENT` predates the four-kind union and spells its kinds `gtk`/
 * `webOnly`. Converging the two tables is a rename of a declaration vocabulary and is a
 * separate decision — this file's rule is that nothing is renamed to make a check tidier.
 */
const RENDERER_TABLES = {
    '@gjsify/adwaita-nativescript': { table: NS_WIDGET_ALIGNMENT, source: NS_TABLE_SOURCE },
    '@gjsify/adwaita-react-native': { table: RN_WIDGET_ALIGNMENT, source: RN_TABLE_SOURCE },
};

/** The surface the web half above holds, named once so the coverage rule can see it. */
const WEB_SURFACE = '@gjsify/adwaita-web';

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

/**
 * Every `export interface <Name>Props … { … }` in the generated props file, as
 * `name → { bases, own }`.
 *
 * BRACE-MATCHED, not `indexOf('\n}')` like {@link interfaceBody} above, and the
 * difference is not stylistic: `export interface AdwSpinnerProps extends … {}` closes on
 * its own line, so the cheaper reader ran past it and swallowed the NEXT interface's
 * body. `AdwSpinner` then appeared to declare `Adw.SplitButton`'s nine properties, and
 * `AdwPasswordEntryRow` `Adw.PreferencesDialog`'s three. Both are widgets this file
 * compares against; the wrong key set makes a real divergence read as agreement, silently.
 * Measured on the real file while writing the property half — two of 198 interfaces.
 *
 * Comments are stripped first so a `{` inside a doc block cannot open a body.
 */
function readInterfaces(text) {
    const code = stripComments(text);
    /** @type {Map<string, {bases: string[], own: Set<string>}>} */
    const interfaces = new Map();
    const declaration = /^export interface (\w+)((?:[^{])*)\{/gm;
    let match;
    while ((match = declaration.exec(code)) !== null) {
        const open = declaration.lastIndex - 1;
        let depth = 0;
        let close = -1;
        for (let i = open; i < code.length; i++) {
            if (code[i] === '{') depth++;
            else if (code[i] === '}' && --depth === 0) {
                close = i;
                break;
            }
        }
        if (close < 0) break;
        const own = new Set();
        for (const [, quoted, bare] of code
            .slice(open + 1, close)
            .matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\??:/gm)) {
            own.add(quoted ?? bare);
        }
        interfaces.set(match[1], {
            bases: [...match[2].matchAll(/\b(\w+Props)\b/g)].map(([, base]) => base),
            own,
        });
        declaration.lastIndex = close;
    }
    return interfaces;
}

/**
 * Every key an interface offers, its `extends` chain resolved.
 *
 * GIR's own inheritance is what the generated file mirrors, so `GtkEntryProps` alone
 * carries 37 of its 228 keys and `text`/`editable` come from `GtkEditableProps` four
 * levels away. Comparing against the OWN members only would report a widget's inherited
 * properties as divergences, which is a false red — the more expensive kind, because the
 * fix that makes it green is deleting the rule.
 *
 * Cycle-guarded: a `Props` chain is a DAG in the generated file today, and a guard that
 * only holds while that stays true is the kind of assumption this file writes down.
 */
function interfaceKeys(interfaces, name, seen = new Set()) {
    if (seen.has(name)) return new Set();
    seen.add(name);
    const record = interfaces.get(name);
    if (record === undefined) return new Set();
    const keys = new Set(record.own);
    for (const base of record.bases) for (const key of interfaceKeys(interfaces, base, seen)) keys.add(key);
    return keys;
}

/** `placeholderText` → `placeholder-text`: the second spelling the generated file emits. */
const kebab = (name) => name.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`);

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
 * One renderer surface's widget names, held against the GIR tag set in both directions.
 *
 * Lifted out of `alignmentProblems` when the React Native surface was enrolled, rather
 * than copied: the NativeScript block had already grown four rules the web block above it
 * does not have, and a third hand-written copy is how those sets drift apart. Every
 * failure names the CLASS, because that is what a consumer imports and what a `.mdx`
 * fence or an XML element spells.
 *
 * @param {{
 *   package: string, widgets: string[], table: Record<string, object>, tableSource: string,
 *   runtimeTags: Set<string>, runtimeGTypes: Set<string>,
 * }} surface
 * @returns {string[]}
 */
function rendererWidgetProblems(surface) {
    const { widgets, table, tableSource, runtimeTags, runtimeGTypes } = surface;
    const problems = [];
    const declared = new Set(Object.keys(table));
    // The keys are read back through `elementName`/`widgetClass`, which assume the `adw-`
    // rule the reader enforces. A key that does not follow it throws inside THAT module,
    // naming a file the author never edited — a failure attributed to the wrong place
    // teaches the next person to distrust the reader, so it is refused here by name.
    const malformed = [...declared].filter((widget) => !/^adw-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(widget));
    if (malformed.length > 0) {
        return [
            'the alignment table is keyed on the widget file spelling (adw-drop-down), and ' +
                `${malformed.join(', ')} is not one — fix the key in ${tableSource}`,
        ];
    }
    for (const widget of widgets) {
        const klass = widgetClass(elementName(widget));
        const entry = table[widget];
        if (runtimeTags.has(widget)) {
            if (entry) {
                problems.push(
                    `${klass} already shares its spelling with the GTK tag '${widget}', so its alignment ` +
                        `entry is redundant — delete it from ${tableSource} rather than leaving two answers`,
                );
            }
            continue;
        }
        if (!entry) {
            problems.push(
                `${klass} (${widget}) has no GTK tag of the same name and no alignment entry. Add one to ` +
                    `${tableSource}: 'gir' if it is the same widget under another spelling, 'composes' ` +
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
                    ...reasonProblems(`${klass} is declared to be '${entry.gir}'`, entry.why, "a 'why'", tableSource),
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
                        tableSource,
                    ),
                );
            }
        } else if (entry.own !== undefined) {
            problems.push(
                ...reasonProblems(
                    `${klass} is declared to have no GIR counterpart`,
                    entry.own,
                    "an 'own' reason",
                    tableSource,
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
    const present = new Set(widgets);
    for (const widget of declared) {
        if (!present.has(widget)) {
            problems.push(
                `the alignment table declares ${widgetClass(elementName(widget))}, which ` +
                    `${surface.package} no longer ships — drop the entry from ${tableSource}`,
            );
        }
    }
    return problems;
}

/**
 * Which GIR type(s) a renderer widget is measured against, from the widget ledger.
 *
 * A widget whose spelling already IS a tag answers for itself; a `gir` entry names one
 * GType; a `composes` entry names several and the key sets are unioned, because the UI is
 * assembled from all of them. `own` and `gap` return null: there is nothing to compare
 * against, and comparing against nothing is how a blind side passes.
 */
function counterpartsOf(widget, table, tagToGType) {
    if (tagToGType.has(widget)) return [tagToGType.get(widget)];
    const entry = table[widget];
    if (entry?.gir !== undefined) return [entry.gir];
    if (entry?.composes !== undefined) return entry.composes;
    return null;
}

/**
 * What the property comparison actually found, counted rather than inferred.
 *
 * The summary used to be able to say "agree" as `settable - declared`, which is only true
 * while every rule above holds — i.e. it would report the right number exactly when
 * nothing was wrong, and an arbitrary one otherwise. A count that is a consequence of the
 * check passing is not a measurement. This walks the same two sides and counts.
 *
 * @param {object} world
 * @returns {{widgets: number, settable: number, shared: number, diverging: number}}
 */
function propertyCensus(world) {
    const { interfaces, byGType, runtime, nsWidgets, nsTable, nsProperties } = world;
    const tagToGType = new Map([...runtime].map(([gtype, tag]) => [tag, gtype]));
    let widgets = 0;
    let settable = 0;
    let shared = 0;
    for (const widget of nsWidgets) {
        const counterparts = counterpartsOf(widget, nsTable, tagToGType);
        if (counterparts === null) continue;
        widgets++;
        const keys = new Set();
        for (const gtype of counterparts) {
            for (const key of interfaceKeys(interfaces, byGType.get(gtype) ?? '')) keys.add(key);
        }
        for (const property of nsProperties.get(widget) ?? []) {
            settable++;
            if (keys.has(property) || keys.has(kebab(property))) shared++;
        }
    }
    return { widgets, settable, shared, diverging: settable - shared };
}

/**
 * The property half: every settable property of a NativeScript widget WITH a counterpart
 * is a key of that counterpart's props interface, or it is declared.
 *
 * @param {object} world the same world `alignmentProblems` reads
 * @returns {string[]}
 */
function propertyProblems(world) {
    const { interfaces, byGType, runtime, nsWidgets, nsTable, nsProperties, propertyTable } = world;
    const tagToGType = new Map([...runtime].map(([gtype, tag]) => [tag, gtype]));
    const problems = [];

    // The controls. A comparison is blind wherever one side has no entry, and each of
    // these three would make the whole half pass while measuring nothing.
    if (interfaces.size === 0) {
        problems.push('no interfaces read from generated/props.ts — the property half has no comparison target');
    }
    const measured = nsWidgets.filter((widget) => counterpartsOf(widget, nsTable, tagToGType) !== null);
    if (measured.length === 0) {
        problems.push('no NativeScript widget has a GIR counterpart — the property half has nothing to measure');
    }
    if (measured.some((widget) => nsProperties.get(widget) === null)) {
        const unreadable = measured.filter((widget) => nsProperties.get(widget) === null);
        problems.push(
            `the settable-property reader found no class for ${unreadable.join(', ')} — a widget whose ` +
                'accessors cannot be read drops out of the comparison as an aligned one',
        );
    }
    if (problems.length > 0) return problems;

    const settableTotal = measured.reduce((sum, widget) => sum + nsProperties.get(widget).length, 0);
    if (settableTotal === 0) {
        problems.push(
            'no settable property found on any counterpart-bearing NativeScript widget — the reader or the ' +
                'accessor convention moved, and an empty side agrees with everything',
        );
        return problems;
    }

    const declared = new Set(Object.keys(propertyTable));
    const seen = new Set();
    for (const widget of measured) {
        const counterparts = counterpartsOf(widget, nsTable, tagToGType);
        const keys = new Set();
        for (const gtype of counterparts) {
            for (const key of interfaceKeys(interfaces, byGType.get(gtype) ?? '')) keys.add(key);
        }
        const klass = widgetClass(elementName(widget));
        const against = counterparts.join(' + ');
        for (const property of nsProperties.get(widget)) {
            const key = `${widget}.${property}`;
            seen.add(key);
            const entry = propertyTable[key];
            if (keys.has(property) || keys.has(kebab(property))) {
                if (entry) {
                    problems.push(
                        `${klass}.${property} is already a key of ${against}, so its property entry is ` +
                            `redundant — delete '${key}' from ${NS_PROPERTY_TABLE_SOURCE} rather than leaving ` +
                            'two answers',
                    );
                }
                continue;
            }
            if (!entry) {
                problems.push(
                    `${klass}.${property} is settable and is not a key of ${against}, and nothing declares ` +
                        `what it is. Add '${key}' to ${NS_PROPERTY_TABLE_SOURCE}: 'gir' with the key it ` +
                        "should converge to, 'own' with the reason the counterpart has no key for it, or " +
                        "'gap' with an issue number. An undeclared divergence is an undecided one, and " +
                        'undecided is what fails here.',
                );
                continue;
            }
            const kinds = PROPERTY_KINDS.filter((kind) => entry[kind] !== undefined);
            if (kinds.length !== 1) {
                problems.push(
                    `${klass}.${property} has a property entry declaring ${kinds.length === 0 ? 'no kind at all' : kinds.join(' and ')} — ` +
                        `exactly one of ${PROPERTY_KINDS.map((kind) => `'${kind}'`).join(', ')} says what the ` +
                        'property is, and two answers is none',
                );
                continue;
            }
            if (entry.gir !== undefined) {
                if (entry.gir === property) {
                    problems.push(
                        `${klass}.${property} declares it should converge to '${entry.gir}', which is its own ` +
                            'name. A convergence target that is the property itself records no decision — if ' +
                            `the key exists the entry is redundant, and if it does not the target is wrong.`,
                    );
                } else if (!keys.has(entry.gir) && !keys.has(kebab(entry.gir))) {
                    problems.push(
                        `${klass}.${property} declares it should converge to '${entry.gir}', which is not a ` +
                            `key of ${against} in generated/props.ts. A convergence target nothing offers is ` +
                            'not a target.',
                    );
                } else {
                    problems.push(
                        ...reasonProblems(
                            `${klass}.${property} should converge to '${entry.gir}'`,
                            entry.why,
                            "a 'why'",
                            NS_PROPERTY_TABLE_SOURCE,
                        ),
                    );
                }
            } else if (entry.own !== undefined) {
                problems.push(
                    ...reasonProblems(
                        `${klass}.${property} is declared to have no counterpart key`,
                        entry.own,
                        "an 'own' reason",
                        NS_PROPERTY_TABLE_SOURCE,
                    ),
                );
            } else if (!GAP_ISSUE.test(entry.gap)) {
                problems.push(
                    `${klass}.${property} points its gap at '${entry.gap}', which is not an issue number. A ` +
                        'gap is a POINTER at tracked work and never a reason — the same rule the widget ' +
                        'ledger sets, for the same reason.',
                );
            }
        }
    }
    for (const key of declared) {
        if (seen.has(key)) continue;
        problems.push(
            `the property ledger declares '${key}', which no counterpart-bearing NativeScript widget sets ` +
                `any more — drop the entry from ${NS_PROPERTY_TABLE_SOURCE}. A ledger describing a property ` +
                'that does not exist tells the next reader something false.',
        );
    }
    return problems;
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
    const { renderers, surfaces, held } = world;

    // ENROLMENT FIRST. Every rule below reads a surface, and which surfaces exist is now a
    // per-package DECLARATION rather than a list in this file (ADR 0034 § 5). A declared
    // surface with no reader means the sets below are incomplete in a way no other rule
    // can see, so this half runs before anything is compared and stops the run.
    problems.push(...enrolmentProblems(surfaces));
    // …and being READ is not being COMPARED. A renderer with a reader but no alignment
    // table would contribute its widget names to the summary and be held against nothing.
    for (const { name, declaration } of surfaces.declared) {
        if (declaration?.role !== 'renderer' || held.includes(name)) continue;
        problems.push(
            `${name} is a declared widget-vocabulary renderer and no half of this check compares its ` +
                'widget names against the GIR tag table — it is read and never held. Add it to ' +
                'RENDERER_TABLES in scripts/check-vocabulary-alignment.mjs with an alignment table of its own.',
        );
    }
    if (problems.length > 0) return problems;

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
    if (webElements.length === 0) {
        problems.push('no adw-*/gtk-* web elements found — the independent half is not being read');
    }
    for (const surface of renderers) {
        if (surface.widgets.length === 0) {
            problems.push(`no Adw* widgets found for ${surface.package} — that surface is not being read`);
        }
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

    // The RENDERER halves. The same shape over a second independent source per surface:
    // these names are a widget FILENAME plus the class it exports (NativeScript) or a
    // barrel export line (React Native), all hand-typed, and the generator that emits the
    // tag table reads none of them. ONE function over both, because a third copy of this
    // loop is how the second surface came to differ from the first in the details.
    for (const surface of renderers) {
        problems.push(...rendererWidgetProblems({ ...surface, runtimeTags, runtimeGTypes }));
    }

    // The PROPERTY half — one level down, on the surface where it was measured.
    problems.push(...propertyProblems(world));

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
const FIXTURE_NS_WIDGETS = ['adw-bin', 'adw-button', 'adw-icon-button', 'adw-grid'];
const FIXTURE_NS_TABLE = {
    'adw-button': { gir: 'GtkButton', why: FIXTURE_REASON },
    'adw-icon-button': { composes: ['GtkButton', 'GtkBox'], why: FIXTURE_REASON },
    'adw-grid': { own: FIXTURE_REASON },
};

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
    nsWidgets: FIXTURE_NS_WIDGETS,
    nsTable: FIXTURE_NS_TABLE,
    surfaces: {
        declared: [
            { name: '@gjsify/fixture-host', rel: 'packages/fixture-host', declaration: { role: 'reference' } },
            {
                name: '@gjsify/adwaita-nativescript',
                rel: 'packages/fixture-ns',
                declaration: { role: 'renderer' },
            },
        ],
        readers: {
            '@gjsify/fixture-host': { role: 'reference' },
            '@gjsify/adwaita-nativescript': { role: 'renderer' },
        },
    },
    held: ['@gjsify/adwaita-nativescript', '@gjsify/adwaita-react-native'],
    renderers: [
        {
            package: '@gjsify/adwaita-nativescript',
            widgets: FIXTURE_NS_WIDGETS,
            table: FIXTURE_NS_TABLE,
            tableSource: NS_TABLE_SOURCE,
        },
        // A second renderer with an EMPTY table, so the shape a newly enrolled surface
        // has — every widget already sharing a spelling, nothing to declare — is a state
        // the rules are exercised over rather than one they meet first in the real tree.
        {
            package: '@gjsify/adwaita-react-native',
            widgets: ['adw-bin'],
            table: {},
            tableSource: RN_TABLE_SOURCE,
        },
    ],
    // The property half. `GtkButtonProps` extends `GtkWidgetProps`, so `sensitive` is only
    // reachable through the chain — without an inherited key in the fixture, a reader that
    // ignored `extends` would pass every vector and report a widget's inherited properties
    // as divergences against the real tree.
    interfaces: new Map([
        ['AdwBinProps', { bases: [], own: new Set(['child', 'margin-top']) }],
        ['GtkBoxProps', { bases: [], own: new Set(['spacing']) }],
        ['GtkWidgetProps', { bases: [], own: new Set(['sensitive']) }],
        ['GtkButtonProps', { bases: ['GtkWidgetProps'], own: new Set(['label', 'iconName']) }],
    ]),
    nsProperties: new Map([
        // `marginTop` is a key only in its kebab spelling, which is the join the generated
        // file forces and the one a camelCase-only comparison would report as a divergence.
        ['adw-bin', ['child', 'marginTop']],
        ['adw-button', ['label', 'sensitive', 'variant']],
        ['adw-icon-button', ['spacing', 'icon']],
        // No counterpart, so never measured — a widget the property half must SKIP rather
        // than report as 100 % divergent.
        ['adw-grid', ['rows']],
    ]),
    propertyTable: {
        'adw-icon-button.icon': { gir: 'iconName', why: FIXTURE_REASON },
        'adw-button.variant': { own: FIXTURE_REASON },
    },
});

/**
 * The NativeScript surface lives in the world TWICE — as `nsWidgets`/`nsTable` for the
 * property half and inside `renderers` for the widget half — so a vector that changes one
 * and not the other tests a world that cannot exist. This is the only way to change it.
 */
const withNs = (world, changes) => {
    const nsWidgets = changes.nsWidgets ?? world.nsWidgets;
    const nsTable = changes.nsTable ?? world.nsTable;
    return {
        ...world,
        nsWidgets,
        nsTable,
        renderers: [{ ...world.renderers[0], widgets: nsWidgets, table: nsTable }, ...world.renderers.slice(1)],
    };
};

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
    [
        'no NativeScript widgets at all',
        (w) => withNs(w, { nsWidgets: [] }),
        'no Adw* widgets found for @gjsify/adwaita-nativescript',
    ],
    [
        'an undeclared NativeScript widget',
        (w) => withNs(w, { nsTable: {} }),
        'AdwButton (adw-button) has no GTK tag of the same name and no alignment entry',
    ],
    [
        'a gir target that is not a GType in the table',
        (w) => withNs(w, { nsTable: { ...w.nsTable, 'adw-button': { gir: 'GtkGhost', why: FIXTURE_REASON } } }),
        "AdwButton is declared to be 'GtkGhost', which is not a GType",
    ],
    [
        'a gir alias with no reason',
        (w) => withNs(w, { nsTable: { ...w.nsTable, 'adw-button': { gir: 'GtkButton' } } }),
        "AdwButton is declared to be 'GtkButton' with no reason",
    ],
    [
        'a composes member that is not a GType',
        (w) =>
            withNs(w, {
                nsTable: {
                    ...w.nsTable,
                    'adw-icon-button': { composes: ['GtkButton', 'GtkGhost'], why: FIXTURE_REASON },
                },
            }),
        'AdwIconButton composes GtkGhost, not a GType',
    ],
    [
        'a composition of one',
        (w) =>
            withNs(w, {
                nsTable: { ...w.nsTable, 'adw-icon-button': { composes: ['GtkButton'], why: FIXTURE_REASON } },
            }),
        'a composition is at least',
    ],
    [
        'a composition with no reason',
        (w) => withNs(w, { nsTable: { ...w.nsTable, 'adw-icon-button': { composes: ['GtkButton', 'GtkBox'] } } }),
        'AdwIconButton composes GtkButton + GtkBox with no reason',
    ],
    [
        'an own entry whose reason is a word',
        (w) => withNs(w, { nsTable: { ...w.nsTable, 'adw-grid': { own: 'none' } } }),
        'AdwGrid is declared to have no GIR counterpart with a 4-character reason',
    ],
    [
        'a NativeScript entry answering twice',
        (w) => withNs(w, { nsTable: { ...w.nsTable, 'adw-grid': { gir: 'GtkBox', own: FIXTURE_REASON } } }),
        'declaring gir and own',
    ],
    [
        'a NativeScript entry answering not at all',
        (w) => withNs(w, { nsTable: { ...w.nsTable, 'adw-grid': { why: FIXTURE_REASON } } }),
        'declaring no kind at all',
    ],
    [
        'a gap pointing at prose instead of tracked work',
        (w) => withNs(w, { nsTable: { ...w.nsTable, 'adw-grid': { gap: 'someone should look at this' } } }),
        'not an issue number',
    ],
    [
        'a redundant entry for a widget that already matches',
        (w) => withNs(w, { nsTable: { ...w.nsTable, 'adw-bin': { own: FIXTURE_REASON } } }),
        "AdwBin already shares its spelling with the GTK tag 'adw-bin'",
    ],
    [
        'a stale entry for a widget that is gone',
        (w) => withNs(w, { nsTable: { ...w.nsTable, 'adw-vanished': { own: FIXTURE_REASON } } }),
        'AdwVanished, which @gjsify/adwaita-nativescript no longer ships',
    ],
    [
        'a key outside the adw- spelling the readers assume',
        (w) => withNs(w, { nsTable: { ...w.nsTable, AdwButton: { own: FIXTURE_REASON } } }),
        'AdwButton is not one',
    ],
    // A SECOND renderer, enrolled by declaration rather than by being named here. Its
    // table is empty, which is the shape every new surface starts in.
    [
        'a second renderer with no widgets read',
        (w) => ({ ...w, renderers: [w.renderers[0], { ...w.renderers[1], widgets: [] }] }),
        'no Adw* widgets found for @gjsify/adwaita-react-native',
    ],
    [
        'a widget on the second renderer under a name that is not a tag',
        (w) => ({ ...w, renderers: [w.renderers[0], { ...w.renderers[1], widgets: ['adw-novel'] }] }),
        'AdwNovel (adw-novel) has no GTK tag of the same name and no alignment entry',
    ],
    // ── The property half (ADR 0034 stage 6). ────────────────────────────────────────
    [
        'no interfaces read from the generated props file',
        (w) => ({ ...w, interfaces: new Map() }),
        'no interfaces read from generated/props.ts',
    ],
    [
        'no NativeScript widget with a counterpart',
        (w) => withNs(w, { nsWidgets: ['adw-grid'] }),
        'the property half has nothing to measure',
    ],
    [
        'a widget class the settable-property reader could not find',
        (w) => ({ ...w, nsProperties: new Map([...w.nsProperties, ['adw-button', null]]) }),
        'the settable-property reader found no class for adw-button',
    ],
    [
        'no settable property anywhere on the surface',
        (w) => ({ ...w, nsProperties: new Map([...w.nsProperties].map(([tag]) => [tag, []])) }),
        'no settable property found on any counterpart-bearing NativeScript widget',
    ],
    [
        'an undeclared settable property',
        (w) => ({ ...w, propertyTable: {} }),
        'AdwButton.variant is settable and is not a key of GtkButton, and nothing declares what it is',
    ],
    [
        'a property entry for a property that is already a key',
        (w) => ({ ...w, propertyTable: { ...w.propertyTable, 'adw-button.label': { own: FIXTURE_REASON } } }),
        'AdwButton.label is already a key of GtkButton, so its property entry is redundant',
    ],
    [
        'a property entry only reachable through the extends chain',
        (w) => ({ ...w, propertyTable: { ...w.propertyTable, 'adw-button.sensitive': { own: FIXTURE_REASON } } }),
        'AdwButton.sensitive is already a key of GtkButton',
    ],
    [
        'a stale property entry',
        (w) => ({ ...w, propertyTable: { ...w.propertyTable, 'adw-button.vanished': { own: FIXTURE_REASON } } }),
        "the property ledger declares 'adw-button.vanished'",
    ],
    [
        'a convergence target that is not a key of the counterpart',
        (w) => ({
            ...w,
            propertyTable: { ...w.propertyTable, 'adw-icon-button.icon': { gir: 'ghost', why: FIXTURE_REASON } },
        }),
        "should converge to 'ghost', which is not a key of GtkButton + GtkBox",
    ],
    [
        'a convergence target that is the property itself',
        (w) => ({
            ...w,
            propertyTable: { ...w.propertyTable, 'adw-icon-button.icon': { gir: 'icon', why: FIXTURE_REASON } },
        }),
        'which is its own name',
    ],
    [
        'a convergence entry with no reason',
        (w) => ({ ...w, propertyTable: { ...w.propertyTable, 'adw-icon-button.icon': { gir: 'iconName' } } }),
        "AdwIconButton.icon should converge to 'iconName' with no reason",
    ],
    [
        'an own property reason under the floor',
        (w) => ({ ...w, propertyTable: { ...w.propertyTable, 'adw-button.variant': { own: 'none' } } }),
        'AdwButton.variant is declared to have no counterpart key with a 4-character reason',
    ],
    [
        'a property entry answering twice',
        (w) => ({
            ...w,
            propertyTable: { ...w.propertyTable, 'adw-button.variant': { gir: 'label', own: FIXTURE_REASON } },
        }),
        'AdwButton.variant has a property entry declaring gir and own',
    ],
    [
        'a property entry answering not at all',
        (w) => ({ ...w, propertyTable: { ...w.propertyTable, 'adw-button.variant': { why: FIXTURE_REASON } } }),
        'AdwButton.variant has a property entry declaring no kind at all',
    ],
    [
        'a property gap pointing at prose instead of tracked work',
        (w) => ({ ...w, propertyTable: { ...w.propertyTable, 'adw-button.variant': { gap: 'later maybe' } } }),
        "AdwButton.variant points its gap at 'later maybe', which is not an issue number",
    ],
    // ── Enrolment (ADR 0034 stage 4). These run FIRST and stop the run. ──────────────
    [
        'a declared renderer no half of the check compares',
        (w) => ({
            ...w,
            surfaces: {
                declared: [
                    ...w.surfaces.declared,
                    { name: '@gjsify/fixture-rn', rel: 'packages/fixture-rn', declaration: { role: 'renderer' } },
                ],
                readers: { ...w.surfaces.readers, '@gjsify/fixture-rn': { role: 'renderer' } },
            },
        }),
        '@gjsify/fixture-rn is a declared widget-vocabulary renderer and no half of this check compares',
    ],
    [
        'a surface that declares itself and has no reader',
        (w) => ({
            ...w,
            surfaces: {
                ...w.surfaces,
                declared: [
                    ...w.surfaces.declared,
                    { name: '@gjsify/fixture-next', rel: 'packages/fixture-next', declaration: { role: 'renderer' } },
                ],
            },
        }),
        '@gjsify/fixture-next declares `gjsify.widgetVocabulary` and NO reader covers it',
    ],
    [
        'a reader whose package stopped declaring itself',
        (w) => ({
            ...w,
            surfaces: { ...w.surfaces, readers: { ...w.surfaces.readers, '@gjsify/ghost': { role: 'renderer' } } },
        }),
        'reads @gjsify/ghost, which declares no `gjsify.widgetVocabulary`',
    ],
    [
        'a declaration that is not an object',
        (w) => ({
            ...w,
            surfaces: {
                ...w.surfaces,
                declared: [w.surfaces.declared[0], { ...w.surfaces.declared[1], declaration: true }],
            },
        }),
        'must be an object with a `role`',
    ],
    [
        'a surface declaring an unknown role',
        (w) => ({
            ...w,
            surfaces: {
                ...w.surfaces,
                declared: [w.surfaces.declared[0], { ...w.surfaces.declared[1], declaration: { role: 'both' } }],
            },
        }),
        'expected one of',
    ],
    [
        'a role the reader disagrees with',
        (w) => ({
            ...w,
            surfaces: {
                ...w.surfaces,
                readers: { ...w.surfaces.readers, '@gjsify/adwaita-nativescript': { role: 'reference' } },
            },
        }),
        "declares role 'renderer' and",
    ],
    [
        'two packages declaring themselves the reference',
        (w) => ({
            ...w,
            surfaces: {
                ...w.surfaces,
                declared: [w.surfaces.declared[0], { ...w.surfaces.declared[1], declaration: { role: 'reference' } }],
                readers: { ...w.surfaces.readers, '@gjsify/adwaita-nativescript': { role: 'reference' } },
            },
        }),
        "2 package(s) declare role 'reference'",
    ],
    [
        'no package declaring itself a renderer',
        (w) => ({
            ...w,
            surfaces: {
                declared: [w.surfaces.declared[0]],
                readers: { '@gjsify/fixture-host': { role: 'reference' } },
            },
        }),
        "no package declares role 'renderer'",
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
    // EVERY surface is read THROUGH the enrolment registry, so "declared" and "read" are
    // the same act rather than two lists that agree today. A declared surface with no
    // reader simply produces nothing here, and `enrolmentProblems` is what says so.
    const surfaceWidgets = new Map(
        Object.entries(WIDGET_SURFACE_READERS)
            .filter(([, reader]) => reader.widgets !== null)
            .map(([name, reader]) => [name, reader.widgets(ROOT)]),
    );
    const nsFiles = adwaitaNativeScriptWidgets(ROOT);
    const nsWidgets = surfaceWidgets.get('@gjsify/adwaita-nativescript') ?? [];
    const renderers = Object.entries(RENDERER_TABLES)
        .filter(([name]) => surfaceWidgets.has(name))
        .map(([name, { table, source }]) => ({
            package: name,
            widgets: surfaceWidgets.get(name),
            table,
            tableSource: source,
        }));
    world = {
        runtime: readRuntimeTable(read(WIDGETS)),
        tags: readTagsConst(read(SURFACE_DATA)),
        byTag: readMembers(props, 'WidgetPropsByTag'),
        byGType: readMembers(props, 'WidgetPropsByGType'),
        classByTag: readMembers(props, 'WidgetClassByTag'),
        vueAliases: readMembers(props, 'WidgetPropsVueAliases'),
        dialects: DIALECTS.map((dialect) => ({ ...dialect, ...readDialect(read(dialect.file)) })),
        webElements: surfaceWidgets.get(WEB_SURFACE) ?? [],
        table: WEB_ELEMENT_ALIGNMENT,
        // The reader returns bare names; the tables are keyed in the tag namespace they
        // are held against, so the `adw-` goes back on exactly once, here.
        nsWidgets,
        nsTable: NS_WIDGET_ALIGNMENT,
        // The declaration half. `declaredWidgetSurfaces` reads the manifests and
        // `WIDGET_SURFACE_READERS` is what this repository can read; the rule is the JOIN,
        // so a fourth surface enrols by declaring itself and fails until it is readable.
        surfaces: { declared: declaredWidgetSurfaces(ROOT), readers: WIDGET_SURFACE_READERS },
        renderers,
        held: [WEB_SURFACE, ...renderers.map((surface) => surface.package)],
        // The property half's two sides: the GIR-derived interfaces, and what each
        // NativeScript widget class lets a caller set. `null` for a class the reader could
        // not find is deliberate — see the control in `propertyProblems`.
        interfaces: readInterfaces(props),
        nsProperties: new Map(
            [...nsFiles].map(([name, file]) => {
                const setters = settablePropertiesOfClass(read(file), widgetClass(name));
                return [`adw-${name}`, setters === null ? null : [...setters]];
            }),
        ),
        propertyTable: NS_PROPERTY_ALIGNMENT,
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
//
// The RENDERER segment is derived per enrolled surface rather than written once per
// surface, for the same reason enrolment itself is a declaration: a fifth surface joins
// this line by declaring itself, not by somebody remembering to extend a sentence.
const tagSet = new Set(world.runtime.values());
const kindCount = (table, kind) => Object.values(table).filter((entry) => entry[kind] !== undefined).length;
const aliased = kindCount(WEB_ELEMENT_ALIGNMENT, 'gtk');
const webOnly = kindCount(WEB_ELEMENT_ALIGNMENT, 'webOnly');
const shared = world.webElements.filter((element) => tagSet.has(element)).length;
const rendererLines = world.renderers.map((surface) => {
    const same = surface.widgets.filter((widget) => tagSet.has(widget)).length;
    const converge = kindCount(surface.table, 'gir') + kindCount(surface.table, 'composes');
    return (
        `${surface.widgets.length} ${surface.package} widgets — ${same} share a spelling, ` +
        `${converge} should converge, ${kindCount(surface.table, 'own')} declared own, ` +
        `${kindCount(surface.table, 'gap')} undecided`
    );
});
// THE WEB SURFACE COUNTS. It was left out while `WEB_ELEMENT_ALIGNMENT` was the only
// table and `renderers` was everything else, and the omission survived the moment the
// renderers grew a second table: the line said "distance to one vocabulary" over two of
// the three surfaces the clause binds, so ten elements naming a GTK widget under an
// `adw-` spelling were not in the number that measures exactly that. A count narrower
// than its own sentence reads as progress it has not made — and the direction it hid
// was the expensive one, because a distance that cannot move is a distance nobody works
// on. `gtk` is the web spelling of `gir`: the same widget under another name.
const widgetDistance =
    aliased +
    world.renderers.reduce(
        (total, surface) => total + kindCount(surface.table, 'gir') + kindCount(surface.table, 'composes'),
        0,
    );
const census = propertyCensus(world);
const propConverge = kindCount(NS_PROPERTY_ALIGNMENT, 'gir');
console.log(
    `check-vocabulary-alignment: self-test green — ${VECTORS.length - 1} failing vector(s), ` +
        `${READER_VECTORS.length} reader vector(s). ` +
        `${world.surfaces.declared.length} declared widget surface(s), every one of them read. ` +
        `${world.runtime.size} GTK tags across ${DIALECTS.length} dialect surfaces + the runtime table + the ` +
        `surface data; ${world.webElements.length} ${WEB_SURFACE} elements — ${shared} share a spelling, ` +
        `${aliased} alias one, ${webOnly} declared web-only; ` +
        `${rendererLines.join('; ')}. ` +
        `Properties, on @gjsify/adwaita-nativescript only: ${census.widgets} widgets with a GIR counterpart set ` +
        `${census.settable} settable propert(y|ies) between them — ${census.shared} already agree with the ` +
        `counterpart's ConstructorProps, ${census.diverging} do not (${propConverge} should converge, ` +
        `${kindCount(NS_PROPERTY_ALIGNMENT, 'own')} declared own, ` +
        `${kindCount(NS_PROPERTY_ALIGNMENT, 'gap')} undecided). ` +
        `Distance to one vocabulary: ${widgetDistance} widget name(s) and ${propConverge} property name(s), ` +
        'and both can only go down.',
);
