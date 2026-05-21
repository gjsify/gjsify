// Tests for the ResizeObserver polyfill + the bridge ↔ DOM resize pipeline.
// Locks in the fix for `docs/reports/webgl-bridge-resize-observer.md` —
// without this, `Excalibur.js`'s `DisplayMode.FillContainer` never sees
// GTK widget resizes and the rendered world stays at its initial
// resolution.
//
// Cross-platform: uses only DOM polyfill primitives (no GTK), so the
// same suite runs under Node + GJS.

import { describe, it, expect } from '@gjsify/unit';

import { HTMLCanvasElement, ResizeObserver, document, notifyElementResize } from '@gjsify/dom-elements';
import type { ResizeObserverEntry } from '@gjsify/dom-elements';

// Microtask flush helper. ResizeObserver batches entries into a microtask
// (matching the spec's "deliver resize loop notifications" cycle), so
// tests have to await a microtask round-trip between an enqueue and the
// callback firing. Three awaits cover: the enqueue's own microtask, the
// observe()-initial-measurement microtask, and the flush dispatch.
async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 3; i++) await Promise.resolve();
}

export default async () => {

    await describe('ResizeObserver', async () => {

        await it('fires on direct notifyElementResize(target)', async () => {
            const canvas = new HTMLCanvasElement();
            let fired = 0;
            let lastWidth = 0;
            let lastHeight = 0;

            const observer = new ResizeObserver((entries: ResizeObserverEntry[]) => {
                for (const entry of entries) {
                    if (entry.target === canvas) {
                        fired++;
                        lastWidth = entry.contentRect.width;
                        lastHeight = entry.contentRect.height;
                    }
                }
            });
            observer.observe(canvas);

            // Initial measurement fires once with the canvas's current dimensions.
            await flushMicrotasks();
            expect(fired).toBeGreaterThan(0);
            const initialFired = fired;

            notifyElementResize(canvas, 800, 600);
            await flushMicrotasks();
            expect(fired).toBe(initialFired + 1);
            expect(lastWidth).toBe(800);
            expect(lastHeight).toBe(600);

            observer.disconnect();
        });

        await it('fires for observers on an ancestor when a descendant resizes', async () => {
            // Excalibur.js's actual usage: observe(canvas.parentElement) (i.e.
            // document.body), then dispatch the resize on the canvas. Both
            // observations have to fire.
            const canvas = new HTMLCanvasElement();
            document.body.appendChild(canvas);

            let bodyFired = 0;
            let bodyWidth = 0;
            const bodyObserver = new ResizeObserver((entries: ResizeObserverEntry[]) => {
                for (const entry of entries) {
                    if (entry.target === document.body) {
                        bodyFired++;
                        bodyWidth = entry.contentRect.width;
                    }
                }
            });
            bodyObserver.observe(document.body);

            await flushMicrotasks();
            const initialBodyFired = bodyFired;

            // Bridge fires its GTK 'resize' signal → notify on the canvas.
            notifyElementResize(canvas, 1024, 768);
            await flushMicrotasks();
            expect(bodyFired).toBe(initialBodyFired + 1);
            expect(bodyWidth).toBe(1024);

            bodyObserver.disconnect();
            document.body.removeChild(canvas);
        });

        await it('stops firing after unobserve()', async () => {
            const canvas = new HTMLCanvasElement();
            let fired = 0;
            const observer = new ResizeObserver(() => { fired++; });
            observer.observe(canvas);
            await flushMicrotasks();
            const initialFired = fired;

            observer.unobserve(canvas);
            notifyElementResize(canvas, 500, 500);
            await flushMicrotasks();
            expect(fired).toBe(initialFired);

            observer.disconnect();
        });

        await it('stops firing after disconnect()', async () => {
            const canvas = new HTMLCanvasElement();
            let fired = 0;
            const observer = new ResizeObserver(() => { fired++; });
            observer.observe(canvas);
            await flushMicrotasks();
            const initialFired = fired;

            observer.disconnect();
            notifyElementResize(canvas, 500, 500);
            await flushMicrotasks();
            expect(fired).toBe(initialFired);
        });

        await it('observe(same target twice) is idempotent', async () => {
            const canvas = new HTMLCanvasElement();
            let fired = 0;
            const observer = new ResizeObserver(() => { fired++; });
            observer.observe(canvas);
            observer.observe(canvas);
            await flushMicrotasks();
            // Even with two observe() calls we should get one initial entry,
            // not two — same target collapses.
            const initialFired = fired;

            notifyElementResize(canvas, 200, 100);
            await flushMicrotasks();
            expect(fired).toBe(initialFired + 1);

            observer.disconnect();
        });

        await it('two independent observers on the same target both fire', async () => {
            const canvas = new HTMLCanvasElement();
            let firedA = 0;
            let firedB = 0;
            const a = new ResizeObserver(() => { firedA++; });
            const b = new ResizeObserver(() => { firedB++; });
            a.observe(canvas);
            b.observe(canvas);
            await flushMicrotasks();
            const initialA = firedA;
            const initialB = firedB;

            notifyElementResize(canvas, 320, 240);
            await flushMicrotasks();
            expect(firedA).toBe(initialA + 1);
            expect(firedB).toBe(initialB + 1);

            a.disconnect();
            // After A disconnects, B keeps firing.
            const beforeSecond = firedB;
            notifyElementResize(canvas, 321, 241);
            await flushMicrotasks();
            expect(firedA).toBe(initialA + 1);
            expect(firedB).toBe(beforeSecond + 1);

            b.disconnect();
        });

        await it('callback receives an entry with target + contentRect + box sizes', async () => {
            const canvas = new HTMLCanvasElement();
            let captured: ResizeObserverEntry | null = null;
            const observer = new ResizeObserver((entries) => { captured = entries[0]; });
            observer.observe(canvas);
            await flushMicrotasks();

            notifyElementResize(canvas, 640, 480);
            await flushMicrotasks();

            expect(captured).toBeDefined();
            // Use a non-null local because TS narrowing through `captured` would
            // require a null guard at every property access; biome rule
            // `noNonNullAssertion` is disabled in test files for this reason.
            const entry = captured as unknown as ResizeObserverEntry;
            expect(entry.target).toBe(canvas as unknown as object);
            expect(entry.contentRect.width).toBe(640);
            expect(entry.contentRect.height).toBe(480);
            expect(entry.contentRect.right).toBe(640);
            expect(entry.contentRect.bottom).toBe(480);
            expect(entry.contentBoxSize[0].inlineSize).toBe(640);
            expect(entry.contentBoxSize[0].blockSize).toBe(480);
            expect(entry.borderBoxSize[0].inlineSize).toBe(640);
            expect(entry.devicePixelContentBoxSize[0].inlineSize).toBe(640);

            observer.disconnect();
        });

        await it('a synchronous resize burst batches into a single callback', async () => {
            // Spec: each observation cycle delivers ONE callback per observer,
            // with the LATEST size for each target. Confirms the microtask
            // batching collapses storms.
            const canvas = new HTMLCanvasElement();
            let callbackInvocations = 0;
            let lastWidth = 0;
            const observer = new ResizeObserver((entries) => {
                callbackInvocations++;
                for (const entry of entries) {
                    if (entry.target === canvas) lastWidth = entry.contentRect.width;
                }
            });
            observer.observe(canvas);
            await flushMicrotasks();
            const initialInvocations = callbackInvocations;

            // Five synchronous notifies → one batched delivery.
            notifyElementResize(canvas, 100, 100);
            notifyElementResize(canvas, 200, 100);
            notifyElementResize(canvas, 300, 100);
            notifyElementResize(canvas, 400, 100);
            notifyElementResize(canvas, 500, 100);
            await flushMicrotasks();

            expect(callbackInvocations).toBe(initialInvocations + 1);
            expect(lastWidth).toBe(500);

            observer.disconnect();
        });

    });

};
