// ROUTE D OFF A DEVICE: `Adw.TabView`'s declared `selected-page` property, with the port's
// store replaced by real GObject through `@gjsify/node-gi` (ADR 0105 stage 2).
//
// `AdwTabView` is `withSignals(GridLayout, …)` — a declared base in one step, because
// `GridLayout` itself carries no declaration. `tests/integration/nativescript-gi/app/specs/adw-tab-view.ts`
// runs the same vectors on the device.
//
// MEASURED ON REAL LIBADWAITA 1.9.4 (the `measureReal` leg below re-measures the behavior
// that decided the port):
//   - appending the FIRST page emits `notify::selected-page`; appending a later one emits nothing.
//   - `set_selected_page` to another page emits it once.
//   - a repeated `set_selected_page` emits nothing.
//   - closing the selected page emits it once (the successor), and closing the last page emits it
//     once more, leaving `selected-page` null.
//
// `@gjsify/node-gi` is named only in `./test.node-gi.mts`, which hands `requireGi` to this factory.

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';
import * as GObject from './namespace/gobject.js';

const loose = (widget: object): Record<string, unknown> => widget as unknown as Record<string, unknown>;

const SELECTED = 'notify::selected-page';

function watch(view: Adw.TabView): string[] {
    const seen: string[] = [];
    view.connect(SELECTED, () => seen.push(SELECTED));
    return seen;
}

/** What the real-Adw child process measured. */
export interface RealAdwTabViewMeasurement {
    readonly addFirst: string[];
    readonly addSecond: string[];
    readonly setPage: string[];
    readonly repeated: string[];
    readonly closeSelected: string[];
    readonly closeLast: { readonly seen: string[]; readonly after: boolean };
}

/**
 * Runs the real-Adw measurement and returns what it saw. It is handed in, not done here: real
 * `Adw.TabView` and the port's `AdwTabView` both want the GType name `AdwTabView`, so the two
 * cannot share a process (`a GType named 'AdwTabView' is already registered`). The host entry
 * runs it in a child node process.
 */
export type RealAdwTabViewMeasurementFn = () => RealAdwTabViewMeasurement;

export const createAdwTabViewRouteDNodeGiTest = (measureReal: RealAdwTabViewMeasurementFn) => async () => {
    await describe('the engine this leg runs on', async () => {
        await it('is real GObject, so these cases are route D and not the seam’s own accessors', () => {
            expect(GObject.engineName).toBe('real-gio');
        });
    });

    await describe('a REAL Adw.TabView (the measurement behind the port)', async () => {
        await it('emits notify::selected-page once per selection move and nothing on repeats', () => {
            const measured = measureReal();
            expect(measured.addFirst).toStrictEqual([SELECTED]);
            expect(measured.addSecond).toStrictEqual([]);
            expect(measured.setPage).toStrictEqual([SELECTED]);
            expect(measured.repeated).toStrictEqual([]);
            expect(measured.closeSelected).toStrictEqual([SELECTED]);
            expect(measured.closeLast.seen).toStrictEqual([SELECTED]);
            expect(measured.closeLast.after).toBe(true);
        });
    });

    await describe('Adw.TabView over real GObject (route D)', async () => {
        await it('registers its own GType over a foreign NativeScript parent', () => {
            const view = new Adw.TabView();
            expect(typeof loose(Adw.TabView).$gtype).toBe('object');
            expect(loose(view).$typeName).toBe('AdwTabView');
        });

        await it('starts empty, having emitted nothing', () => {
            const view = new Adw.TabView();
            const seen = watch(view);
            expect(view.selectedPage).toBe(null);
            expect(seen.length).toBe(0);
        });

        await it('appending the first page selects it and emits once; a later page emits nothing', () => {
            const view = new Adw.TabView();
            const seen = watch(view);
            view.append({ id: 'one', content: new Gtk.Label() });
            expect(seen).toStrictEqual([SELECTED]);
            expect(view.selectedPage?.id).toBe('one');
            view.append({ id: 'two', content: new Gtk.Label() });
            expect(seen).toStrictEqual([SELECTED]);
        });

        await it('selected-page selects by page and emits once', () => {
            const view = new Adw.TabView();
            view.append({ id: 'one', content: new Gtk.Label() });
            view.append({ id: 'two', content: new Gtk.Label() });
            const seen = watch(view);
            view.selectedPage = view.pages[1]!;
            expect(seen).toStrictEqual([SELECTED]);
            expect(view.selectedPage?.id).toBe('two');
        });

        await it('selected-page also takes the page id, the one spelling an XML attribute carries', () => {
            const view = new Adw.TabView();
            view.append({ id: 'one', content: new Gtk.Label() });
            view.append({ id: 'two', content: new Gtk.Label() });
            const seen = watch(view);
            (loose(view) as { selectedPage: unknown }).selectedPage = 'two';
            expect(seen).toStrictEqual([SELECTED]);
            expect(view.selectedPage?.id).toBe('two');
        });

        await it('repeated writes emit nothing', () => {
            const view = new Adw.TabView();
            view.append({ id: 'one', content: new Gtk.Label() });
            view.append({ id: 'two', content: new Gtk.Label() });
            view.selectedPage = view.pages[1]!;
            const seen = watch(view);
            view.selectedPage = view.pages[1]!;
            view.set_selected_page('two');
            expect(seen).toStrictEqual([]);
        });

        await it('closing the selected page emits once for the successor, and once more for the last page', () => {
            const view = new Adw.TabView();
            view.append({ id: 'one', content: new Gtk.Label() });
            view.append({ id: 'two', content: new Gtk.Label() });
            view.selectedPage = view.pages[0]!;
            const seen = watch(view);
            view.close_page('one');
            expect(seen).toStrictEqual([SELECTED]);
            expect(view.selectedPage?.id).toBe('two');
            view.close_page('two');
            expect(seen).toStrictEqual([SELECTED, SELECTED]);
            expect(view.selectedPage).toBe(null);
        });

        await it('select_next_page / select_previous_page move the property and notify through it', () => {
            const view = new Adw.TabView();
            view.append({ id: 'one', content: new Gtk.Label() });
            view.append({ id: 'two', content: new Gtk.Label() });
            const seen = watch(view);
            view.select_next_page();
            expect(view.selectedPage?.id).toBe('two');
            view.select_previous_page();
            expect(view.selectedPage?.id).toBe('one');
            expect(seen).toStrictEqual([SELECTED, SELECTED]);
        });
    });
};

export default createAdwTabViewRouteDNodeGiTest;
