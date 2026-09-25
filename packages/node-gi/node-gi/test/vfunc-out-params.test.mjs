// SPDX-License-Identifier: MIT
// A JS vfunc override's OBJECT arguments and OUT parameters, end to end through GTK.
//
// Two defects, found together on the React Native bridge's rail layout (a
// `Gtk.BoxLayout` subclass overriding `vfunc_measure`), and each hid the other:
//
//  * gi.js re-wrapped the vfunc's `this` but passed every ARGUMENT through raw, so a
//    GObject argument arrived as an engine handle with no prototype —
//    `widget.get_ancestor is not a function`.
//  * the engine's vfunc trampoline never wrote OUT parameters back. C calls
//    `measure(…, int *minimum, int *natural, int *min_baseline, int *nat_baseline)`
//    and the JS answer `[min, nat, minBaseline, natBaseline]` was dropped, so GTK
//    read zeros and the rail collapsed to 0 px.
//
// The shape is GJS's: a pure OUT is not a JS argument; one output is returned as
// itself, several as an array in declaration order (the return value first).
//
// SELF-SKIPPING like the other GTK files: a widget needs a display, which darwin and
// win32 always have and a headless Linux leg does not; the xvfb GTK job runs it there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';
import { haveDisplay } from './display-gate.mjs';

let Gtk;
let GObject;
let loadError = null;
if (haveDisplay) {
    try {
        GObject = requireGi('GObject', '2.0');
        Gtk = requireGi('Gtk', '4.0');
        Gtk.init();
    } catch (err) {
        loadError = err;
    }
}

const skip = !haveDisplay
    ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)'
    : loadError
      ? `Gtk-4.0 typelib unavailable: ${loadError.message}`
      : false;

test('a layout manager override receives its widget as a real Gtk.Widget', { skip }, () => {
    let received = null;
    const Recording = GObject.registerClass(
        { GTypeName: 'NodeGiVfuncOutRecordingLayout' },
        class extends Gtk.BoxLayout {
            vfunc_measure(widget, orientation, forSize) {
                received = widget;
                return super.vfunc_measure(widget, orientation, forSize);
            }
        },
    );
    const box = new Gtk.Box();
    box.set_layout_manager(new Recording());
    box.measure(Gtk.Orientation.HORIZONTAL, -1);

    assert.equal(received, box, 'the canonical wrapper, not a second object');
    assert.equal(typeof received.get_ancestor, 'function');
    assert.equal(received.get_ancestor(Gtk.Window.$gtype), null);
});

test('the OUT parameters an override returns are the ones C reads', { skip }, () => {
    const Fixed = GObject.registerClass(
        { GTypeName: 'NodeGiVfuncOutFixedLayout' },
        class extends Gtk.BoxLayout {
            vfunc_measure(_widget, orientation, _forSize) {
                return orientation === Gtk.Orientation.HORIZONTAL ? [7, 11, -1, -1] : [13, 17, 5, 9];
            }
        },
    );
    const box = new Gtk.Box();
    box.set_layout_manager(new Fixed());
    // The baselines are the signed half: -1 is "none", and a write that truncated or
    // zero-extended the int would read back as 0 or 4294967295.
    assert.deepEqual(box.measure(Gtk.Orientation.HORIZONTAL, -1), [7, 11, -1, -1]);
    assert.deepEqual(box.measure(Gtk.Orientation.VERTICAL, -1), [13, 17, 5, 9]);
});

test('a widget override answers through the same OUT parameters', { skip }, () => {
    let arity = null;
    const Sized = GObject.registerClass(
        { GTypeName: 'NodeGiVfuncOutSizedWidget' },
        class extends Gtk.Widget {
            vfunc_measure(...args) {
                arity = args.length;
                return args[0] === Gtk.Orientation.HORIZONTAL ? [40, 60, -1, -1] : [30, 45, 20, 32];
            }
        },
    );
    const widget = new Sized();
    assert.deepEqual(widget.measure(Gtk.Orientation.HORIZONTAL, -1), [40, 60, -1, -1]);
    assert.deepEqual(widget.measure(Gtk.Orientation.VERTICAL, -1), [30, 45, 20, 32]);
    // orientation and for_size only: the four OUT pointers are not JS arguments.
    assert.equal(arity, 2);
});

test('an answer of the wrong shape throws instead of reading back zeros', { skip }, () => {
    const Short = GObject.registerClass(
        { GTypeName: 'NodeGiVfuncOutShortLayout' },
        class extends Gtk.BoxLayout {
            vfunc_measure() {
                return [1, 2];
            }
        },
    );
    const box = new Gtk.Box();
    box.set_layout_manager(new Short());
    assert.throws(() => box.measure(Gtk.Orientation.HORIZONTAL, -1), {
        name: 'TypeError',
        message: /vfunc 'measure' must return an array of 4 values/,
    });
});
