// ROUTE D OFF A DEVICE: `Adw.ViewStack`'s declared `visible-child` / `visible-child-name`
// properties, with the port's store replaced by real GObject through `@gjsify/node-gi`
// (ADR 0105 stage 2).
//
// `AdwViewStack` is `withSignals(GridLayout, …)` — a declared base in one step, because
// `GridLayout` itself carries no declaration. `tests/integration/nativescript-gi/app/specs/adw-view-stack.ts`
// runs the same vectors on the device.
//
// MEASURED ON REAL LIBADWAITA 1.9.4 (the `measureReal` leg below re-measures the behavior
// that decided the port):
//   - `add_named` of the FIRST child emits `notify::visible-child` then `notify::visible-child-name`.
//   - `set_visible_child_name` to a valid name emits `notify::visible-child` then
//     `notify::visible-child-name`.
//   - `set_visible_child` to a child of the stack emits `notify::visible-child` then
//     `notify::visible-child-name`.
//   - Repeated writes and no-match writes emit nothing.
//
// `@gjsify/node-gi` is named only in `./test.node-gi.mts`, which hands `requireGi` to this factory.

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';
import * as GObject from './namespace/gobject.js';

const loose = (widget: object): Record<string, unknown> => widget as unknown as Record<string, unknown>;

const EMISSIONS = ['notify::visible-child', 'notify::visible-child-name'];

function watch(stack: Adw.ViewStack, tag = ''): string[] {
    const seen: string[] = [];
    for (const name of EMISSIONS) stack.connect(name, () => seen.push(`${tag}${name}`));
    return seen;
}

/** What the real-Adw child process measured. */
export interface RealAdwViewStackMeasurement {
    readonly addFirst: string[];
    readonly setName: string[];
    readonly setChild: string[];
    readonly repeated: string[];
    readonly noMatch: string[];
}

/**
 * Runs the real-Adw measurement and returns what it saw. It is handed in, not done here: real
 * `Adw.ViewStack` and the port's `AdwViewStack` both want the GType name `AdwViewStack`, so the
 * two cannot share a process (`a GType named 'AdwViewStack' is already registered`). The host
 * entry runs it in a child node process.
 */
export type RealAdwViewStackMeasurementFn = () => RealAdwViewStackMeasurement;

export const createAdwViewStackRouteDNodeGiTest = (measureReal: RealAdwViewStackMeasurementFn) => async () => {
    await describe('the engine this leg runs on', async () => {
        await it('is real GObject, so these cases are route D and not the seam’s own accessors', () => {
            expect(GObject.engineName).toBe('real-gio');
        });
    });

    await describe('a REAL Adw.ViewStack (the measurement behind the port)', async () => {
        await it('emits notify::visible-child, then notify::visible-child-name, and nothing on repeats/no-match', () => {
            const measured = measureReal();
            expect(measured.addFirst).toStrictEqual(['notify::visible-child', 'notify::visible-child-name']);
            expect(measured.setName).toStrictEqual(['notify::visible-child', 'notify::visible-child-name']);
            expect(measured.setChild).toStrictEqual(['notify::visible-child', 'notify::visible-child-name']);
            expect(measured.repeated).toStrictEqual([]);
            expect(measured.noMatch).toStrictEqual([]);
        });
    });

    await describe('Adw.ViewStack over real GObject (route D)', async () => {
        await it('registers its own GType over a foreign NativeScript parent', () => {
            const stack = new Adw.ViewStack();
            expect(typeof loose(Adw.ViewStack).$gtype).toBe('object');
            expect(loose(stack).$typeName).toBe('AdwViewStack');
        });

        await it('starts empty, having emitted nothing', () => {
            const stack = new Adw.ViewStack();
            const seen = watch(stack);
            expect(stack.visibleChildName).toBe(null);
            expect(stack.visibleChild).toBe(null);
            expect(seen.length).toBe(0);
        });

        await it('add_named of the first child emits visible-child, then visible-child-name', () => {
            const stack = new Adw.ViewStack();
            const seen = watch(stack);
            stack.add_named(new Gtk.Label(), 'one');
            expect(seen).toStrictEqual(['notify::visible-child', 'notify::visible-child-name']);
            expect(stack.visibleChildName).toBe('one');
        });

        await it('visible-child-name selects the page and emits child, then name', () => {
            const stack = new Adw.ViewStack();
            stack.add_named(new Gtk.Label(), 'one');
            stack.add_named(new Gtk.Label(), 'two');
            const seen = watch(stack);
            stack.visibleChildName = 'two';
            expect(seen).toStrictEqual(['notify::visible-child', 'notify::visible-child-name']);
            expect(stack.visibleChildName).toBe('two');
        });

        await it('visible-child selects by view and emits child, then name', () => {
            const stack = new Adw.ViewStack();
            const one = new Gtk.Label();
            const two = new Gtk.Label();
            stack.add_named(one, 'one');
            stack.add_named(two, 'two');
            const seen = watch(stack);
            stack.visibleChild = two;
            expect(seen).toStrictEqual(['notify::visible-child', 'notify::visible-child-name']);
            expect(stack.visibleChildName).toBe('two');
        });

        await it('repeated and no-match writes emit nothing', () => {
            const stack = new Adw.ViewStack();
            const one = new Gtk.Label();
            const two = new Gtk.Label();
            stack.add_named(one, 'one');
            stack.add_named(two, 'two');
            stack.visibleChildName = 'two';
            const seen = watch(stack);
            stack.visibleChildName = 'two';
            stack.visibleChild = two;
            stack.visibleChildName = 'missing';
            stack.visibleChild = new Gtk.Label();
            expect(seen).toStrictEqual([]);
        });

        await it('removing the visible child clears it without notifying', () => {
            const stack = new Adw.ViewStack();
            const one = new Gtk.Label();
            stack.add_named(one, 'one');
            const seen = watch(stack);
            expect(stack.remove(one)).toBe(true);
            expect(stack.visibleChild).toBe(null);
            expect(stack.visibleChildName).toBe(null);
            expect(seen).toStrictEqual([]);
        });

        await it('get/set_visible_child(_name) mirror the properties and notify through them', () => {
            const stack = new Adw.ViewStack();
            const one = new Gtk.Label();
            const two = new Gtk.Label();
            stack.add_named(one, 'one');
            stack.add_named(two, 'two');
            const seen = watch(stack);
            stack.set_visible_child_name('two');
            expect((stack.get_visible_child() as unknown) === (two as unknown)).toBe(true);
            stack.set_visible_child(one);
            expect(stack.get_visible_child_name()).toBe('one');
            expect(seen).toStrictEqual([
                'notify::visible-child',
                'notify::visible-child-name',
                'notify::visible-child',
                'notify::visible-child-name',
            ]);
        });
    });
};

export default createAdwViewStackRouteDNodeGiTest;
