// SPDX-License-Identifier: MIT
//
// The self-verifying half. ADR 0032 § 11 asks for the layer's regression proof to
// live in THIS repository: the application the layer was measured against is
// third-party and under a different licence, so it cannot be the test. This
// showcase is the substitute, and what turns "a React Native view layer can run on
// GTK" from a claim into a measurement is not the window — it is the assertions
// below.
//
// WHY A LAUNCH PROVES NOTHING. GTK's failure mode is exit 0. `box.orientation =
// 'vertical'` keeps HORIZONTAL with no diagnostic; a CSS property GTK does not know
// is dropped by its parser in silence; a mis-parented widget floods `Gtk-WARNING`
// and the process still succeeds; a throw inside a GLib callback prints `JS ERROR`
// and lets `activate` return. So `showcase-smoke`, which launches the app and waits,
// can only ever report "it started". Three things this probe asserts that a launch
// cannot:
//
//   · WHICH WIDGETS RESULTED. `View` is a `Gtk.Box` or a `Gtk.Overlay` depending on
//     its CHILDREN, `TextInput` is a `Gtk.Entry` or a `Gtk.TextView` depending on
//     one prop, and a `ScrollView`'s content box is a second styleable node behind a
//     `Gtk.Viewport`. Every one of those is a choice L2 made, and a window looks
//     plausible when it makes the wrong one.
//   · WHICH `css-classes` LANDED, AND WHAT THEY MEAN. `css-classes` is a whole-list
//     property, so writing the generated name REPLACES whatever GTK put there —
//     Adwaita's stylesheet selects on those classes, and losing one is a paint
//     change with nothing to attribute it to. The probe reads the class off the real
//     widget AND looks the rule up in the generated document, because a class whose
//     rule is missing is a style that silently does not apply.
//   · ZERO GTK DIAGNOSTICS, counted by the harness AFTER teardown — which is exactly
//     where a mis-parented tree reports itself (`Finalizing GtkLabel …, but it still
//     has children left` arrives at finalize, at exit 0).
//
// `runHostProbeApp` owns the harness: the env gate, the diagnostics collector, the
// `check()` recorder and its self-check, the `PROBE: PASS|FAIL <json>` protocol, the
// `app.hold()` discipline and the rule that the GUI path runs the SAME assertions
// before presenting. Nothing about the probe is written twice.
//
// THE WINDOW IS THE APPLICATION'S, THE CONTENT IS REACT'S. `createRoot(container)`
// renders INTO a widget and a toplevel is not a child of anything, so the
// application owns the `Adw.ApplicationWindow`, its `Adw.ToolbarView` and its header
// bar — the same split `@gjsify/react-native`'s own `AppRegistry` makes, and for the
// same reason rather than by imitation. Those three are the only GTK objects this
// showcase constructs by hand; everything inside the content box is React Native.

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Pango from 'gi://Pango?version=1.0';
import Gtk from 'gi://Gtk?version=4.0';

import { registerBuiltinWidgets, runHostProbeApp, type ProbeCheck } from '@gjsify/gtk-host';
import { descendants, dumpTree, findDescendant, gtkChildren } from '@gjsify/gtk-host/conformance';
import { StyleSheet } from '@gjsify/gtk-host/style';
import { createRoot } from '@gjsify/gtk-host/react';
import { configureStyle } from '@gjsify/react-native';

import { Catalogue, fired } from './screen.js';
import { TOKENS } from './tokens.js';

registerBuiltinWidgets();

interface Ui {
    readonly window: Adw.ApplicationWindow;
    /** The box React renders into — every assertion is scoped to this subtree. */
    readonly container: Gtk.Box;
    readonly root: ReturnType<typeof createRoot>;
    /** The generated document, held so the probe can look a class up in it. */
    readonly sheet: StyleSheet;
}

function buildUi(app: Adw.Application | null): Ui {
    const window = new Adw.ApplicationWindow({
        title: 'React Native design system',
        default_width: 960,
        default_height: 720,
        ...(app ? { application: app } : {}),
    });
    const toolbar = new Adw.ToolbarView();
    toolbar.add_top_bar(new Adw.HeaderBar());
    const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    toolbar.set_content(container);
    window.set_content(toolbar);

    // The sheet is OURS rather than the layer's default, and that is what makes the
    // class assertions possible: `styleConfig()` builds a private `StyleSheet` on
    // first use, and a probe that cannot read the document can only check that a
    // class name exists — which is the assertion that passes while the rule behind
    // it is missing. `configureStyle` before the first render, per ADR 0032 § 3.
    const sheet = new StyleSheet();
    configureStyle({ tokens: TOKENS, sheet });

    const root = createRoot(container as unknown as Gtk.Widget);
    // `render` flushes synchronously; the sheet does not — it coalesces its reload
    // onto a microtask, and a probe has no microtask checkpoint before it starts
    // measuring. `flush()` is the deterministic spelling, and the measurements below
    // need the provider installed on the display.
    root.render(<Catalogue />);
    sheet.flush();
    return { window, container, root, sheet };
}

