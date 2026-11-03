// ROUTE D OFF A DEVICE: `Gtk.ToggleButton`'s declared `active` property and `toggled` signal,
// with the port's store replaced by real GObject through `@gjsify/node-gi` (ADR 0105 stage 2).
//
// The toggle button is `withProperties` over `GtkButton`, itself `withSignals` — a DECLARED base,
// whose `clicked` must stay inherited and not be redeclared. `tests/integration/nativescript-gi/
// app/specs/toggle-button.ts` runs the same vectors on the device.
//
// MEASURED ON REAL GTK 4.22 (the `real` leg below re-measures the two that decided the port):
//   - `active = true` emits `toggled` FIRST, then `notify::active`. This is the order the port
//     already had; the migration brief expected the reverse, and the measurement wins.
//   - `notify::group` is NEVER emitted: not by `set_group(a)`, a repeated `set_group`,
//     `set_group(null)` nor `group = a`. The pspec is WRITABLE | STATIC_STRINGS, not explicit-notify.
//
// `@gjsify/node-gi` is named only in `./test.node-gi.mts`, which hands `requireGi` to this factory.

import { describe, expect, it } from '@gjsify/unit';

import * as Gtk from './namespace/gtk.js';
import * as GObject from './namespace/gobject.js';
import { emittedSignalsOf } from './widgets/signals.js';

const loose = (widget: object): Record<string, unknown> => widget as unknown as Record<string, unknown>;

const EMISSIONS = ['toggled', 'clicked', 'notify::active', 'notify::group'];

function watch(button: Gtk.ToggleButton, tag = ''): string[] {
    const seen: string[] = [];
    for (const name of EMISSIONS) button.connect(name, () => seen.push(`${tag}${name}`));
    return seen;
}

/**
 * Runs the real-Gtk measurement and returns what it saw. It is handed in, not done here: real
 * `Gtk.ToggleButton` and the port's `GtkButton` both want the GType name `GtkButton`, so the
 * two cannot share a process (`a GType named 'GtkButton' is already registered`). The host
 * entry runs it in a child node process.
 */
export type RealToggleMeasurement = () => { activate: string[]; groupNotifies: number };

export const createToggleButtonRouteDNodeGiTest = (measureReal: RealToggleMeasurement) => async () => {
    await describe('the engine this leg runs on', async () => {
        await it('is real GObject, so these cases are route D and not the seam’s own accessors', () => {
            expect(GObject.engineName).toBe('real-gio');
        });
    });

    await describe('a REAL Gtk.ToggleButton (the measurement behind the port)', async () => {
        await it('emits toggled, then notify::active, and never notify::group', () => {
            const measured = measureReal();
            expect(measured.activate).toStrictEqual(['a:toggled', 'a:notify::active']);
            expect(measured.groupNotifies).toBe(0);
        });
    });

    await describe('Gtk.ToggleButton over real GObject (route D)', async () => {
        await it('registers its own GType over a foreign NativeScript parent', () => {
            const button = new Gtk.ToggleButton();
            expect(typeof loose(Gtk.ToggleButton).$gtype).toBe('object');
            expect(loose(button).$typeName).toBe('GtkToggleButton');
        });

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
            expect(seen).toStrictEqual(['toggled', 'notify::active', 'toggled', 'notify::active']);
        });

        await it('active: null → false silently, 1 → true, 0 → false, and a bad string throws', () => {
            const button = new Gtk.ToggleButton();
            const seen = watch(button);
            loose(button).active = null;
            expect(seen.length).toBe(0);
            loose(button).active = 1;
            expect(button.active).toBe(true);
            loose(button).active = 0;
            expect(button.active).toBe(false);
            expect(() => (loose(button).active = 'maybe')).toThrow();
        });

        await it('group: silent, and no notify::group', () => {
            const [a, b] = [new Gtk.ToggleButton(), new Gtk.ToggleButton()];
            const seen = watch(b);
            b.group = a;
            b.group = a;
            b.group = null;
            expect(seen.length).toBe(0);
        });

        await it('a group: the other member goes false first, then this one notifies', () => {
            const [a, b] = [new Gtk.ToggleButton(), new Gtk.ToggleButton()];
            b.group = a;
            a.active = true;
            const log: string[] = [];
            a.connect('toggled', () => log.push(`a:toggled:${a.active}/${b.active}`));
            b.connect('toggled', () => log.push(`b:toggled:${b.active}/${a.active}`));
            b.active = true;
            expect(log).toStrictEqual(['a:toggled:false/false', 'b:toggled:true/false']);
        });

        await it('a tap toggles BEFORE a clicked handler, and an active grouped member cannot be tapped off', () => {
            const [a, b] = [new Gtk.ToggleButton(), new Gtk.ToggleButton()];
            b.group = a;
            const seen: boolean[] = [];
            b.connect('clicked', () => seen.push(b.active));
            b.emit('clicked');
            b.emit('clicked');
            expect(seen).toStrictEqual([true, true]);
            expect(b.active).toBe(true);
        });

        await it('clicked is inherited from GtkButton, declared once, and not redeclared', () => {
            const own = emittedSignalsOf(Gtk.ToggleButton);
            expect(own.filter((name) => name === 'clicked').length).toBe(1);
            expect(own.includes('toggled')).toBe(true);
            const button = new Gtk.ToggleButton();
            const seen = watch(button);
            button.emit('clicked');
            expect(seen).toStrictEqual(['toggled', 'notify::active', 'clicked']);
        });
    });
};

export default createToggleButtonRouteDNodeGiTest;
