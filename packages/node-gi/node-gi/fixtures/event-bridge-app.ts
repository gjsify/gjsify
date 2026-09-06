// SPDX-License-Identifier: MIT
//
// The @gjsify/event-bridge LIVE proof — ONE source, two runtimes.
//
//   gjsify build … --app gjs   → native gi:// Gtk/Gdk under GJS
//   gjsify build … --app node  → @gjsify/node-gi under Node.js
//
// It imports the REAL `attachEventControllers` from `@gjsify/event-bridge` — the
// helper that attaches GTK4 `EventControllerMotion`/`GestureClick`/
// `EventControllerScroll`/`EventControllerKey`/`EventControllerFocus` to a widget
// and dispatches W3C DOM events (Mouse/Pointer/Keyboard/Wheel/FocusEvent from
// `@gjsify/dom-events`) on the associated element. This drives the exact same path
// the `event-bridge.spec.ts` GJS spec drives — a SYNTHESIZED event pushed through
// the LIVE `Gtk.EventController*` via `emit(signal, …)` — and asserts the resulting
// DOM event fields (type, coords, `getModifierState`, key/code). The point: the
// `Gdk.ModifierType` flags + `Gdk.keyval_*` marshalling must produce byte-identical
// DOM events on node-gi as on GJS.
//
// Lifecycle (mirrors fixtures/canvas2d-bridge-app.ts):
//   - a `Gtk.DrawingArea` goes into a `Gtk.ApplicationWindow`, `present()`ed under a
//     display (Xvfb or a real session) so the widget REALIZES + ALLOCATES (400x300) — the motion
//     handler clamps to the live allocation, so the widget must be sized;
//   - `attachEventControllers(area, () => recorder)` wires all five controllers;
//   - a `GLib.timeout_add` waits for the allocation, then drives:
//       motion(12,8) motion(20,18) motion(-3,-7) | scroll(0,1) |
//       key-pressed(KEY_a, SHIFT) key-pressed(KEY_Left, CONTROL) key-released(KEY_a) |
//       focus enter/leave
//     retrieving each controller off `widget.observe_controllers()` (see the index
//     note below), asserts the dispatched DOM events, prints the fixed golden, quits.
//
// The controllers are retrieved by ADD ORDER. `observe_controllers()` returns them
// in REVERSE add order (GTK LIFO), so the list is reversed to recover the order
// `attachEventControllers` adds them in: [motion, click, scroll, key, focus, legacy]. This
// is used INSTEAD of the spec's `ctrl instanceof Gtk.EventControllerMotion` filter
// because node-gi does not wire `instanceof` for GObject wrapper classes yet (a
// documented deep-engine gap — see the test file header); wrapper IDENTITY is
// preserved and `emit()` resolves the signal by the live GType, so add-order
// retrieval drives the real controllers correctly.
//
// Every printed line is DETERMINISTIC + display-independent (coords clamped to the
// fixed 400x300 allocation; key/code/modifiers computed from Gdk marshalling), so
// the gjs output is byte-identical to the node output AND matches the committed
// golden. `print` is ambient under GJS and injected by `--globals auto`
// (`@gjsify/node-gi/globals`) for the node build — NO `/register` import.

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import { attachEventControllers } from '@gjsify/event-bridge';

const W = 400;
const H = 300;

// Minimal element stub the bridge dispatches onto; records every DOM event.
interface RecordedEvent {
    type: string;
    clientX?: number;
    clientY?: number;
    movementX?: number;
    movementY?: number;
    deltaX?: number;
    deltaY?: number;
    key?: string;
    code?: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    getModifierState?: (k: string) => boolean;
}

function makeRecorder() {
    const events: RecordedEvent[] = [];
    return {
        events,
        dispatchEvent(e: RecordedEvent): boolean {
            events.push(e);
            return true;
        },
    };
}

const app = new Gtk.Application({
    application_id: 'eu.jumplink.NodeGiEventBridge',
    flags: Gio.ApplicationFlags.NON_UNIQUE, // no session-bus uniqueness round-trip
});

