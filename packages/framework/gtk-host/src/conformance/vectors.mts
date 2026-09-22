// ONE vector table, run through EVERY adapter.
//
// `status/status.json` named this gap itself: "The host's own conformance vectors
// do not yet run THROUGH an adapter, so each adapter is held only by its own
// hand-written spec." Measured on those three specs (473 + 501 + 667 lines), the
// coverage matrix had 6 of 30 cells empty, and the empty ones were not exotic:
//
//  - `slot` and `layout`: ZERO hits in all three. They are typed in every surface
//    and asserted at the type level, so the `slotted`, `keyed` and `coords` policy
//    families had no proof of working from a framework at all.
//  - TEXT children: neither `solid.spec.ts` nor `vue.spec.ts` ever created one —
//    every label came from the `label` PROP. So `createTextNode`/`replaceText`/
//    `isTextNode` (Solid) and `createText`/`setText` (Vue) went unexercised
//    through an adapter, and with them the whole `flushText`/`writeTextSink`/
//    `text-not-accepted` path. `<gtk-label>{{ count }}</gtk-label>` is exactly
//    what the Vue SFC compiler emits.
//
// Two measured placement defects slipped between the host's vectors and the
// adapters' specs, which is what a per-framework spec cannot catch by
// construction: it agrees with the framework it was written against.
//
// `.mts` ON PURPOSE, and it is a hard constraint rather than a style. This module
// imports `@gjsify/unit`, a devDependency; the library build globs
// `src/**/*.{ts,js}`, so a `.mts` file never reaches `lib/esm/` and can never be
// pulled into a published subpath. A `vectors.ts` here would be built into
// `lib/esm/conformance/vectors.js` with an unresolvable `@gjsify/unit` edge in it.
//
// WHAT THE SEAM DELIBERATELY DOES NOT COVER: tree-SHAPE changes. `patch` re-renders
// the same shape with new props and new text, because that is the one update every
// framework can express identically. Shape reconciliation — `v-if`, `<For>`, a keyed
// reorder — is each framework's own semantics and each spec already measures it
// there, with the identity assertions that only make sense per framework.

import { expect, it } from '@gjsify/unit';

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import { gated } from '../testing/gate.mjs';
import type { DiagnosticsGate } from './diagnostics.js';
import { withAtContext } from './at-context.js';
import { findDescendant, gtkChildren } from './index.js';

/** A tree in the one shape all three adapters can build: tag, props, children. */
export interface VectorElement {
    readonly tag: string;
    readonly props?: Record<string, unknown>;
    /** A string child is a TEXT NODE — never a bulk `setElementText` write. */
    readonly children?: readonly VectorNode[];
}

export type VectorNode = string | VectorElement;

/** `h('GtkBox', { spacing: 6 }, h('GtkLabel', null, 'hi'))`. */
export const h = (tag: string, props?: Record<string, unknown> | null, ...children: VectorNode[]): VectorElement => ({
    tag,
    props: props ?? undefined,
    children,
});

export interface VectorMount {
    /**
     * Re-render the SAME tree shape with new props and new text, flushed — Vue's
     * `nextTick`, React's `flushSync`, Solid's synchronous effects.
     */
    patch(tree: VectorElement): Promise<void>;
    unmount(): void;
}

export interface VectorHarness {
    /** Names the describe block, so a failure says which adapter. */
    readonly framework: string;
    /** Mount `tree` into a container the application owns, flushed on return. */
    mount(container: Gtk.Widget, tree: VectorElement): Promise<VectorMount>;
}

/** The single child GTK actually holds, for the containers below that hold one. */
const onlyChild = (widget: Gtk.Widget): Gtk.Widget | undefined => gtkChildren(widget)[0];

/** What the harness threw, or `undefined`. `mount` is async, so `toThrow` cannot see it. */
async function refusalOf(run: () => Promise<unknown>): Promise<string> {
    try {
        await run();
    } catch (error) {
        return String((error as Error).message);
    }
    return '';
}

/**
 * Every vector, against one adapter.
 *
 * `gated` rather than a bare `describe`: `@gjsify/unit` keeps ONE
 * `beforeEach`/`afterEach` slot per module and nulls both when a describe returns,
 * so hooks registered outside the block cover exactly one sibling.
 *
 * CORRECTED 2026-09-04 (#1554): hooks are SCOPED now — one frame per `describe`,
 * popped when it returns — so hooks registered outside the block cover every
 * sibling, and two registrations in one scope both run. `gated` stays because it
 * keeps one declaration of what a gated block means, not because the runner
 * forgets.
 */
