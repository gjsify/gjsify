// GJS-only regression tests for @gjsify/event-bridge.
//
// These verify the handlers keep their contract with GTK4 event controllers.
// The primary target is the `motion` handler: after the PR #17 fix it must
// read widget-local coords from the signal callback args, NOT from the
// surface-local `controller.get_current_event().get_position()` pathway.
// The coord-frame mismatch caused a visible drag-jump on first move after
// click in the pixel-rpg/map-editor consumer.
//
// Everything here drives controllers with `emit()`, which carries no Gdk.Event — so it
// exercises the mouse path and the pure helpers. GTK4 exposes no constructor for a
// Gdk.Event, so the touchscreen stream cannot be synthesised in a unit test; its
// translation is proved in touch-pointers.spec.ts and its delivery by the on-device run.
//
// Requires a GTK display (the CI workflow wraps tests in `xvfb-run`).

import { describe, it, expect, on } from '@gjsify/unit';

import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';

import type { Event as OurEvent } from '@gjsify/dom-events';
import { attachEventControllers, isTouchEvent, pointerTypeOf, sequenceKey, surfaceToWidget } from './event-bridge.js';

/** Pointer/Mouse event shape the bridge dispatches — the union of fields the tests read. */
type FakeBridgeEvent = OurEvent & {
    clientX?: number;
    clientY?: number;
    offsetX?: number;
    offsetY?: number;
    screenX?: number;
    screenY?: number;
    movementX?: number;
    movementY?: number;
    pointerId?: number;
    pointerType?: string;
    button?: number;
    buttons?: number;
    deltaX?: number;
    deltaY?: number;
    deltaMode?: number;
};

// Minimal stub that records dispatched events.
function makeFakeCanvas() {
    const events: FakeBridgeEvent[] = [];
    const el = {
        events,
        dispatchEvent(e: OurEvent): boolean {
            events.push(e as FakeBridgeEvent);
            return true;
        },
    };
    return el;
}

/** The widget's controllers in the order attachEventControllers added them. */
function controllersInAddOrder(widget: Gtk.Widget): Gtk.EventController[] {
    const list = widget.observe_controllers();
    const ctrls: Gtk.EventController[] = [];
    for (let i = 0; i < list.get_n_items(); i++) {
        ctrls.push(list.get_item(i) as Gtk.EventController);
    }
    // GTK prepends on add, so the observed list is newest first.
    return ctrls.reverse();
}

function getController<T extends Gtk.EventController>(widget: Gtk.Widget, type: new (...args: never[]) => T): T | null {
    for (const ctrl of controllersInAddOrder(widget)) {
        if (ctrl instanceof type) return ctrl;
    }
    return null;
}

function getMotionController(widget: Gtk.Widget): Gtk.EventControllerMotion | null {
    return getController(widget, Gtk.EventControllerMotion);
}

/** Spin the main context until `done()` holds, so a presented window has been allocated. */
function waitFor(done: () => boolean): void {
    const ctx = GLib.MainContext.default();
    for (let i = 0; i < 200 && !done(); i++) {
        ctx.iteration(true);
    }
}

// Allocate the widget a real size so `get_allocated_width()`/`get_allocated_height()`
// used by the motion handler's clamp return non-zero values. Without this the
// clamp would squash every coord to 0 and we could not tell whether the handler
// actually forwarded the signal args.
function allocateWidget(widget: Gtk.Widget, w: number, h: number): void {
    const rect = new Gdk.Rectangle();
    rect.x = 0;
    rect.y = 0;
    rect.width = w;
    rect.height = h;
    widget.size_allocate(rect, -1);
}

