// `Gtk.CheckButton` ON A DEVICE (ADR 0105 § 2, route D) — four properties and two signals declared
// with `withProperties` over `AdwStyledLayoutBase`, the meta-less door #2488 fixed for the menu
// button. The vectors are GTK 4.22's, measured in GJS; `check-button-route-d.node-gi.spec.ts` runs
// them off-device on the real-GI engine, `check-button-properties.spec.ts` on the pure-JS one.
//
// Both legs run the same vectors, so a difference is a defect in whichever engine disagrees.
import { Gtk } from '@gjsify/adwaita-nativescript';
import { GestureTypes } from '@nativescript/core';

import { describe, expect, info, it } from '../reporter.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

// A finger reaches the button through the gesture observer `addEventListener('tap')` builds;
// `notify({ eventName: 'tap' })` only walks the Observable map and never gets there on a device.
const tap = (check: Gtk.CheckButton): void => {
    const observers = ((check as Any).getGestureObservers(GestureTypes.tap) ?? []) as Any[];
    for (const observer of observers) {
        observer.callback({ eventName: 'tap', object: check, view: check, type: GestureTypes.tap });
    }
};

const EMISSIONS = [
    'toggled',
    'activate',
    'notify::active',
    'notify::inconsistent',
    'notify::label',
    'notify::use-underline',
];

const watch = (check: Gtk.CheckButton): string[] => {
    const seen: string[] = [];
    for (const name of EMISSIONS) check.connect(name, () => seen.push(name));
    return seen;
};

export const checkButtonSpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    await describe(`Gtk.CheckButton on '${engine}' (ADR 0105 § 2, route D)`, async () => {
        await it('starts at the defaults, having emitted nothing', () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            expect([check.active, check.inconsistent, check.label, check.useUnderline].join()).toBe(
                'false,false,,false',
            );
            expect(check.label).toBe(null);
            expect(seen.length).toBe(0);
        });

        await it('active: notify::active, THEN toggled, once per change', () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            check.active = true;
            check.active = true;
            check.active = false;
            info(`seen=${seen.join('|')}`);
            expect(seen.join()).toBe('notify::active,toggled,notify::active,toggled');
        });

        await it('active: null → false silently, 1 → true, a bad string throws', () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            (check as Any).active = null;
            expect(seen.length).toBe(0);
            (check as Any).active = 1;
            expect(check.active).toBe(true);
            expect(() => ((check as Any).active = 'maybe')).toThrow();
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
            expect(seen.join()).toBe('notify::inconsistent,notify::use-underline,notify::label,notify::label');
        });

        await it("label '' reads back null", () => {
            const check = new Gtk.CheckButton({ label: 'Blue' });
            check.label = '';
            expect(check.label).toBe(null);
        });

        await it('a tap emits no activate; emit("activate") toggles; neither clears inconsistent', () => {
            const check = new Gtk.CheckButton({ inconsistent: true });
            const seen = watch(check);
            tap(check);
            expect(seen.join()).toBe('notify::active,toggled');
            seen.length = 0;
            check.emit('activate');
            expect(seen.join()).toBe('notify::active,toggled,activate');
            expect(check.inconsistent).toBe(true);
        });

        await it('a group: the other member goes false first; activate on the active member only emits activate', () => {
            const [a, b] = [new Gtk.CheckButton(), new Gtk.CheckButton()];
            b.set_group(a);
            a.active = true;
            const log: string[] = [];
            a.connect('notify::active', () => log.push(`a:${a.active}/b:${b.active}`));
            b.connect('notify::active', () => log.push(`b:${b.active}/a:${a.active}`));
            b.active = true;
            expect(log.join()).toBe('a:false/b:false,b:true/a:false');
            const seen = watch(b);
            b.emit('activate');
            expect(seen.join()).toBe('activate');
        });

        await it('the GIR verbs go through the declaration, and the NativeScript door is shut', () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            check.set_active(true);
            expect(check.get_active()).toBe(true);
            expect(seen.join()).toBe('notify::active,toggled');
            expect(() => check.notify({ eventName: 'notify::active', object: check as never })).toThrow();
        });
    });
};
