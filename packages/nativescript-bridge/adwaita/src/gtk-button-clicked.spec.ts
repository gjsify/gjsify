// `Gtk.Button::clicked` AS A DECLARED GObject SIGNAL, measured on the pure-JS leg (ADR 0105 § 2).
//
// The button used to dispatch `clicked` as a NativeScript event and declare nothing, which the
// `emit` rule (#2396) turned into `button.emit('clicked')` throwing. It declares the signal now,
// so on Android with the real engine it is `g_signal_emit` on a registered GType and everywhere
// else (this spec, the browser, iOS) the seam's own handler table — one door, `connect`, and one
// dispatch per tap. `tests/integration/nativescript-gi/app/specs/button.ts` runs the same cases
// against node-gi on a device.
//
// This lives on the TREES entry (`src/test.trees.mts`): `extends GridLayout` evaluates
// `@nativescript/core` at module scope, reachable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';

import * as Gtk from './namespace/gtk.js';
import { emittedSignalsOf } from './widgets/signals.js';

const tap = (button: object): void => (button as Gtk.Button).notify({ eventName: 'tap', object: button as never });

export const GtkButtonClickedNsTest = async () => {
    await describe('Gtk.Button: clicked is a declared signal', async () => {
        await it('is declared, so the shared-tree builder and emit both know it', () => {
            expect(emittedSignalsOf(Gtk.Button).includes('clicked')).toBe(true);
            expect(emittedSignalsOf(Gtk.ToggleButton).includes('clicked')).toBe(true);
        });

        await it('a tap runs each connected handler exactly once, emitter first', () => {
            const button = new Gtk.Button();
            const seen: unknown[] = [];
            button.connect('clicked', (self, data) => seen.push(self === button, data.eventName, data.object === button));
            let second = 0;
            button.connect('clicked', () => second++);
            tap(button);
            expect(seen.join()).toBe('true,clicked,true');
            expect(second).toBe(1);
        });

        await it('emit(clicked) from code runs the handlers, as in GJS, and a disconnect stops them', () => {
            const button = new Gtk.Button();
            let runs = 0;
            const id = button.connect('clicked', () => runs++);
            button.emit('clicked');
            expect(runs).toBe(1);
            button.disconnect(id);
            button.emit('clicked');
            tap(button);
            expect(runs).toBe(1);
        });

        await it('is GObject-only: the NativeScript verbs refuse it by name, naming connect', () => {
            const button = new Gtk.Button();
            const listener = (): void => {};
            expect(() => button.addEventListener('clicked', listener)).toThrow();
            expect(() => button.on('clicked', listener)).toThrow();
            expect(() => button.notify({ eventName: 'clicked', object: button as never })).toThrow();
        });

        await it('tap itself stays the platform event and is not a declared signal', () => {
            const button = new Gtk.Button();
            let taps = 0;
            button.on('tap', () => taps++);
            tap(button);
            expect(taps).toBe(1);
            expect(() => button.emit('tap')).toThrow();
        });

        await it('a toggle button toggles in its own clicked handler, before any the caller connects', () => {
            const toggle = new Gtk.ToggleButton();
            const seen: boolean[] = [];
            toggle.connect('clicked', (self) => seen.push(self.active));
            toggle.emit('clicked');
            tap(toggle);
            expect(seen.join()).toBe('true,false');
            expect(toggle.active).toBe(false);
        });
    });
};
