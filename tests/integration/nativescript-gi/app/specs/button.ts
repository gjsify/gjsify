// `Gtk.Button::clicked` AS A DECLARED SIGNAL ON A DEVICE (ADR 0105 § 2, route D).
//
// The button declares `clicked` at its `extends`: on this leg's real engine it is a signal of a
// GType registered over `GridLayout`, on the control leg the seam's own handler table. Every case
// runs in BOTH legs, for the reason `specs/views.ts` gives — they are statements about the
// widget — and only the first reads which engine answered. What a device adds over
// `gtk-button-clicked.spec.ts` is that `emit`, `connect` and the tap listener really meet
// node-gi's `g_signal_emit` / `g_signal_connect` on the V8/Java runtime.
import { Gtk } from '@gjsify/adwaita-nativescript';

import { describe, expect, info, it } from '../reporter.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const tap = (button: object): void => (button as Any).notify({ eventName: 'tap', object: button });

export const buttonSpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    await describe(`Gtk.Button::clicked on '${engine}' (ADR 0105 § 2, route D)`, async () => {
        await it('is a registered GType on the real engine and the seam otherwise', () => {
            const mixin = Object.getPrototypeOf(Gtk.Button) as Any;
            info(`gtypeName=${mixin.$gtypeName ?? 'none'}`);
            expect(Object.hasOwn(mixin, '$gtype')).toBe(engine === 'real-gio');
        });

        await it('a tap runs every connected handler exactly once, emitter first', () => {
            const button = new Gtk.Button({ label: 'Go' });
            const seen: unknown[] = [];
            button.connect('clicked', (self: Any, data: Any) => seen.push(self === button, data.eventName));
            let second = 0;
            button.connect('clicked', () => second++);
            tap(button);
            info(`seen=[${seen.join(',')}] second=${second}`);
            expect(seen.join()).toBe('true,clicked');
            expect(second).toBe(1);
        });

        await it('emit(clicked) from code runs the handlers once; a disconnect stops them', () => {
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

        await it('refuses the NativeScript verbs for it, and emit refuses an undeclared name', () => {
            const button = new Gtk.Button();
            expect(() => (button as Any).addEventListener('clicked', () => {})).toThrow();
            expect(() => (button as Any).notify({ eventName: 'clicked', object: button })).toThrow();
            expect(() => button.emit('nope')).toThrow();
        });

        await it('a toggle button toggles in its class handler, before a handler the caller connects', () => {
            const toggle = new Gtk.ToggleButton();
            const seen: boolean[] = [];
            toggle.connect('clicked', (self: Any) => seen.push(self.active));
            toggle.emit('clicked');
            tap(toggle);
            expect(seen.join()).toBe('true,false');
        });
    });
};
