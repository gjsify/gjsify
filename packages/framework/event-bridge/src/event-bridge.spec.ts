// GJS-only regression tests for @gjsify/event-bridge.
//
// These verify the handlers keep their contract with GTK4 event controllers.
// The primary target is the `motion` handler: after the PR #17 fix it must
// read widget-local coords from the signal callback args, NOT from the
// surface-local `controller.get_current_event().get_position()` pathway.
// The coord-frame mismatch caused a visible drag-jump on first move after
// click in the pixel-rpg/map-editor consumer.
//
// Requires a GTK display (the CI workflow wraps tests in `xvfb-run`).

import { describe, it, expect, on } from '@gjsify/unit';

import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';

import { attachEventControllers } from './event-bridge.js';

// Minimal stub that records dispatched events.
function makeFakeCanvas() {
    const events: any[] = [];
    const el = {
        events,
        dispatchEvent(e: any): boolean {
            events.push(e);
            return true;
        },
    };
    return el;
}

function getMotionController(widget: Gtk.Widget): Gtk.EventControllerMotion | null {
    const list = widget.observe_controllers();
    for (let i = 0; i < list.get_n_items(); i++) {
        const ctrl = list.get_item(i);
        if (ctrl instanceof Gtk.EventControllerMotion) {
            return ctrl;
        }
    }
    return null;
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

                attachEventControllers(widget, () => canvas as any);
                allocateWidget(widget, 400, 300);

                const motionCtrl = getMotionController(widget);
                expect(motionCtrl).not.toBeNull();

                // Emit the signal with explicit widget-local coords. If the
                // implementation regressed to `controller.get_current_event()`
                // there is no event bound to this synthetic emission and the
                // handler would produce different values than 42/17.
                motionCtrl!.emit('motion', 42, 17);

                const moveEvents = canvas.events.filter((e: any) => e.type === 'pointermove');
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

                attachEventControllers(widget, () => canvas as any);
                allocateWidget(widget, 400, 300);

                getMotionController(widget)!.emit('motion', 100, 50);

                const mousemoveEvents = canvas.events.filter((e: any) => e.type === 'mousemove');
                expect(mousemoveEvents.length).toBe(1);
                expect(mousemoveEvents[0].clientX).toBe(100);
                expect(mousemoveEvents[0].clientY).toBe(50);
            });

            await it('clamps coords outside the widget allocation', async () => {
                const widget = new Gtk.DrawingArea();
                const canvas = makeFakeCanvas();

                attachEventControllers(widget, () => canvas as any);
                allocateWidget(widget, 400, 300);

                // Negative + above-allocation coords should be clamped to
                // [0, allocW]×[0, allocH] — protects consumers against
                // out-of-range values GTK sometimes reports at widget edges.
                getMotionController(widget)!.emit('motion', -5, 999);

                const moveEvents = canvas.events.filter((e: any) => e.type === 'pointermove');
                expect(moveEvents.length).toBe(1);
                const ev = moveEvents[0];
                expect(ev.clientX).toBe(0);
                expect(ev.clientY).toBe(300);
            });

            await it('tracks movementX/movementY across successive motions', async () => {
                const widget = new Gtk.DrawingArea();
                const canvas = makeFakeCanvas();

                attachEventControllers(widget, () => canvas as any);
                allocateWidget(widget, 400, 300);

                const motionCtrl = getMotionController(widget)!;
                motionCtrl.emit('motion', 10, 20);
                motionCtrl.emit('motion', 13, 25);

                const moveEvents = canvas.events.filter((e: any) => e.type === 'pointermove');
                expect(moveEvents.length).toBe(2);
                expect(moveEvents[1].movementX).toBe(3);
                expect(moveEvents[1].movementY).toBe(5);
            });
        });
    });
};
