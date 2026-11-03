// ROUTE D OFF A DEVICE: `Gtk.CheckButton`'s four declared properties and two declared signals,
// with the port's store replaced by real GObject through `@gjsify/node-gi` (ADR 0105 stage 2).
//
// WHY THIS LEG. `./check-button-properties.spec.ts` drives the same vectors on the pure-JS
// engine, where the seam's own accessors answer and `registerRouteD` never runs. The check
// button is `withProperties` over `AdwStyledLayoutBase`, whose own `withSignals(GridLayout)`
// passed NO meta — the "meta-less door" #2488 fixed for `Gtk.MenuButton`, where the first
// declaration over such a base reached the device with no gi verbs. This file keeps the check
// button from regressing the same way, without a phone. The counts are the measured GTK 4.22
// ones; `tests/integration/nativescript-gi/app/specs/check-button.ts` runs them on the device.

import { describe, expect, it } from '@gjsify/unit';

import * as Gtk from './namespace/gtk.js';
import * as GObject from './namespace/gobject.js';

const loose = (widget: object): Record<string, unknown> => widget as unknown as Record<string, unknown>;

const EMISSIONS = [
    'toggled',
    'activate',
    'notify::active',
    'notify::inconsistent',
    'notify::label',
    'notify::use-underline',
];

function watch(check: Gtk.CheckButton): string[] {
    const seen: string[] = [];
    for (const name of EMISSIONS) check.connect(name, () => seen.push(name));
    return seen;
}

export const CheckButtonRouteDNodeGiTest = async () => {
    await describe('the engine this leg runs on', async () => {
        await it('is real GObject, so these cases are route D and not the seam’s own accessors', () => {
            expect(GObject.engineName).toBe('real-gio');
        });
    });

    await describe('Gtk.CheckButton over real GObject (route D)', async () => {
        await it('registers its own GType over a foreign NativeScript parent', () => {
            const check = new Gtk.CheckButton();
            expect(typeof loose(Gtk.CheckButton).$gtype).toBe('object');
            expect(loose(check).$typeName).toBe('GtkCheckButton');
        });

        await it('starts at the defaults, having emitted nothing', () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            expect([check.active, check.inconsistent, check.label, check.useUnderline]).toStrictEqual([
                false,
                false,
                null,
                false,
            ]);
            expect(seen.length).toBe(0);
        });

        await it('active: notify::active, THEN toggled, once per change', () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            check.active = true;
            check.active = true;
            check.active = false;
            expect(seen).toStrictEqual(['notify::active', 'toggled', 'notify::active', 'toggled']);
        });

        await it('active: null → false silently, 1 → true, and a bad string throws', () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            loose(check).active = null;
            expect(seen.length).toBe(0);
            loose(check).active = 1;
            expect(check.active).toBe(true);
            expect(() => (loose(check).active = 'maybe')).toThrow();
        });

        await it('inconsistent and use-underline notify on change only; label on every write', () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            check.inconsistent = true;
            check.inconsistent = true;
            check.useUnderline = true;
            check.useUnderline = true;
            check.label = 'Blue';
            check.label = 'Blue';
            expect(seen).toStrictEqual([
                'notify::inconsistent',
                'notify::use-underline',
                'notify::label',
                'notify::label',
            ]);
        });

        await it("label '' reads back null", () => {
            const check = new Gtk.CheckButton({ label: 'Blue' });
            check.label = '';
            expect(check.label).toBe(null);
        });

        await it('emit("activate") toggles and leaves inconsistent alone; a tap emits no activate', () => {
            const check = new Gtk.CheckButton({ inconsistent: true });
            const seen = watch(check);
            check.emit('activate');
            expect(check.active).toBe(true);
            expect(check.inconsistent).toBe(true);
            expect(seen).toStrictEqual(['notify::active', 'toggled', 'activate']);
            seen.length = 0;
            check.notify({ eventName: 'tap', object: check as never });
            expect(seen).toStrictEqual(['notify::active', 'toggled']);
        });

        await it('a group: the other member goes false first, then this one notifies', () => {
            const [a, b] = [new Gtk.CheckButton(), new Gtk.CheckButton()];
            b.set_group(a);
            a.active = true;
            const log: string[] = [];
            a.connect('notify::active', () => log.push(`a:${a.active}/b:${b.active}`));
            b.connect('notify::active', () => log.push(`b:${b.active}/a:${a.active}`));
            b.active = true;
            expect(log).toStrictEqual(['a:false/b:false', 'b:true/a:false']);
            const seen = watch(b);
            b.emit('activate');
            expect(seen).toStrictEqual(['activate']);
        });

        await it('the GIR verbs go through the declaration, and the NativeScript door is shut', () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            check.set_active(true);
            expect(check.get_active()).toBe(true);
            expect(seen).toStrictEqual(['notify::active', 'toggled']);
            for (const name of ['active', 'inconsistent', 'label', 'use-underline']) {
                expect(() => check.notify({ eventName: `notify::${name}`, object: check as never })).toThrow();
            }
        });
    });
};

export default CheckButtonRouteDNodeGiTest;