export async function runAdapterVectors(harness: VectorHarness, gate: DiagnosticsGate): Promise<void> {
    const { framework, mount } = harness;

    await gated(gate, `conformance vectors through ${framework}`, async () => {
        // --- text children ---------------------------------------------------

        await it('a text child reaches the parent descriptor text sink', async () => {
            const container = new Gtk.Box();
            const handle = await mount(container, h('GtkBox', null, h('GtkLabel', null, 'one')));
            expect((onlyChild(onlyChild(container) as Gtk.Widget) as Gtk.Label).label).toBe('one');
            handle.unmount();
        });

        await it('changing the text child rewrites the sink', async () => {
            const container = new Gtk.Box();
            const handle = await mount(container, h('GtkBox', null, h('GtkLabel', null, 'one')));
            await handle.patch(h('GtkBox', null, h('GtkLabel', null, 'two')));
            expect((onlyChild(onlyChild(container) as Gtk.Widget) as Gtk.Label).label).toBe('two');
            handle.unmount();
        });

        await it('emptying the last text child CLEARS the sink', async () => {
            // The `textFromChildren` flag is the whole point: without it a widget
            // whose text was deleted keeps rendering the old string, and only text
            // children may clear it — never an authored `label` prop.
            const container = new Gtk.Box();
            const handle = await mount(container, h('GtkBox', null, h('GtkLabel', null, 'one')));
            await handle.patch(h('GtkBox', null, h('GtkLabel', null, '')));
            expect((onlyChild(onlyChild(container) as Gtk.Widget) as Gtk.Label).label).toBe('');
            handle.unmount();
        });

        await it('two text children concatenate into one sink', async () => {
            const container = new Gtk.Box();
            const handle = await mount(container, h('GtkBox', null, h('GtkLabel', null, 'a', 'b')));
            expect((onlyChild(onlyChild(container) as Gtk.Widget) as Gtk.Label).label).toBe('ab');
            handle.unmount();
        });

        await it('text in a sink-less container is refused BY TAG NAME', async () => {
            // `GtkBox` has no `textSink`, so the string has nowhere to go. GTK would
            // say nothing at all; the host names the tag and the text.
            const container = new Gtk.Box();
            const said = await refusalOf(() => mount(container, h('GtkBox', null, 'stray')));
            expect(said).toContain('has no text sink');
            expect(said).toContain('GtkBox');
        });

        // --- slot: the CHILD declares where it lands -------------------------

        await it('slot="title" reaches an exact getter', async () => {
            const container = new Gtk.Box();
            const handle = await mount(
                container,
                h('AdwHeaderBar', null, h('GtkLabel', { slot: 'title', label: 'Title' })),
            );
            const bar = onlyChild(container) as Adw.HeaderBar;
            expect((bar.get_title_widget() as Gtk.Label).label).toBe('Title');
            handle.unmount();
        });

        await it('slot="content" places into a setter-backed slot', async () => {
            const container = new Gtk.Box();
            const handle = await mount(
                container,
                h('AdwToolbarView', null, h('AdwPreferencesPage', { slot: 'content' })),
            );
            const view = onlyChild(container) as Adw.ToolbarView;
            expect(view.get_content() instanceof Adw.PreferencesPage).toBe(true);
            handle.unmount();
        });

        await it('slot="top" is not slot="bottom" — asserted as PLACEMENT', async () => {
            // `add_top_bar` is write-only and the height getters read 0 until the
            // window is allocated, which no test allocates. Adwaita's own style class
            // on the revealer it wraps each bar in separates the two slots, and
            // nothing else does: measured, every presence-based assertion passed with
            // the bar authored into `bottom`.
            const container = new Gtk.Box();
            const handle = await mount(container, h('AdwToolbarView', null, h('AdwHeaderBar', { slot: 'top' })));
            const view = onlyChild(container) as Adw.ToolbarView;
            const bar = findDescendant(view, (w) => w instanceof Adw.HeaderBar);
            expect(bar !== null).toBe(true);
            let inTopBar = false;
            for (let w: Gtk.Widget | null = bar; w !== null && w !== view; w = w.get_parent()) {
                if (w.get_css_classes().includes('top-bar')) inTopBar = true;
            }
            expect(inTopBar).toBe(true);
            handle.unmount();
        });

        await it('the split views place BOTH setter slots, and unmount empties them', async () => {
            // The vector that earns `slotted.remove` being optional. These two
            // classes have no remove method of their own — measured on libadwaita
            // 1.9.3, every `remove*` on them is GtkWidget's — so removal can only
            // be the setter written back to null. Asserting the placement without
            // asserting the EMPTYING would leave exactly that half unmeasured, and
            // it is the half the optionality changed.
            for (const tag of ['AdwNavigationSplitView', 'AdwOverlaySplitView'] as const) {
                const container = new Gtk.Box();
                const handle = await mount(
                    container,
                    h(
                        tag,
                        null,
                        h('AdwNavigationPage', { slot: 'sidebar', title: 'Side' }),
                        h('AdwNavigationPage', { slot: 'content', title: 'Main' }),
                    ),
                );
                const view = onlyChild(container) as Adw.NavigationSplitView | Adw.OverlaySplitView;
                expect((view.get_sidebar() as Adw.NavigationPage).title).toBe('Side');
                expect((view.get_content() as Adw.NavigationPage).title).toBe('Main');
                handle.unmount();
                // GTK's own getters, not our shadow tree: the shadow tree would
                // agree with itself whatever the setter did.
                expect(view.get_sidebar()).toBe(null);
                expect(view.get_content()).toBe(null);
            }
        });

        await it('the single-child Adw containers take the child they were refusing', async () => {
            // Curated late: until they were, these came from the GENERATED table
            // and raised `uncurated-placement` for any child, in every JSX dialect
            // this host serves.
            //
            // `AdwClampScrollable` gets a `GtkTextView` and the other two a label,
            // and the difference is the measurement rather than a preference: that
            // class binds its four scroll properties onto whatever child it is
            // given, so a `GtkLabel` produces four `gbinding.c:1301` warnings at
            // exit 0 — which the diagnostics gate around this suite turns into a
            // failure. Using one tag for all three would have meant either a
            // permanently noisy vector or an exemption hiding a real constraint.
            const cases = [
                { tag: 'AdwClamp', child: 'GtkLabel' },
                { tag: 'AdwClampScrollable', child: 'GtkTextView' },
                { tag: 'AdwBreakpointBin', child: 'GtkLabel' },
            ] as const;
            for (const { tag, child } of cases) {
                const container = new Gtk.Box();
                const handle = await mount(container, h(tag, null, h(child, { name: tag })));
                const bin = onlyChild(container) as Adw.Clamp | Adw.ClampScrollable | Adw.BreakpointBin;
                expect((bin.get_child() as Gtk.Widget).name).toBe(tag);
                handle.unmount();
                expect(bin.get_child()).toBe(null);
            }
        });

        await it('an unknown slot names the known ones', async () => {
            const container = new Gtk.Box();
            const said = await refusalOf(() =>
                mount(container, h('AdwHeaderBar', null, h('GtkLabel', { slot: 'middle' }))),
            );
            expect(said).toContain('has no slot "middle"');
            expect(said).toContain('title');
        });

        // --- layout: the coords and keyed families ---------------------------

        await it('layout={{column,row}} reaches a coords container', async () => {
            const container = new Gtk.Box();
            const handle = await mount(
                container,
                h('GtkGrid', null, h('GtkLabel', { label: 'cell', layout: { column: 1, row: 2 } })),
            );
            const grid = onlyChild(container) as Gtk.Grid;
            expect((grid.get_child_at(1, 2) as Gtk.Label)?.label).toBe('cell');
            handle.unmount();
        });

        await it('changing layout MOVES the child instead of doing nothing', async () => {
            // Position data is read at PLACEMENT time only, so a reactive binding
            // that moves a grid cell used to do nothing at all — silently.
            const container = new Gtk.Box();
            const handle = await mount(
                container,
                h('GtkGrid', null, h('GtkLabel', { label: 'cell', layout: { column: 0, row: 0 } })),
            );
            const grid = onlyChild(container) as Gtk.Grid;
            await handle.patch(h('GtkGrid', null, h('GtkLabel', { label: 'cell', layout: { column: 2, row: 3 } })));
            expect(grid.get_child_at(0, 0)).toBe(null);
            expect((grid.get_child_at(2, 3) as Gtk.Label)?.label).toBe('cell');
            handle.unmount();
        });

        await it('layout={{name,title}} reaches a keyed container', async () => {
            const container = new Gtk.Box();
            const handle = await mount(
                container,
                h('GtkStack', null, h('GtkLabel', { label: 'one', layout: { name: 'first', title: 'First' } })),
            );
            const stack = onlyChild(container) as Gtk.Stack;
            expect(stack.get_child_by_name('first') !== null).toBe(true);
            handle.unmount();
        });

        // --- a LIST-valued property, on the update path -----------------------

        await it('changing a list-valued property rewrites it', async () => {
            // Every other patch vector here writes a STRING, an INT or a text node,
            // and that gap hid a total failure: `setProp` wrote every property
            // through `set_property`, which cannot build a `GStrv` GValue out of a JS
            // array. Measured on gjs 1.88.1 —
            //
            //   box.set_property('css-classes', ['a'])  THROW  "Could not guess
            //                                                   unspecified GValue type"
            //   box.cssClasses = ['a']                  OK
            //
            // — and only on an UPDATE, because the first write of any property is
            // buffered and replayed by construction, the one path that works. So a
            // class list could be authored and never changed, which is what every
            // showcase here did, and no adapter spec updated one.
            //
            // `css-classes` is the property every framework binding writes (a class
            // compiler produces nothing else), so one vector on it covers all three
            // adapters — which is the reason it lives in this table rather than in
            // any one of their specs.
            // ASSERTED AS A SET, because GTK does not preserve the authored order
            // across a rewrite: measured on gtk 4.22.4, `['first','shared']` rewritten
            // to `['shared','second']` reads back as `['second','shared']`. The class
            // list is a membership fact to CSS, so ordering it would be asserting a
            // GTK implementation detail — and `horizontal` is dropped because
            // `Gtk.Orientable` adds it with nothing authored.
            const own = (widget: Gtk.Widget): string[] =>
                [...widget.cssClasses].filter((name) => name !== 'horizontal').sort();
            const container = new Gtk.Box();
            const handle = await mount(container, h('GtkBox', { cssClasses: ['first', 'shared'] }));
            const box = onlyChild(container) as Gtk.Box;
            expect(own(box)).toStrictEqual(['first', 'shared']);
            await handle.patch(h('GtkBox', { cssClasses: ['shared', 'second'] }));
            expect(own(box)).toStrictEqual(['second', 'shared']);
            handle.unmount();
        });

        // --- accessibility: the ARIA axis no ParamSpec carries ----------------

        // THE PRESENCE ORACLE IS NOT ENOUGH ON ITS OWN, and that is the reason every
        // vector below lives inside `gated(...)`. `Gtk.test_accessible_has_*` says a slot
        // is SET, never what is in it — and MEASURED on GTK 4.22.5, a write with the wrong
        // GValue type still SETS two of the three slots it was tried on:
        //
        //     update_property([VALUE_NOW], [3])      critical, has_property -> TRUE
        //     update_state([CHECKED], [true])        critical, has_state    -> TRUE
        //     update_property([DESCRIPTION], [5])    critical, has_property -> FALSE
        //
        // So presence alone passes the exact defect this surface exists to refuse. What
        // separates a correct write from a mis-typed one is the SILENCE, which the
        // diagnostics gate around this whole block asserts.

        // …AND THE ORACLE HAS A PRECONDITION, which is the other half of the same point:
        // `has_*` reads the widget's `GtkATContext`, and under `GTK_A11Y=none` there is
        // none — so every write records nothing, every `has_*` answers false, and nothing
        // is logged. `withAtContext` is what makes that say so instead of reading as a
        // marshalling defect in whichever runtime the affected legs share.

        await it('a PROPERTY slot GTK collects as a double takes an integral number', async () => {
            // `3` is the trap in one character: GJS guesses a GValue type from the
            // number's integrality, so an authored 3 in a double slot is `g_value_get_double`
            // failing on a G_TYPE_INT — a critical, and the slot set to nothing readable.
            const container = new Gtk.Box();
            const handle = await mount(container, h('GtkLabel', { accessibility: { 'value-now': 3 } }));
            const label = withAtContext(onlyChild(container) as Gtk.Label);
            expect(Gtk.test_accessible_has_property(label, Gtk.AccessibleProperty.VALUE_NOW)).toBe(true);
            handle.unmount();
        });

        await it('a STATE slot typed by ARIA and not by the widget takes its nick', async () => {
            // `checked` is a `GtkAccessibleTristate`, so the DOM spelling `checked: true` is
            // an int slot handed a boolean. The ARIA table is the only thing that knows —
            // `GtkLabel` has no `checked` property to infer it from, and the two vocabularies
            // disagree here on purpose.
            const container = new Gtk.Box();
            const handle = await mount(container, h('GtkLabel', { accessibility: { checked: 'mixed' } }));
            const label = withAtContext(onlyChild(container) as Gtk.Label);
            expect(Gtk.test_accessible_has_state(label, Gtk.AccessibleState.CHECKED)).toBe(true);
            handle.unmount();
        });

        await it('a name the patch drops is RESET, not left behind', async () => {
            // The half a write-only implementation gets wrong and no presence assertion on
            // the writes would notice: GTK keeps an attribute set per widget, so a slot
            // nobody resets survives every later render of the element that stopped
            // authoring it.
            const container = new Gtk.Box();
            const handle = await mount(container, h('GtkLabel', { accessibility: { description: 'a row', level: 2 } }));
            const label = withAtContext(onlyChild(container) as Gtk.Label);
            expect(Gtk.test_accessible_has_property(label, Gtk.AccessibleProperty.LEVEL)).toBe(true);
            await handle.patch(h('GtkLabel', { accessibility: { description: 'a row' } }));
            expect(Gtk.test_accessible_has_property(label, Gtk.AccessibleProperty.LEVEL)).toBe(false);
            expect(Gtk.test_accessible_has_property(label, Gtk.AccessibleProperty.DESCRIPTION)).toBe(true);
            handle.unmount();
        });

        await it('an unknown accessibility name is refused BY NAME', async () => {
            const container = new Gtk.Box();
            const said = await refusalOf(() => mount(container, h('GtkLabel', { accessibility: { labell: 'typo' } })));
            expect(said).toContain('has no name "labell"');
            expect(said).toContain('GtkLabel');
        });

        await it('a wrong value type is refused instead of dropped at exit 0', async () => {
            const container = new Gtk.Box();
            const said = await refusalOf(() =>
                mount(container, h('GtkLabel', { accessibility: { 'value-now': 'three' } })),
            );
            expect(said).toContain('is typed double');
            expect(said).toContain('GtkLabel');
            // Not vacuous: the same slot takes a number, which the first vector asserts.
        });

        await it('a relation pointing at another widget is refused as the named gap', async () => {
            // GTK has `labelled-by`; this host has no way to NAME the other widget. Declared
            // and refused rather than absent, so the message says whose gap it is.
            const container = new Gtk.Box();
            const said = await refusalOf(() =>
                mount(container, h('GtkLabel', { accessibility: { 'labelled-by': 'other' } })),
            );
            expect(said).toContain('points at ANOTHER widget');
            expect(said).toContain('labelled-by');
        });

        // --- the uncurated refusal, through a framework ----------------------

        await it('an uncurated container refuses a child by name', async () => {
            // The only safety property the UNCURATED majority of the table has, and it
            // had ZERO tests: `grep uncurated-placement` found two throw sites and the
            // constructor. `GtkExpander` is generated-only and really does hold one
            // child, so this is the shape a user hits first — and every plausible
            // guess (`add`, `append`, `set_child`) exists somewhere in GTK, where
            // calling the wrong one is a warning at exit 0.
            const container = new Gtk.Box();
            const said = await refusalOf(() => mount(container, h('GtkExpander', null, h('GtkLabel', { label: 'x' }))));
            expect(said).toContain('GENERATED table');
            expect(said).toContain('GtkExpander');
            // Not vacuous: the CURATED twin of the same shape takes the same child.
            const curated = new Gtk.Box();
            const handle = await mount(curated, h('GtkFrame', null, h('GtkLabel', { label: 'x' })));
            expect((onlyChild(onlyChild(curated) as Gtk.Widget) as Gtk.Label).label).toBe('x');
            handle.unmount();
        });
    });
}