export default async () => {
    await on('Gjs', async () => {
        // Ensure GTK is initialised exactly once for the suite.
        Gtk.init();

        await describe('attachEventControllers — motion', async () => {
            await it('forwards signal-provided x/y as clientX/clientY/offsetX/offsetY', async () => {
                const widget = new Gtk.DrawingArea();
                const canvas = makeFakeCanvas();

                attachEventControllers(widget, () => canvas);
                allocateWidget(widget, 400, 300);

                const motionCtrl = getMotionController(widget);
                expect(motionCtrl).not.toBeNull();

                // Emit the signal with explicit widget-local coords. If the
                // implementation regressed to `controller.get_current_event()`
                // there is no event bound to this synthetic emission and the
                // handler would produce different values than 42/17.
                motionCtrl!.emit('motion', 42, 17);

                const moveEvents = canvas.events.filter((e: FakeBridgeEvent) => e.type === 'pointermove');
                expect(moveEvents.length).toBe(1);
                const ev = moveEvents[0];
                expect(ev.clientX).toBe(42);
                expect(ev.clientY).toBe(17);
                expect(ev.offsetX).toBe(42);
                expect(ev.offsetY).toBe(17);
                // screenX/Y mirror clientX/Y per this bridge's contract.
                expect(ev.screenX).toBe(42);
                expect(ev.screenY).toBe(17);
            });

            await it('also dispatches mousemove with matching clientX/clientY', async () => {
                const widget = new Gtk.DrawingArea();
                const canvas = makeFakeCanvas();

                attachEventControllers(widget, () => canvas);
                allocateWidget(widget, 400, 300);

                getMotionController(widget)!.emit('motion', 100, 50);

                const mousemoveEvents = canvas.events.filter((e: FakeBridgeEvent) => e.type === 'mousemove');
                expect(mousemoveEvents.length).toBe(1);
                expect(mousemoveEvents[0].clientX).toBe(100);
                expect(mousemoveEvents[0].clientY).toBe(50);
            });

            await it('clamps coords outside the widget allocation', async () => {
                const widget = new Gtk.DrawingArea();
                const canvas = makeFakeCanvas();

                attachEventControllers(widget, () => canvas);
                allocateWidget(widget, 400, 300);

                // Negative + above-allocation coords should be clamped to
                // [0, allocW]×[0, allocH] — protects consumers against
                // out-of-range values GTK sometimes reports at widget edges.
                getMotionController(widget)!.emit('motion', -5, 999);

                const moveEvents = canvas.events.filter((e: FakeBridgeEvent) => e.type === 'pointermove');
                expect(moveEvents.length).toBe(1);
                const ev = moveEvents[0];
                expect(ev.clientX).toBe(0);
                expect(ev.clientY).toBe(300);
            });

            await it('tracks movementX/movementY across successive motions', async () => {
                const widget = new Gtk.DrawingArea();
                const canvas = makeFakeCanvas();

                attachEventControllers(widget, () => canvas);
                allocateWidget(widget, 400, 300);

                const motionCtrl = getMotionController(widget)!;
                motionCtrl.emit('motion', 10, 20);
                motionCtrl.emit('motion', 13, 25);

                const moveEvents = canvas.events.filter((e: FakeBridgeEvent) => e.type === 'pointermove');
                expect(moveEvents.length).toBe(2);
                expect(moveEvents[1].movementX).toBe(3);
                expect(moveEvents[1].movementY).toBe(5);
            });

            await it('a synthetic emission is the mouse pointer', async () => {
                const widget = new Gtk.DrawingArea();
                const canvas = makeFakeCanvas();
                attachEventControllers(widget, () => canvas);
                allocateWidget(widget, 400, 300);

                getMotionController(widget)!.emit('motion', 1, 1);

                const ev = canvas.events.find((e) => e.type === 'pointermove')!;
                expect(ev.pointerType).toBe('mouse');
                expect(ev.pointerId).toBe(1);
            });
        });

        await describe('attachEventControllers — controller set', async () => {
            await it('keeps the five original controllers in add order and appends the touch stream last', async () => {
                // The node-gi fixture indexes [motion, click, scroll, key, focus] by add order,
                // and the touch controller must run first — GTK runs newest-added first.
                const widget = new Gtk.DrawingArea();
                attachEventControllers(widget, () => makeFakeCanvas());
                const ctrls = controllersInAddOrder(widget);
                expect(ctrls.length).toBe(6);
                expect(ctrls[0] instanceof Gtk.EventControllerMotion).toBe(true);
                expect(ctrls[1] instanceof Gtk.GestureClick).toBe(true);
                expect(ctrls[2] instanceof Gtk.EventControllerScroll).toBe(true);
                expect(ctrls[3] instanceof Gtk.EventControllerKey).toBe(true);
                expect(ctrls[4] instanceof Gtk.EventControllerFocus).toBe(true);
                expect(ctrls[5] instanceof Gtk.EventControllerLegacy).toBe(true);
            });
        });

        await describe('attachEventControllers — click (mouse path unchanged)', async () => {
            await it('pressed/released without a current event stay the mouse pointer and still emit the compatibility events', async () => {
                const widget = new Gtk.DrawingArea();
                const canvas = makeFakeCanvas();
                attachEventControllers(widget, () => canvas);
                allocateWidget(widget, 400, 300);

                const click = getController(widget, Gtk.GestureClick)!;
                click.emit('pressed', 1, 10, 20);
                click.emit('released', 1, 10, 20);

                // No `click`: a synthetic emission carries no button (`get_current_button()` is 0),
                // and only the primary button clicks — unchanged from before the touch work.
                expect(canvas.events.map((e) => e.type)).toStrictEqual([
                    'pointerdown',
                    'mousedown',
                    'pointerup',
                    'mouseup',
                ]);
                const down = canvas.events[0];
                expect(down.pointerType).toBe('mouse');
                expect(down.pointerId).toBe(1);
                expect(down.clientX).toBe(10);
                expect(down.clientY).toBe(20);
            });

            await it('a cancelled press emits pointercancel and clears the stuck button', async () => {
                const widget = new Gtk.DrawingArea();
                const canvas = makeFakeCanvas();
                attachEventControllers(widget, () => canvas);
                allocateWidget(widget, 400, 300);

                const click = getController(widget, Gtk.GestureClick)!;
                click.emit('pressed', 1, 10, 20);
                click.emit('cancel', null);
                click.emit('pressed', 1, 30, 40);

                const types = canvas.events.map((e) => e.type);
                expect(types).toStrictEqual(['pointerdown', 'mousedown', 'pointercancel', 'pointerdown', 'mousedown']);
                const cancel = canvas.events[2];
                expect(cancel.pointerType).toBe('mouse');
                expect(cancel.pointerId).toBe(1);
                expect(cancel.button).toBe(-1);
                expect(cancel.buttons).toBe(0);
                expect(cancel.cancelable).toBe(false);
            });

            await it('a cancel with nothing pressed emits nothing', async () => {
                const widget = new Gtk.DrawingArea();
                const canvas = makeFakeCanvas();
                attachEventControllers(widget, () => canvas);
                getController(widget, Gtk.GestureClick)!.emit('cancel', null);
                expect(canvas.events.length).toBe(0);
            });
        });

        await describe('attachEventControllers — wheel', async () => {
            await it('reports a notch in lines: deltaMode DOM_DELTA_LINE, three lines per notch', async () => {
                // With no scroll event received yet the controller's unit is WHEEL, which is what a
                // synthetic emission — and the node-gi golden — exercise.
                const widget = new Gtk.DrawingArea();
                const canvas = makeFakeCanvas();
                attachEventControllers(widget, () => canvas);

                getController(widget, Gtk.EventControllerScroll)!.emit('scroll', 0, 1);

                const wheel = canvas.events.find((e) => e.type === 'wheel')!;
                expect(wheel.deltaMode).toBe(1);
                expect(wheel.deltaX).toBe(0);
                expect(wheel.deltaY).toBe(3);
            });
        });

        await describe('helpers', async () => {
            await it('isTouchEvent: no event, or a non-touch type, is not touch', async () => {
                expect(isTouchEvent(null)).toBe(false);
                const button = { get_event_type: () => Gdk.EventType.BUTTON_PRESS } as unknown as Gdk.Event;
                expect(isTouchEvent(button)).toBe(false);
                for (const type of [
                    Gdk.EventType.TOUCH_BEGIN,
                    Gdk.EventType.TOUCH_UPDATE,
                    Gdk.EventType.TOUCH_END,
                    Gdk.EventType.TOUCH_CANCEL,
                ]) {
                    expect(isTouchEvent({ get_event_type: () => type } as unknown as Gdk.Event)).toBe(true);
                }
            });

            await it('pointerTypeOf follows the device source', async () => {
                const withSource = (source: Gdk.InputSource) =>
                    ({ get_device: () => ({ get_source: () => source }) }) as unknown as Gdk.Event;
                expect(pointerTypeOf(null)).toBe('mouse');
                expect(pointerTypeOf(withSource(Gdk.InputSource.MOUSE))).toBe('mouse');
                expect(pointerTypeOf(withSource(Gdk.InputSource.TOUCHPAD))).toBe('mouse');
                expect(pointerTypeOf(withSource(Gdk.InputSource.PEN))).toBe('pen');
                expect(pointerTypeOf(withSource(Gdk.InputSource.TOUCHSCREEN))).toBe('touch');
                expect(pointerTypeOf({ get_device: () => null } as unknown as Gdk.Event)).toBe('mouse');
            });

            await it('sequenceKey reads the native address off a boxed wrapper and is stable for one wrapper', async () => {
                // No touch input can be synthesised here, so the boxed under test is a Gdk.Rectangle:
                // GJS prints every boxed wrapper through the same function.
                const a = new Gdk.Rectangle() as unknown as Gdk.EventSequence;
                const b = new Gdk.Rectangle() as unknown as Gdk.EventSequence;
                const keyA = sequenceKey(a, true);
                expect(keyA).toMatch(/^0x[0-9a-f]+$/);
                expect(sequenceKey(a, false)).toBe(keyA);
                expect(sequenceKey(b, true)).not.toBe(keyA);
            });

            await it('sequenceKey falls back to the emulating-pointer flag when the wrapper is not legible', async () => {
                const opaque = { toString: () => '[object Object]' } as unknown as Gdk.EventSequence;
                expect(sequenceKey(opaque, true)).toBe('primary');
                expect(sequenceKey(opaque, false)).toBe('secondary');
                expect(sequenceKey(null, true)).toBe('primary');
            });

            await it('surfaceToWidget maps a surface position through the native transform and the widget tree', async () => {
                // A realized window is needed for compute_point: present, allocate, measure, destroy.
                const win = new Gtk.Window({ default_width: 300, default_height: 200, decorated: false });
                const area = new Gtk.DrawingArea({ margin_start: 30, margin_top: 20, hexpand: true, vexpand: true });
                win.set_child(area);
                win.present();
                waitFor(() => area.get_allocated_width() > 0);

                const [nativeX, nativeY] = (win as Gtk.Native).get_surface_transform();
                const [x, y] = surfaceToWidget(area, nativeX + 30 + 12.333333, nativeY + 20 + 7.5);
                // Sub-pixel input stays sub-pixel: nothing on this path rounds.
                expect(Math.abs(x - 12.333333)).toBeLessThan(1e-6);
                expect(Math.abs(y - 7.5)).toBeLessThan(1e-6);

                win.destroy();
            });
        });
    });
};
