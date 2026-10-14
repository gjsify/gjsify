// @gjsify/devtools — the capture says WHY it declined, and at WHAT scale it drew.
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
//
// The scale half needs a REAL widget and is gated on `on('Display', …)`, because
// `Gtk.WidgetPaintable.new` will not take a duck. It asserts the one number about a
// capture that cannot be faked — the PNG's own IHDR — and it is exact at monitor scale
// 1, so CI under Xvfb proves the 2× path (measured: the compositor's scale does not
// reach this capture at all, see `screenshot.ts`).

import { describe, expect, it, on } from '@gjsify/unit';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { captureWidget, captureWidgetPng, defaultCaptureScale } from './screenshot.js';
import { pngSize } from './shot.js';

const asWidget = (shape: object): Gtk.Widget => shape as unknown as Gtk.Widget;

/** Spin the main loop until `done()` or `timeoutMs`; returns whether `done()` held. */
function spinUntil(done: () => boolean, timeoutMs = 10000): boolean {
    const ctx = GLib.MainContext.default();
    const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
    // A blocking iteration waits for the NEXT event; this wakeup bounds that wait, so a
    // window that never maps fails at the deadline instead of hanging the suite.
    const wakeup = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => GLib.SOURCE_CONTINUE);
    while (!done() && GLib.get_monotonic_time() < deadline) ctx.iteration(true);
    GLib.source_remove(wakeup);
    return done();
}

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

/** Only a scale factor — everything `defaultCaptureScale` reads. */
const scaled = (factor: number): Gtk.Widget => asWidget({ get_scale_factor: () => factor });

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

    await describe('defaultCaptureScale', async () => {
        await it("takes the widget's own scale factor, which is where HiDPI comes from", async () => {
            expect(defaultCaptureScale(scaled(2))).toBe(2);
            expect(defaultCaptureScale(scaled(3))).toBe(3);
            expect(defaultCaptureScale(scaled(1))).toBe(1);
        });

        await it('reads an ABSENT answer as 1 rather than as a zero-pixel image', async () => {
            // Both shapes occur. A widget with no surface yet answers 0, and a duck
            // handed in by the specs above has no such method at all — neither is a
            // request for a 0 × 0 capture, and 1 is what this did before scaling
            // existed. A negative factor is nonsense GTK never produces, and it is in
            // here because the clamp is `> 0`, not `!== 0`.
            expect(defaultCaptureScale(scaled(0))).toBe(1);
            expect(defaultCaptureScale(scaled(-2))).toBe(1);
            expect(defaultCaptureScale(unrealised())).toBe(1);
        });
    });

    await on('Display', async () => {
        Gtk.init();

        // One window, captured at several scales. 240 × 160 is small enough to realise
        // fast and big enough that a 3× capture is still a sane PNG.
        const win = new Gtk.Window({ default_width: 240, default_height: 160 });
        win.set_child(new Gtk.Label({ label: 'devtools scale spec', hexpand: true, vexpand: true }));
        win.present();
        const widget = win as unknown as Gtk.Widget;
        spinUntil(() => captureWidget(widget).png !== null);

        const sizeAt = (scale?: number): { width: number; height: number } | null => {
            const png = captureWidgetPng(widget, scale === undefined ? {} : { scale });
            return png ? pngSize(png) : null;
        };

        await describe('captureWidget on a real window — the scale reaches the pixels', async () => {
            await it('captures at all, so the assertions below are about size and not about failure', async () => {
                expect(sizeAt(1)).not.toBeNull();
            });

            await it('multiplies BOTH dimensions by the scale, exactly', async () => {
                // The IHDR, not the requested size: `shot.ts` exists because a window
                // reports back the size it was ASKED for whether or not it honoured it.
                // Exactness is the point — a transform that was applied to the viewport
                // but not to the snapshot would still produce a larger image, with the
                // content in a corner of it, and only a non-exact multiple would show.
                const one = sizeAt(1)!;
                expect(one.width).toBeGreaterThan(0);
                for (const scale of [2, 3]) {
                    const bigger = sizeAt(scale)!;
                    expect(bigger.width).toBe(one.width * scale);
                    expect(bigger.height).toBe(one.height * scale);
                }
            });

            await it('draws MORE than it did at 1×, so the bigger image is not padding', async () => {
                // A 2× PNG four times the pixels could be a 1× capture on a larger
                // canvas; a re-rasterised one carries detail an upscale cannot invent, and
                // the cheap witness for that is the compressed size. Measured here the 2×
                // file runs ~2–3× the 1× file. The threshold is deliberately slack: the
                // sharpness measurement proper (Laplacian variance, 5–7× against a bicubic
                // upscale) is in `screenshot.ts`'s doc comment, and pinning a ratio from a
                // font-dependent render would fail on a runner with different fonts.
                const one = captureWidgetPng(widget, { scale: 1 })!;
                const two = captureWidgetPng(widget, { scale: 2 })!;
                expect(two.byteLength).toBeGreaterThan(one.byteLength);
            });

            await it("defaults to the widget's factor, and an explicit scale overrides it", async () => {
                // On an unscaled runner the default IS 1×, so this cannot prove the
                // default is "the factor" by size alone — `defaultCaptureScale` above
                // proves that. What it pins here is that the default path and the
                // override path agree when they ask for the same thing, which is the
                // regression an `options.scale ?? …` mix-up would break.
                const factor = defaultCaptureScale(widget);
                expect(sizeAt(undefined)).toStrictEqual(sizeAt(factor));
                expect(sizeAt(0)).toStrictEqual(sizeAt(factor));
            });
        });

        win.destroy();
    });
};
