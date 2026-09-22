// A CLAMP AROUND A CHILD THAT CARRIES NO CLASS — the shape that killed an app at startup.
//
// THE INCIDENT. `@gjsify/adwaita-nativescript` crashed on launch in Learn6502's Android port
// on a real emulator: `app-android/app/views/main/editor.ts` puts a classless child in an
// `Adw.Clamp`, `_allocate` handed that child's `className` to `clampChildClassName`, and
// `replaceClasses` split it — `TypeError: … reading 'split'`.
//
// WHY NOTHING IN THIS PACKAGE COULD SEE IT, which is the part worth keeping. Two readers
// both said the value was a `string`. The ambient `src/ns-core.d.ts` declared
// `className: string`, so `gjsify tsc` held every call CORRECT; and `src/testing/ns-core.mts`
// initialised its backing field to `''` and coerced `value ?? ''` on write, so the off-device
// double could not PRODUCE the value a device produces. Both now state what NativeScript
// actually does: `classNameProperty` is registered with no `defaultValue`
// (`ui/core/view-base/index.ts:1592`) and `Property`'s getter answers
// `key in this ? this[key] : defaultValue` (`ui/core/properties/index.ts:303`), so an
// unwritten `className` reads `undefined`. Measured against `@nativescript/core` 9.1.2 by
// registering that property's own options on a bare class and reading the member back.
//
// THE FIRST ASSERTION BELOW IS ABOUT THE DOUBLE, not about the clamp, and it is not
// ceremony: every other assertion here is worthless if the double ever goes back to
// answering `''`. It would pass, and it would be measuring nothing.
//
// A CLASSLESS CHILD IS ORDINARY. `Gtk.Box` and `Gtk.Label` are transparent — their own
// constructors document writing no `className` at all — so the port SHIPS the producer, and
// any plain `@nativescript/core` view a consumer builds is in the same state.
//
// This lives on the TREES entry (`src/test.trees.mts`), not the pure one: it builds the
// port's real widget classes, which evaluate `@nativescript/core` at module scope and are
// reachable only under that entry's `--alias`. The package's AGENTS.md carries the rule.

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';
import { StackLayout } from './testing/ns-core.mjs';

/**
 * A container size to evaluate the clamp curve against.
 *
 * Nothing lays a view out here, so the double reports 0×0 and `clampAllocationFor` answers
 * "do not constrain" — the branch where the size class is `null`. The device was in the
 * OTHER branch, where a real width produces a real size class and the child's `className` is
 * genuinely rewritten, so both are driven below.
 */
type MeasuredSize = { width: number; height: number };

/** Pin what a layout pass would have reported, so the curve has a width to work from. */
function pinWidth(view: object, width: number): void {
    (view as { getActualSize(): MeasuredSize }).getActualSize = () => ({ width, height: width });
}

export const AdwClampClasslessChildNsTest = async () => {
    await describe('Adw.Clamp with a child that has no className', async () => {
        await it('the double reports an unwritten className as undefined, as a device does', () => {
            expect(new StackLayout().className).toBe(undefined);
            expect(new Gtk.Box().className).toBe(undefined);
            expect(new Gtk.Label().className).toBe(undefined);
        });

        await it('takes a classless child without throwing, before any layout pass', () => {
            const clamp = new Adw.Clamp();
            clamp.set_child(new Gtk.Box());
            expect(clamp.child?.className).toBe('');
        });

        await it('gives a classless child its size class once a width is known', () => {
            const clamp = new Adw.Clamp();
            pinWidth(clamp, 900);
            clamp.set_child(new Gtk.Box());
            // The class comes off the CHILD's allocated size, not the container's: at 900
            // available the eased curve lands between the 400 threshold and the 600 cap,
            // so `adw_clamp_layout_allocate` calls it `medium`.
            expect(clamp.child?.className).toBe('medium');
        });

        await it('hands a classless child back with nothing of the clamp left on it', () => {
            const clamp = new Adw.Clamp();
            pinWidth(clamp, 900);
            const child = new Gtk.Box();
            clamp.set_child(child);
            clamp.set_child(null);
            expect(child.className).toBe('');
            expect(clamp.child).toBe(null);
        });

        await it("leaves a consumer's own classes alone while swapping its own", () => {
            const clamp = new Adw.Clamp();
            pinWidth(clamp, 900);
            const child = new Gtk.Box();
            child.className = 'card';
            clamp.set_child(child);
            expect(child.className).toBe('card medium');
        });
    });
};

export default AdwClampClasslessChildNsTest;
