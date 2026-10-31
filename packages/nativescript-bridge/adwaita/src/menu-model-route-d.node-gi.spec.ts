// ROUTE D OFF A DEVICE: `menu-model` on the two widgets that declare it, with the port's store
// replaced by real GObject through `@gjsify/node-gi` (ADR 0105 stage 2, ADR 0128).
//
// WHY THIS LEG EXISTS AT ALL. Route D — a declared property whose accessors are node-gi's, over a
// GType registered on a FOREIGN NativeScript parent — had no harness anywhere but the Android
// device run. `./menu-button-properties.spec.ts` and `./menu-model-door.spec.ts` drive the same
// vectors on the pure-JS engine and pass, by construction: the seam's own accessors answer there
// and `registerRouteD` never runs. So the one path that can break was measured only by plugging
// in a phone, and it DID break — `Gtk.MenuButton` reached the device with
// `resolved.giConnect === undefined`, five red cases, and nothing off-device to show it. This
// file is that missing harness: the same widgets, the same engine, no phone. It runs under
// `node --conditions=gjsify-foreign-parents` — see `./test.node-gi.mts` for why the capability is
// off by default on a Node host and what the condition selects.
//
// `Gtk.MenuButton` is the subject and `Adw.SplitButton` is the control. Both declare
// `menu-model` over the same slot (`widgets/menu-slot.ts`), and they differ in exactly the thing
// route D is sensitive to: the menu button's declaration is `withProperties` over
// `AdwImageButton`, whose own `withSignals(GridLayout)` passed NO meta, while the split button's
// is `withSignals` WITH meta. A leg that drove only one of them would have stayed green.
//
// THE COUNTS ARE THE MEASURED ONES and they are the device spec's, not a second set:
// `tests/integration/nativescript-gi/app/specs/menu-button.ts` and `specs/split-button.ts` run
// these cases on the phone. Same vectors on both legs, so a difference is a defect in whichever
// engine disagrees.

import { describe, expect, it } from '@gjsify/unit';
import { buildMenu } from '@gjsify/adwaita-core';

import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';
import * as GObject from './namespace/gobject.js';

/** The `_`- and `-`-spellings a declared property also answers; TS only knows the camelCase one. */
const loose = (widget: object): Record<string, unknown> => widget as unknown as Record<string, unknown>;

/** How many rows the slot currently holds — the popup the model built. */
const rowsOf = (button: Gtk.MenuButton | Adw.SplitButton): number =>
    (loose(button)._slot as { tree: readonly unknown[] }).tree.length;

/** Count every `notify::menu-model` a widget emits — through node-gi's `connect` on this leg. */
function watch(button: Gtk.MenuButton | Adw.SplitButton): () => number {
    let seen = 0;
    button.connect('notify::menu-model', () => seen++);
    return () => seen;
}