// --- readers over the REAL tree ---------------------------------------------

const typeOf = (widget: Gtk.Widget): string =>
    GObject.type_name((widget as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype) ??
    '(unregistered GType)';

/**
 * A widget by its `testID`.
 *
 * `testID` routes to `Gtk.Widget:name`, which is what the GTK inspector shows and
 * what GTK CSS `#name` selects — as close to a test handle as GTK has. An unnamed
 * widget reports its GType name instead, so a lookup for a kebab-cased id cannot
 * collide with one.
 */
const named = (root: Gtk.Widget, id: string): Gtk.Widget | null =>
    findDescendant(root, (widget) => widget.get_name() === id);

/** The classes THIS layer minted, separated from the ones GTK and the table own. */
const generated = (widget: Gtk.Widget): string[] =>
    [...widget.get_css_classes()].filter((name) => name.startsWith('gjsify-'));

/**
 * The declarations behind one generated class, read out of the document.
 *
 * A class name on a widget and a rule in the sheet are two different facts. The
 * first is what the reconciler wrote; the second is what GTK will paint, and the
 * sheet refuses a rule that GTK's parser would reject — so the only way to assert
 * the second is to read it.
 */
function ruleFor(document: string, cssClass: string, pseudo = ''): string {
    const head = `.${cssClass}${pseudo} {`;
    const start = document.indexOf(head);
    if (start === -1) return '';
    const end = document.indexOf('}', start);
    return document.slice(start + head.length, end === -1 ? undefined : end).trim();
}

/**
 * Run the default main context until `done()` or the budget is spent.
 *
 * React's default lane hands work to `scheduler`, whose host callback under GJS is a
 * GLib timer source — and nothing drives it inside a probe. BOUNDED on purpose: a
 * scheduler that never runs has to fail an assertion rather than hang, because an
 * unbounded wait is what `showcase-smoke` reads as "still up after the dwell", a
 * failure reporting itself as a pass.
 */
function pump(done: () => boolean, budget = 400): boolean {
    const context = GLib.MainContext.default();
    for (let index = 0; index < budget; index++) {
        if (done()) return true;
        context.iteration(false);
    }
    return done();
}

/** Everything this showcase claims, read back off the REAL widget tree. */
function assertUi(ui: Ui, check: ProbeCheck): Record<string, unknown> {
    // 0. The build recipe held. `react-reconciler` picks its bundle from
    //    `process.env.NODE_ENV`, and the DEVELOPMENT one reaches for `document`,
    //    `HTMLCanvasElement` and `Path2D` — which makes `--globals auto` inject the
    //    GTK-backed DOM registers and pull gi://Gdk, GdkPixbuf, Pango and PangoCairo
    //    into a bundle that needs none of them. Even the production `scheduler`
    //    carries `typeof navigator !== 'undefined'`, hence `--exclude-globals
    //    navigator`. If either global exists here, the recipe was lost.
    const globals = globalThis as unknown as Record<string, unknown>;
    check('no DOM was injected (the production define held)', typeof globals.document === 'undefined');
    check('no navigator was injected (--exclude-globals held)', typeof globals.navigator === 'undefined');

    const root = ui.container as unknown as Gtk.Widget;
    // Re-read per assertion rather than captured once: the interactions in step 4
    // mint classes that did not exist at first render.
    const sheetDoc = (): string => ui.sheet.toString();
    const at = (id: string): Gtk.Widget => {
        const widget = named(root, id);
        if (widget === null) throw new Error(`no widget with testID "${id}" in:\n${dumpTree(root)}`);
        return widget;
    };

    // -----------------------------------------------------------------------
    // 1. WHICH WIDGETS. Every primitive the layer supports is in this tree, and
    //    each name is a choice L2 made rather than a tag anyone wrote.
    // -----------------------------------------------------------------------
    const census = new Map<string, number>();
    for (const widget of descendants(root)) census.set(typeOf(widget), (census.get(typeOf(widget)) ?? 0) + 1);
    const EXPECTED: Readonly<Record<string, string>> = {
        GtkBox: 'View',
        GtkLabel: 'Text',
        GtkButton: 'Pressable',
        GtkOverlay: 'View whose CHILD is absolutely positioned',
        GtkScrolledWindow: 'ScrollView',
        GtkEntry: 'TextInput',
        GtkSwitch: 'Switch',
        AdwSpinner: 'ActivityIndicator',
    };
    for (const [gtype, primitive] of Object.entries(EXPECTED)) {
        check(`${primitive} became a ${gtype}`, (census.get(gtype) ?? 0) > 0);
    }
    // The negative half, and it is the one that catches a wrong choice: a `View`
    // becomes an overlay ONLY where a child declares `absolute`, and exactly two of
    // the four rows carry a flag.
    check('only the flagged tiles became overlays', census.get('GtkOverlay') === 2);
    check('the multiline widget is absent (no TextInput asked for it)', census.get('GtkTextView') === undefined);

    const screen = at('screen');
    const body = at('body');
    const scroller = at('catalogue');
    check('the scaffold is a Gtk.Box', typeOf(screen) === 'GtkBox');
    check('ScrollView is a Gtk.ScrolledWindow', typeOf(scroller) === 'GtkScrolledWindow');
    check('testID reached Gtk.Widget:name on the entry', typeOf(at('filter-field')) === 'GtkEntry');

    // -----------------------------------------------------------------------
    // 2. THE PROPERTY HALF of the vocabulary — roughly two thirds of it, and none of
    //    it visible in the generated CSS.
    // -----------------------------------------------------------------------
    check('flex-col reached GTK as an orientation', (screen as Gtk.Box).orientation === Gtk.Orientation.VERTICAL);
    check('flex-row reached GTK as an orientation', (body as Gtk.Box).orientation === Gtk.Orientation.HORIZONTAL);

    const header = at('header') as Gtk.Box;
    check(
        'items-center became valign on EVERY child of the row (the cross axis of a row)',
        gtkChildren(header).every((child) => child.valign === Gtk.Align.CENTER),
    );

    const spacer = at('header-spacer');
    check('flex-1 became hexpand against the parent row', spacer.hexpand);
    // The other half of ADR 0032 § 5's union rule: a node this layer gives NO class
    // never touches `css-classes`, so GTK's own orientation class is all there is.
    check(
        'an unstyled node keeps only the class GTK itself put there',
        JSON.stringify([...spacer.get_css_classes()]) === JSON.stringify(['vertical']),
    );

    const actions = at('actions-atlas');
    check('justify-end became the box’s own halign', actions.halign === Gtk.Align.END);

    const listBox = findDescendant(scroller, (widget) => typeOf(widget) === 'GtkBox') as Gtk.Box | null;
    check('the ScrollView content box is a real Gtk.Box behind the viewport', listBox !== null);
    check('gap-m became Gtk.Box:spacing on the CONTENT node', listBox?.spacing === 12);
    check('flex-1 h-full expanded the scroller on both axes', scroller.hexpand && scroller.vexpand);

    const tile = at('thumb-atlas');
    check('the flagged tile is the overlay', typeOf(tile) === 'GtkOverlay');
    check('w-thumb / h-thumb became size requests', tile.widthRequest === 48 && tile.heightRequest === 48);
    check('overflow-hidden became Gtk.Widget:overflow', tile.overflow === Gtk.Overflow.HIDDEN);
    check(
        'orientation moved INTO the overlay’s content box, where the box lives',
        ((tile as Gtk.Overlay).get_child() as Gtk.Box | null)?.orientation === Gtk.Orientation.VERTICAL,
    );

    const flag = at('thumb-atlas-flag');
    check(
        'an absolute child is pinned by ALIGNMENT, derived from which edges were given',
        flag.halign === Gtk.Align.END && flag.valign === Gtk.Align.START,
    );
    check('top-2xs became the widget property margin-top', flag.marginTop === 2);
    check(
        'the absolute child sits in the overlay slot, not in the content box',
        gtkChildren(tile).includes(flag) && (tile as Gtk.Overlay).get_child() !== flag,
    );

    const summary = at('summary-atlas') as Gtk.Label;
    check('Text wraps by default, against Gtk.Label’s own default', summary.wrap);
    check(
        'numberOfLines carries the two companions it needs to do anything',
        summary.lines === 2 && summary.ellipsize === Pango.EllipsizeMode.END && summary.wrap,
    );

    const note = at('status-note') as Gtk.Label;
    check(
        'text-center became xalign AND justify, because one of them is not enough',
        note.xalign === 0.5 && note.justify === Gtk.Justification.CENTER,
    );

    check('disabled became sensitive: false', !at('apply-button').sensitive);
    check('animating became visible on the spinner, both ways', at('busy-on').visible && !at('busy-query').visible);
    check(
        'a placeholder reached Gtk.Entry:placeholder-text',
        (at('filter-field') as Gtk.Entry).placeholderText === 'Search',
    );

    // -----------------------------------------------------------------------
    // 3. THE PAINT HALF — the class that landed, and the rule behind it.
    // -----------------------------------------------------------------------
    const overStyled = descendants(root).filter((widget) => generated(widget).length > 1);
    check('no node carries more than one generated class', overStyled.length === 0);

    const open = at('open-atlas');
    const openClass = generated(open)[0] ?? '';
    check('the primary button carries exactly one generated class', openClass !== '');
    check(
        'the table’s own `flat` class survived the whole-list css-classes write',
        [...open.get_css_classes()].includes('flat'),
    );
    const openRule = ruleFor(sheetDoc(), openClass);
    check(
        'the button’s rule carries the paint half of its class list',
        openRule.includes('background-color: rgb(53 132 228)') && openRule.includes('border-radius: 8px'),
    );
    check(
        'active: became a GTK CSS :active rule on the SAME class',
        ruleFor(sheetDoc(), openClass, ':active').includes('opacity: 0.7'),
    );
    check('the pressed state is CSS only — no opacity property on the widget', open.opacity === 1);

    check(
        'GTK’s own orientation class is unioned in front of the generated one',
        [...(at('card-atlas') as Gtk.Box).get_css_classes()].includes('vertical'),
    );

    const cardRule = ruleFor(sheetDoc(), generated(at('card-atlas'))[0] ?? '');
    check(
        'the card’s rule carries border width, border colour, radius and padding',
        cardRule.includes('border-width: 1px') &&
            cardRule.includes('border-color: rgb(222 221 218)') &&
            cardRule.includes('border-radius: 12px') &&
            cardRule.includes('padding-top: 12px'),
    );

    // The physical/logical margin split, from the side a reader never expects:
    // `right-*` on an absolute child becomes CSS because GTK CSS has no logical
    // margin, while `top-*` became the widget property above. One utility family,
    // two channels, and the reason is measured rather than chosen.
    check(
        'right-2xs on an absolute child became a CSS margin, not a widget property',
        ruleFor(sheetDoc(), generated(flag)[0] ?? '').includes('margin-right: 2px'),
    );

    const captionRule = ruleFor(sheetDoc(), generated(at('status-note'))[0] ?? '');
    check(
        'a caption’s colour, size and opacity are all in one rule',
        captionRule.includes('color: rgb(119 118 123)') &&
            captionRule.includes('font-size: 11px') &&
            captionRule.includes('opacity: 0.8'),
    );

    const filledRule = ruleFor(sheetDoc(), generated(at('rule-filled'))[0] ?? '');
    check(
        'a filled hairline is ONE declaration, the rest being widget properties',
        filledRule === 'background-color: rgb(222 221 218);',
    );
    check('h-hairline became a height request', at('rule-filled').heightRequest === 1);
    check(
        'w-full became hexpand rather than a width request',
        at('rule-filled').hexpand && at('rule-filled').widthRequest === -1,
    );

    // The border-drawn rule, and the gap it exposes. L1 routes `border-t` faithfully
    // — the declaration is in the document — and GTK draws nothing, because
    // `border-style` has no utility in this vocabulary and GTK's initial value is
    // `none`, which zeroes the width. Asserted as the CONTRACT (the declaration
    // landed) and REPORTED as the behaviour (`ruleHeightPx` below), rather than
    // pinned as a passing check: a check that blesses the gap would go red the day
    // it is closed.
    check(
        'border-t landed as a border-top-width declaration',
        ruleFor(sheetDoc(), generated(at('rule-border'))[0] ?? '').includes('border-top-width: 1px'),
    );

    // -----------------------------------------------------------------------
    // 4. THE RETURN PATH. Three GTK-side events, three different kinds of update,
    //    each EMITTED ON GTK'S SIDE rather than by calling the closure — calling it
    //    would prove only that the closure exists.
    // -----------------------------------------------------------------------
    const cards = (): string[] =>
        descendants(root)
            .map((widget) => widget.get_name())
            .filter((name) => name.startsWith('card-'));
    check('every row rendered', cards().length === 4);
    check('no callback fired from rendering alone', fired.length === 0);

    // a. `clicked` → a class swap on two widgets AND a shorter keyed list.
    const chipAll = at('chip-all');
    const chipDone = at('chip-done');
    const selectedClass = generated(chipAll)[0] ?? '';
    const ledgerBefore = at('card-ledger');
    (chipDone as Gtk.Button).emit('clicked');
    check('a Gtk.Button::clicked reached onPress', fired.includes('section:done'));
    // React's default lane hands the work to `scheduler`, which under GJS is a GLib
    // timer source — so the tree is still the old one the instant the signal returns.
    // A `render()` that had quietly become synchronous fails THIS assertion, which is
    // what makes it a claim about the lane rather than about the handler.
    check('the tree is unpatched the instant the signal returns (default lane)', cards().length === 4);
    check(
        'the main context flushed the scheduled render',
        pump(() => cards().length === 2),
    );
    check(
        'the rows GTK holds are the ones that survived, in order',
        JSON.stringify(cards()) === JSON.stringify(['card-ledger', 'card-quarry']),
    );
    // A keyed list must MOVE a row, not re-create it: order alone is satisfied by
    // remove-all-and-re-append, which destroys focus and scroll position.
    check('the surviving row is the SAME widget, not a re-created one', at('card-ledger') === ledgerBefore);

    // The class swap itself — the write that cannot go through `set_property` at all,
    // because `Gtk.Widget:css-classes` is a `GStrv` and GJS builds a GValue by
    // guessing a GType from the JS value (see `writeProperty` in gtk-host's host.ts).
    check('the deselected chip minted a different class', generated(chipAll)[0] !== selectedClass);
    check(
        'the selected chip paints with the accent fill',
        ruleFor(sheetDoc(), generated(chipDone)[0] ?? '').includes('background-color: rgb(53 132 228)'),
    );
    check(
        'the deselected chip paints with the surface fill',
        ruleFor(sheetDoc(), generated(chipAll)[0] ?? '').includes('background-color: rgb(255 255 255)'),
    );
    check(
        'a class swap left the classes GTK and the table own alone',
        [...chipDone.get_css_classes()].includes('flat'),
    );
    check(
        'a styled node whose only change is its text was patched through the sink',
        (at('status-note') as Gtk.Label).label === '2 of 4 shown',
    );

    // b. `notify::text` → the same list from the other front end.
    const entry = at('filter-field') as Gtk.Entry;
    entry.text = 'quarry';
    check('notify::text reached onChangeText with the widget’s own text', fired.includes('query:quarry'));
    // ONE report for one write, which is the whole reason the route binds
    // `notify::text` rather than `Gtk.Editable::changed`: `gtk_editable_set_text` is a
    // delete followed by an insert, so `changed` reports `["", "quarry"]` for this
    // same assignment — and a controlled field reads that intermediate empty string
    // as the user clearing it.
    check('one write produced exactly one report', fired.filter((event) => event.startsWith('query:')).length === 1);
    check(
        'the query narrowed the list further',
        pump(() => JSON.stringify(cards()) === JSON.stringify(['card-quarry'])),
    );
    check('animating followed the query', at('busy-query').visible);

    // c. `notify::active` → one widget PROPERTY, which no class swap could fake.
    const toggle = at('dense-switch') as Gtk.Switch;
    toggle.active = true;
    check('notify::active reached onValueChange WITH the new value', fired.includes('dense:true'));
    check(
        'gap-s re-spaced the content box — a property patch, not a class one',
        pump(() => listBox?.spacing === 8),
    );

    // -----------------------------------------------------------------------
    // 5. Reported rather than asserted: what GTK does with the two rule spellings.
    // -----------------------------------------------------------------------
    const heightOf = (widget: Gtk.Widget): number => widget.measure(Gtk.Orientation.VERTICAL, -1)[0];

    return {
        widgets: Object.fromEntries([...census.entries()].sort()),
        rules: ui.sheet.size,
        ruleHeightPx: { filled: heightOf(at('rule-filled')), border: heightOf(at('rule-border')) },
        rows: cards().length,
        fired,
        tree: dumpTree(root).split('\n').length,
    };
}

await runHostProbeApp<Ui>({
    applicationId: 'eu.jumplink.RnDesignSystem',
    // Ignores the application on purpose, and so does the harness — it always probes
    // headless. Building an `Adw.ApplicationWindow` with `application: app` inside
    // `activate` is the neighbourhood of the segfault recorded on `runHostProbeApp`.
    build: () => buildUi(null),
    assert: assertUi,
    // BEFORE the harness counts diagnostics, which is the point of the hook:
    // `unmount` releases what React owns, `destroy` is what unparenting cannot
    // reach, and a finalize-time `still has children left` is exactly the class that
    // appears nowhere else.
    teardown: (ui) => {
        ui.root.unmount();
        ui.window.destroy();
    },
    present: (ui) => ui.window.present(),
});