app.connect('activate', () => {
    try {
        print('activated');

        const win = new Gtk.ApplicationWindow({ application: app });
        win.set_default_size(W, H);

        const area = new Gtk.DrawingArea();
        area.set_content_width(W);
        area.set_content_height(H);

        const recorder = makeRecorder();
        // The REAL helper under test — attaches all five GTK controllers.
        attachEventControllers(area, () => recorder);

        win.set_child(area);
        win.present();

        // Retrieve the controllers off the widget in ADD order (reverse of the LIFO
        // observe_controllers list). node-gi preserves wrapper identity + resolves
        // emit() by the live GType, so these ARE the live controllers.
        const collectControllers = () => {
            const list = area.observe_controllers();
            const ctrls: Gtk.EventController[] = [];
            for (let i = 0; i < list.get_n_items(); i++) {
                ctrls.push(list.get_item(i) as Gtk.EventController);
            }
            ctrls.reverse();
            return ctrls;
        };

        const has = (type: string) => recorder.events.some((e) => e.type === type);
        const filter = (type: string) => recorder.events.filter((e) => e.type === type);

        let ticks = 0;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            ticks++;
            // Wait until the DrawingArea is realized + allocated so the motion
            // handler's clamp reads a real 400x300 allocation (coords pass through).
            if (area.get_allocated_width() <= 0 && ticks < 40) {
                return GLib.SOURCE_CONTINUE;
            }

            try {
                const ctrls = collectControllers();
                // [motion, click, scroll, key, focus, legacy] — attachEventControllers order.
                const [motionC, , scrollC, keyC, focusC] = ctrls;

                // ---- Motion: coords, movement delta, lower-bound clamp ----
                motionC.emit('motion', 12, 8);
                motionC.emit('motion', 20, 18);
                motionC.emit('motion', -3, -7); // clamps to 0,0 regardless of allocation

                // ---- Scroll → WheelEvent (a notch is three lines, deltaMode DOM_DELTA_LINE) ----
                scrollC.emit('scroll', 0, 1);

                // ---- Key: keyval + Gdk.ModifierType flags marshalling ----
                keyC.emit('key-pressed', Gdk.KEY_a, 0, Gdk.ModifierType.SHIFT_MASK);
                keyC.emit('key-pressed', Gdk.KEY_Left, 0, Gdk.ModifierType.CONTROL_MASK);
                keyC.emit('key-released', Gdk.KEY_a, 0, 0);

                // ---- Focus: enter/leave → focus/focusin, blur/focusout ----
                focusC.emit('enter');
                focusC.emit('leave');

                // ---- Assert + print the committed golden ----
                const pm = filter('pointermove');
                const kd = filter('keydown');
                const wheel = recorder.events.find((e) => e.type === 'wheel')!;
                const keyup = recorder.events.find((e) => e.type === 'keyup')!;

                print(`motion: ${pm[0].clientX},${pm[0].clientY}`);
                print(`move: ${pm[1].movementX},${pm[1].movementY}`);
                print(`clamp: ${pm[2].clientX},${pm[2].clientY}`);
                print(`wheel: ${wheel.deltaX},${wheel.deltaY}`);
                print(`keydown: ${kd[0].key} ${kd[0].code} shift=${kd[0].shiftKey} ctrl=${kd[0].ctrlKey}`);
                print(
                    `modstate: Shift=${kd[0].getModifierState!('Shift')} Control=${kd[0].getModifierState!('Control')}`,
                );
                print(`keydown: ${kd[1].key} ${kd[1].code} shift=${kd[1].shiftKey} ctrl=${kd[1].ctrlKey}`);
                print(`keyup: ${keyup.key}`);
                print(`focus: ${['focus', 'focusin'].filter(has).join(',')}`);
                print(`blur: ${['blur', 'focusout'].filter(has).join(',')}`);
                print('quit');
            } catch (error) {
                print(`activate-error: ${error instanceof Error ? error.message : String(error)}`);
            }
            app.quit();
            return GLib.SOURCE_REMOVE;
        });
    } catch (error) {
        // Surface a failure as a deterministic line so a golden mismatch points at
        // the cause instead of hanging the loop.
        print(`activate-error: ${error instanceof Error ? error.message : String(error)}`);
        app.quit();
    }
});

print('event-bridge: start');
app.run([]); // top-level blocking run (no async wrapper — the node-gtk #442 caveat)
print('done');

// Force a clean exit(0) on BOTH runtimes. Under `gjs -m` the process exits on module
// completion regardless; under node-gi a mapped Gtk.DrawingArea's live GdkFrameClock
// stays an active GLib source after app.quit(), which the uv-driven auto-pump keeps
// mirroring onto libuv — so node would otherwise NOT exit (the documented "one
// lifetime divergence vs gjs"). A GTK program that must terminate exits explicitly.
process.exit(0);
