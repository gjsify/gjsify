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

        // --- the uncurated refusal, through a framework ----------------------

        await it('an uncurated container refuses a child by name', async () => {
            // The only safety property 138 of the 164 generated widgets have, and it
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
