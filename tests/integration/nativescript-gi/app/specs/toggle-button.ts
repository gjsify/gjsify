// `Gtk.ToggleButton` ON A DEVICE (ADR 0105 § 2, route D) — `active` and `toggled` declared with
// `withProperties` over `GtkButton`, a base that is itself declared (`clicked`). The vectors are
// GTK 4.22's, measured on real Gtk; `toggle-button-route-d.node-gi.spec.ts` runs them off-device
// on the real-GI engine, `gtk-toggle-button.spec.ts` on the pure-JS one.
//
// Two measurements differ from what one would guess: `toggled` comes BEFORE `notify::active`, and
// `notify::group` is never emitted at all.
import { Gtk } from '@gjsify/adwaita-nativescript';
import { GestureTypes } from '@nativescript/core';

import { describe, expect, info, it } from '../reporter.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

// A finger reaches the button through the gesture observer `addEventListener('tap')` builds;
// `notify({ eventName: 'tap' })` only walks the Observable map and never gets there on a device.
const tap = (button: Gtk.ToggleButton): void => {
    const observers = ((button as Any).getGestureObservers(GestureTypes.tap) ?? []) as Any[];
    for (const observer of observers) {
        observer.callback({ eventName: 'tap', object: button, view: button, type: GestureTypes.tap });
    }
};

const EMISSIONS = ['toggled', 'clicked', 'notify::active', 'notify::group'];

const watch = (button: Gtk.ToggleButton): string[] => {
    const seen: string[] = [];
    for (const name of EMISSIONS) button.connect(name, () => seen.push(name));
    return seen;
};

export const toggleButtonSpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    await describe(`Gtk.ToggleButton on '${engine}' (ADR 0105 § 2, route D)`, async () => {
        await it('starts inactive, having emitted nothing', () => {
            const button = new Gtk.ToggleButton();
            const seen = watch(button);
            expect(button.active).toBe(false);
            expect(seen.length).toBe(0);
        });

        await it('active: toggled, THEN notify::active, once per change', () => {
            const button = new Gtk.ToggleButton();
            const seen = watch(button);
            button.active = true;
            button.active = true;
            button.active = false;
            info(`seen=${seen.join('|')}`);
            expect(seen.join()).toBe('toggled,notify::active,toggled,notify::active');
        });

        await it('active: null → false silently, 1 → true, 0 → false, a bad string throws', () => {
            const button = new Gtk.ToggleButton();
            const seen = watch(button);
            (button as Any).active = null;
            expect(seen.length).toBe(0);
            (button as Any).active = 1;
            expect(button.active).toBe(true);
            (button as Any).active = 0;
            expect(button.active).toBe(false);
            expect(() => ((button as Any).active = 'maybe')).toThrow();
        });

        await it('group: set_group and group = … emit no notify::group', () => {
            const [a, b, c] = [new Gtk.ToggleButton(), new Gtk.ToggleButton(), new Gtk.ToggleButton()];
            const seen = watch(b);
            b.set_group(a);
            b.set_group(a);
            b.set_group(null);
            b.group = a;
            expect(seen.length).toBe(0);
            expect(c.active).toBe(false);
        });

        await it('a group: the other member goes false first, then this one toggles', () => {
            const [a, b] = [new Gtk.ToggleButton(), new Gtk.ToggleButton()];
            b.set_group(a);
            a.active = true;
            const log: string[] = [];
            a.connect('toggled', () => log.push(`a:${a.active}/b:${b.active}`));
            b.connect('toggled', () => log.push(`b:${b.active}/a:${a.active}`));
            b.active = true;
            expect(log.join()).toBe('a:false/b:false,b:true/a:false');
        });

        await it('a tap toggles BEFORE a clicked handler; an active grouped member is not tapped off', () => {
            const [a, b] = [new Gtk.ToggleButton(), new Gtk.ToggleButton()];
            const lone = new Gtk.ToggleButton();
            const reads: boolean[] = [];
            lone.connect('clicked', () => reads.push(lone.active));
            tap(lone);
            tap(lone);
            expect(reads.join()).toBe('true,false');
            b.set_group(a);
            tap(b);
            tap(b);
            expect(b.active).toBe(true);
        });

        await it('clicked is inherited from GtkButton: emit("clicked") toggles and emits clicked once', () => {
            const button = new Gtk.ToggleButton();
            const seen = watch(button);
            button.emit('clicked');
            expect(seen.join()).toBe('toggled,notify::active,clicked');
        });
    });
};
