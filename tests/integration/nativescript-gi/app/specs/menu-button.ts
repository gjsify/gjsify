// `Gtk.MenuButton:menu-model` ON A DEVICE (ADR 0105 § 2, route D) — the TWIN of the `menu-model`
// block in `specs/split-button.ts`.
//
// The two widgets share one slot (`widgets/menu-slot.ts`) behind two declarations that differ in
// exactly one hook: `changed: () => true` here, because `Gtk.MenuButton` has NO identity guard
// (measured: it notifies on EVERY write, the equal ones and `null` over `null` included) where
// `Adw.SplitButton` does. A copy that drifts is only caught if both are driven, so both are.
//
// `Gtk.MenuButton` is also the first declared property in the `AdwImageButton` chain, which is why
// its migration is `withProperties` over a base that `withSignals` already covered — and why the
// case below checks that the GType really carries the pspec on this leg.
//
// Both legs run the same vectors, so a difference is a defect in whichever engine disagrees.
import { Gtk } from '@gjsify/adwaita-nativescript';
import { buildMenu } from '@gjsify/adwaita-core';

import { describe, expect, info, it } from '../reporter.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** How many rows the slot currently holds — the popover the model built. */
const rowsOf = (button: Gtk.MenuButton): number => (button as Any)._slot.tree.length;

export const menuButtonSpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    await describe(`Gtk.MenuButton:menu-model on '${engine}' (ADR 0105 § 2, route D)`, async () => {
        await it('starts null and holds the model BY IDENTITY, in all three spellings', () => {
            const button = new Gtk.MenuButton();
            expect(button.menuModel).toBe(null);
            const model = buildMenu(['About', 'Quit']);
            button.menuModel = model;
            expect((button as Any)['menu-model'] === model).toBe(true);
            expect((button as Any).menu_model === model).toBe(true);
            expect(button.menuModel === model).toBe(true);
        });

        await it('notifies on EVERY write, the equal ones included', () => {
            // `changed: () => true`. Measured on GTK 4.22: 1 notify for A, for A again, for B,
            // for null, and for null over null — `Gtk.MenuButton` keeps no identity guard. The
            // seam would otherwise swallow the repeats, since it compares against the held value.
            const button = new Gtk.MenuButton();
            const seen: string[] = [];
            button.connect('notify::menu-model', () => seen.push('menu-model'));
            const a = buildMenu(['About']);
            button.menuModel = a;
            button.menuModel = a;
            button.menuModel = buildMenu(['Quit']);
            button.menuModel = null;
            button.menuModel = null;
            info(`seen=${seen.length}`);
            expect(seen.length).toBe(5);
        });

        await it('a fresh widget notifies for null too — no first-write exception', () => {
            // The same measurement at the other end: writing the DEFAULT to a widget that has
            // never held a model still notifies here, where `Adw.SplitButton` stays silent.
            const button = new Gtk.MenuButton();
            let seen = 0;
            button.connect('notify::menu-model', () => seen++);
            button.menuModel = null;
            expect(seen).toBe(1);
        });

        await it('the GIR verbs survived the migration and go through the declaration', () => {
            const button = new Gtk.MenuButton();
            let seen = 0;
            button.connect('notify::menu-model', () => seen++);
            const model = buildMenu(['About']);
            button.set_menu_model(model);
            expect(button.get_menu_model() === model).toBe(true);
            expect(button.menuModel === model).toBe(true);
            expect(seen).toBe(1);
        });

        await it('builds the popover from the model, and re-snapshots a mutation silently', () => {
            const button = new Gtk.MenuButton();
            const model = buildMenu(['About']);
            button.menuModel = model;
            expect(rowsOf(button)).toBe(1);
            let seen = 0;
            button.connect('notify::menu-model', () => seen++);
            model.append('Quit');
            expect(rowsOf(button)).toBe(2);
            expect(seen).toBe(0);
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
            const button = new Gtk.MenuButton();
            expect(() => ((button as Any).menuModel = 'app-menu')).toThrow();
            expect(() => ((button as Any)['menu-model'] = {})).toThrow();
            expect(button.menuModel).toBe(null);
            expect(() => (button as Any).notify({ eventName: 'notify::menu-model', object: button })).toThrow();
        });
    });
};

export default menuButtonSpec;
