// @gjsify/devtools — the capture says WHY it declined.
//
// Duck-typed widgets, like `widget-tree.spec.ts`: the two reasons a capture gives up
// BEFORE touching GTK are reachable from plain shapes, and they are the two that
// matter, because they are the ones a caller meets while a window is coming up.
//
// WHAT THIS CANNOT REACH, said rather than implied: `empty-snapshot` and `empty-png`
// need a realised widget and a real `Gsk.Renderer`, so they are not gated here. The
// third absence — a live video texture — turned out not to be an absence at all:
// measured on GTK 4.22.4 with `GskVulkanRenderer`, a `gtk4paintablesink` paintable in
// a `Gtk.Picture` captures at 202 645 bytes for the picture and 204 865 for its
// window, and the application it was reported against answers 308 714 with the video
// playing.

import { describe, expect, it } from '@gjsify/unit';
import type Gtk from 'gi://Gtk?version=4.0';

import { captureWidget, captureWidgetPng } from './screenshot.js';

const asWidget = (shape: object): Gtk.Widget => shape as unknown as Gtk.Widget;

/** A widget that is not realised: `get_native()` answers nothing. */
const unrealised = (): Gtk.Widget => asWidget({ get_native: () => null });

/** Realised, and the native has no renderer yet. */
const rendererless = (): Gtk.Widget => asWidget({ get_native: () => ({ get_renderer: () => null }) });

/** Realised with a renderer, and not yet allocated. */
const unallocated = (width: number, height: number): Gtk.Widget =>
    asWidget({
        get_native: () => ({ get_renderer: () => ({}) }),
        get_width: () => width,
        get_height: () => height,
    });

export default async () => {
    await describe('captureWidget', async () => {
        await it('names the missing renderer rather than answering an empty image', async () => {
            // THE REASON IS THE POINT. Before this the function answered a bare `null`
            // and the service turned that into zero bytes on the wire, which is the
            // contract for "not up yet, retry" — so every other reason arrived as an
            // empty PNG with nothing to read. One got a cause invented for it: an
            // empty reply became "the devtools cannot screenshot a live video" in a
            // consumer's README, while the same window answered 308 714 bytes.
            expect(captureWidget(unrealised())).toStrictEqual({ png: null, blocker: 'no-renderer' });
            expect(captureWidget(rendererless())).toStrictEqual({ png: null, blocker: 'no-renderer' });
        });

        await it('tells a window between two sizes apart from one that never realised', async () => {
            // The two are a different instruction to the caller: `zero-size` clears on
            // the next frame and is what the warm-up loop exists for, `no-renderer`
            // does not clear until something presents the window.
            expect(captureWidget(unallocated(0, 0))).toStrictEqual({ png: null, blocker: 'zero-size' });
            expect(captureWidget(unallocated(560, 0))).toStrictEqual({ png: null, blocker: 'zero-size' });
            expect(captureWidget(unallocated(0, 320))).toStrictEqual({ png: null, blocker: 'zero-size' });
        });

        await it('keeps captureWidgetPng answering bytes-or-null, which consumers import', async () => {
            // `index.ts` exports it and the MCP bridge calls it; the reason is additive.
            expect(captureWidgetPng(unrealised())).toBe(null);
            expect(captureWidgetPng(unallocated(0, 0))).toBe(null);
        });
    });
};
