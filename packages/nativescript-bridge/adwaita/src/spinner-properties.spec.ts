// THE SECOND MIGRATED WIDGET, MEASURED ON THE PURE-JS LEG (ADR 0105 § 2, route D).
//
// `AdwSpinner` no longer writes `get spinning()` / `get size()`: both are DECLARED at its
// `extends` and built by `widgets/signals.ts`, and they are the first declared properties that are
// not strings. On Android that seam registers a GType over `GridLayout` and node-gi owns them;
// everywhere else — the browser, iOS (ADR 0105 § 6), and every off-device test including this
// one — the seam's own accessors do. This file holds the leg iOS ships on to the same properties,
// the same notifies and the same indicator the twin produced, and `signals-gobject.spec.ts` holds
// the coercion rule they rest on against both legs of the SEAM.
//
// The assertions on the XML spellings are the ones that matter most here: NativeScript's builder
// writes `instance[name] = value` with the attribute's raw string, which is how `spinning="false"`
// used to reach a setter that had to know about it, and now reaches the seam instead.
//
// This lives on the TREES entry (`src/test.trees.mts`): `extends GridLayout` evaluates
// `@nativescript/core` at module scope, reachable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';
import { DEFAULT_SPINNER_SIZE } from './widgets/adw-spinner.js';

/** The platform ring the widget keeps, which `_applySize()` / `_applySpinning()` write. */
interface Ring {
    _indicator: { busy: boolean; width: number; height: number };
}

function ringOf(widget: Adw.Spinner): Ring['_indicator'] {
    return (widget as unknown as Ring)._indicator;
}

/** Stands in for the platform mounting the view: the ring only runs once the spinner is mapped. */
function mount(widget: Adw.Spinner): Adw.Spinner {
    (widget as unknown as { callLoaded(): void }).callLoaded();
    return widget;
}

/** What NativeScript's XML builder does to an attribute: assign the raw string. */
function xml(widget: Adw.Spinner, name: string, value: string): void {
    (widget as unknown as Record<string, unknown>)[name] = value;
}

export const AdwSpinnerPropertiesNsTest = async () => {
    await describe('Adw.Spinner properties on the pure-JS engine', async () => {
        await it('runs on the subset here, which is what the rest of this suite measures', () => {
            const mixin = Object.getPrototypeOf(Adw.Spinner) as object;
            expect(Object.hasOwn(mixin, '$gtype')).toBe(false);
        });

        await it('starts spinning at the minimum size, with the ring to match', () => {
            const widget = new Adw.Spinner();
            expect(widget.spinning).toBe(true);
            expect(widget.size).toBe(DEFAULT_SPINNER_SIZE);
            expect(widget.width).toBe(DEFAULT_SPINNER_SIZE);
            expect(ringOf(widget).width).toBe(DEFAULT_SPINNER_SIZE);
        });

        await it('answers each property in all three GObject spellings, typed', () => {
            const widget = new Adw.Spinner();
            const loose = widget as unknown as Record<string, unknown>;
            widget.size = 40;
            expect(loose.size).toBe(40);
            widget.spinning = false;
            expect(loose.spinning).toBe(false);
        });

        await it('keeps the box at what was asked and caps only the ring', () => {
            const widget = new Adw.Spinner();
            widget.size = 200;
            expect(widget.size).toBe(200);
            expect(widget.width).toBe(200);
            expect(widget.ringDiameter).toBe(64);
            expect(ringOf(widget).width).toBe(64);
        });

        await it('floors a request below the measured minimum, and reads the floor back', () => {
            const widget = new Adw.Spinner();
            widget.size = 4;
            expect(widget.size).toBe(16);
            expect(widget.width).toBe(16);
        });

        await it('takes the XML spellings as typed values, a CSS-ish length included', () => {
            const widget = mount(new Adw.Spinner());
            xml(widget, 'size', '96');
            expect(widget.size).toBe(96);
            xml(widget, 'size', '24px');
            expect(widget.size).toBe(24);
            xml(widget, 'size', 'wide');
            expect(widget.size).toBe(16);
            xml(widget, 'spinning', 'false');
            expect(widget.spinning).toBe(false);
            expect(ringOf(widget).busy).toBe(false);
            xml(widget, 'spinning', 'true');
            expect(widget.spinning).toBe(true);
            expect(ringOf(widget).busy).toBe(true);
        });

        await it('refuses a spinning that is neither true nor false instead of defaulting', () => {
            const widget = new Adw.Spinner();
            expect(() => xml(widget, 'spinning', 'maybe')).toThrow();
            expect(widget.spinning).toBe(true);
        });

        await it('stops the ring when spinning goes false, through notify::spinning', () => {
            const widget = new Adw.Spinner();
            // Unmapped, the ring does not run whatever `spinning` says (adw-spinner-paintable.c).
            expect(ringOf(widget).busy).toBe(false);
            mount(widget);
            expect(ringOf(widget).busy).toBe(true);
            widget.spinning = false;
            expect(ringOf(widget).busy).toBe(false);
            widget.spinning = true;
            expect(ringOf(widget).busy).toBe(true);
        });

        await it('notifies a real change and stays silent on an equal write', () => {
            const widget = new Adw.Spinner();
            const seen: boolean[] = [];
            const sizes: number[] = [];
            widget.connect('notify::spinning', (self) => seen.push(self.spinning));
            widget.connect('notify::size', (self) => sizes.push(self.size));
            widget.spinning = true;
            widget.spinning = false;
            widget.spinning = false;
            widget.size = 32;
            widget.size = 32;
            // A write the floor maps onto the held value is not a change either.
            widget.size = 8;
            widget.size = 12;
            expect(seen).toStrictEqual([false]);
            expect(sizes).toStrictEqual([32, 16]);
        });

        await it('takes the id back from connect and stops on disconnect', () => {
            const widget = new Adw.Spinner();
            const seen: number[] = [];
            const id = widget.connect('notify::size', (self) => seen.push(self.size));
            widget.size = 32;
            widget.disconnect(id);
            widget.size = 48;
            expect(seen).toStrictEqual([32]);
            expect(() => widget.disconnect(id)).toThrow();
        });

        await it("emits notify::spinning from GJS's notify('spinning')", () => {
            const widget = new Adw.Spinner();
            const seen: number[] = [];
            widget.connect('notify::spinning', () => seen.push(1));
            widget.notify('spinning');
            expect(seen.length).toBe(1);
            expect(() => widget.notify('nope')).toThrow();
        });

        await it('still answers the port one-argument property door', () => {
            const widget = new Adw.Spinner();
            widget.set_property('size', '64');
            expect(widget.get_property('size')).toBe(64);
            expect(ringOf(widget).width).toBe(64);
        });

        await it('takes both properties as construct props', () => {
            const widget = new Adw.Spinner({ size: 32, spinning: false });
            expect(widget.size).toBe(32);
            expect(widget.spinning).toBe(false);
            expect(ringOf(widget).width).toBe(32);
            expect(ringOf(widget).busy).toBe(false);
        });

        await it('declares both notifies in emittedSignals, from the seam', () => {
            const emitted = (Adw.Spinner as unknown as { emittedSignals: readonly string[] }).emittedSignals;
            expect(emitted.includes('notify::spinning')).toBe(true);
            expect(emitted.includes('notify::size')).toBe(true);
        });

        await it('still takes its children through addChild(widget)', () => {
            const widget = new Adw.Spinner();
            expect(typeof widget.addChild).toBe('function');
        });
    });
};

export default AdwSpinnerPropertiesNsTest;