export const MenuModelRouteDNodeGiTest = async () => {
    await describe('the engine this leg runs on', async () => {
        await it("is real GObject, so these cases are route D and not the seam's own accessors", () => {
            // Asserted FIRST and in its own case, because every claim below is worthless if the
            // opt-in in `./test.node-gi.mts` lost its race with the port's module body: the
            // vectors would then run on the pure-JS engine and pass, and this file would report
            // success for a measurement that never happened. The same no-silent-fallback rule
            // `app/specs/engine.ts` asserts on the device.
            expect(GObject.engineName).toBe('real-gio');
        });
    });

    await describe('Gtk.MenuButton:menu-model over real GObject (route D)', async () => {
        await it('registers the pspec on its own GType, over a foreign NativeScript parent', () => {
            // `withProperties(AdwImageButton, …)` — the first declared property in that chain, so
            // this is the first GType route D registers over a base `withSignals` left meta-less.
            const button = new Gtk.MenuButton();
            expect(typeof loose(Gtk.MenuButton).$gtype).toBe('object');
            expect(loose(button).$typeName).toBe('GtkMenuButton');
        });

        await it('starts null and holds the model BY IDENTITY, in all three spellings', () => {
            const button = new Gtk.MenuButton();
            expect(button.menuModel).toBe(null);
            const model = buildMenu(['About', 'Quit']);
            button.menuModel = model;
            expect(loose(button)['menu-model'] === model).toBe(true);
            expect(loose(button).menu_model === model).toBe(true);
            expect(button.menuModel === model).toBe(true);
        });

        await it('notifies on EVERY write, the equal ones included', () => {
            // `changed: () => true`. Measured on GTK 4.22: 1 notify for A, for A again, for B,
            // for null and for null over null — `Gtk.MenuButton` keeps no identity guard.
            const button = new Gtk.MenuButton();
            const seen = watch(button);
            const a = buildMenu(['About']);
            button.menuModel = a;
            button.menuModel = a;
            button.menuModel = buildMenu(['Quit']);
            button.menuModel = null;
            button.menuModel = null;
            expect(seen()).toBe(5);
        });

        await it('a fresh widget notifies for null too — no first-write exception', () => {
            const button = new Gtk.MenuButton();
            const seen = watch(button);
            button.menuModel = null;
            expect(seen()).toBe(1);
        });

        await it('the GIR verbs survived the migration and go through the declaration', () => {
            const button = new Gtk.MenuButton();
            const seen = watch(button);
            const model = buildMenu(['About']);
            button.set_menu_model(model);
            expect(button.get_menu_model() === model).toBe(true);
            expect(button.menuModel === model).toBe(true);
            expect(seen()).toBe(1);
        });

        await it('builds the popup from the model, and re-snapshots a mutation silently', () => {
            const button = new Gtk.MenuButton();
            const model = buildMenu(['About']);
            button.menuModel = model;
            expect(rowsOf(button)).toBe(1);
            const seen = watch(button);
            model.append('Quit');
            expect(rowsOf(button)).toBe(2);
            expect(seen()).toBe(0);
        });

        await it('stops watching a model it no longer holds', () => {
            const button = new Gtk.MenuButton();
            const dropped = buildMenu(['About']);
            button.menuModel = dropped;
            button.menuModel = buildMenu(['Quit']);
            dropped.append('Stale');
            expect(rowsOf(button)).toBe(1);
        });

        await it('refuses a string and a non-model, and shuts the NativeScript door', () => {
            // The last assertion is the one route D owns on its own: `refuseDeclaredNotifyPayload`
            // has to be installed over NODE-GI's `notify`, not just over the host's, or a declared
            // property stays reachable through the NativeScript event door on this leg only.
            const button = new Gtk.MenuButton();
            expect(() => (loose(button).menuModel = 'app-menu')).toThrow();
            expect(() => (loose(button)['menu-model'] = {})).toThrow();
            expect(button.menuModel).toBe(null);
            expect(() => button.notify({ eventName: 'notify::menu-model', object: button as never })).toThrow();
        });
    });

    await describe('Adw.SplitButton:menu-model over real GObject — the control twin', async () => {
        await it('notifies on a CHANGE only, where the menu button notifies always', () => {
            // The declaration that has worked on the device all along (`withSignals` WITH meta),
            // here so a fix to the menu button's path cannot quietly move this one: measured
            // 1,0,1,1,0 for A, A, B, null, null.
            const button = new Adw.SplitButton({ label: 'Save' });
            const seen = watch(button);
            const a = buildMenu(['Save as…']);
            button.menuModel = a;
            button.menuModel = a;
            button.menuModel = buildMenu(['Export', 'Print']);
            button.menuModel = null;
            button.menuModel = null;
            expect(seen()).toBe(3);
        });

        await it('notifies LAST, so a handler sees the dropdown already rebuilt', () => {
            // `explicitNotify: true` (pspec flags=1073742051, G_PARAM_EXPLICIT_NOTIFY). On route D
            // the emission is node-gi's, so the ORDER is the one thing the engine swap could move.
            const button = new Adw.SplitButton({ label: 'Save' });
            const rows: number[] = [];
            button.connect('notify::menu-model', () => rows.push(rowsOf(button)));
            button.menuModel = buildMenu(['Save as…', 'Export']);
            button.menuModel = null;
            expect(rows.join()).toBe('2,0');
        });

        await it('refuses a string and a non-model, and shuts the NativeScript door', () => {
            const button = new Adw.SplitButton();
            expect(() => (loose(button).menuModel = 'app-menu')).toThrow();
            expect(() => (loose(button)['menu-model'] = {})).toThrow();
            expect(button.menuModel).toBe(null);
            expect(() => button.notify({ eventName: 'notify::menu-model', object: button as never })).toThrow();
        });
    });
};

export default MenuModelRouteDNodeGiTest;
