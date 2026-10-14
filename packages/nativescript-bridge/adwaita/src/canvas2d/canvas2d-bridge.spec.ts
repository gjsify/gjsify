// `Canvas2DBridge` for NativeScript, built as the REAL class against the platform double. Off a
// device the native driver is the refusing stub, so the allocation the Android layout listener
// would report is fed in by hand: what is asserted is the GJS widget's size and resize contract.

import { describe, expect, it } from '@gjsify/unit';

import { templateClassFor } from '../builder/template-classes.js';
import { Canvas2DBridge } from './canvas2d-bridge.js';
import { createNativeCanvasDriver } from './native-canvas.js';

const allocate = (bridge: Canvas2DBridge, w: number, h: number) =>
    (bridge as unknown as { allocated(w: number, h: number): void }).allocated(w, h);

export const Canvas2DBridgeNsTest = async () => {
    await describe('Canvas2DBridge (NativeScript)', async () => {
        await it('registers as the template class $GjsifyCanvas2DBridge', () => {
            expect(templateClassFor('GjsifyCanvas2DBridge')).toBe(Canvas2DBridge);
            expect(Canvas2DBridge.GTypeName).toBe('GjsifyCanvas2DBridge');
        });

        await it('has no canvas and no context before the first allocation', () => {
            const bridge = new Canvas2DBridge();
            expect(bridge.canvas).toBeNull();
            expect(bridge.getContext('2d')).toBeNull();
        });

        await it('creates the canvas at the allocation and runs onReady once, queued or not', () => {
            const bridge = new Canvas2DBridge();
            const seen: string[] = [];
            bridge.onReady((canvas) => seen.push(`queued ${canvas.width}x${canvas.height}`));
            allocate(bridge, 32, 32);
            bridge.onReady((canvas) => seen.push(`late ${canvas.width}x${canvas.height}`));
            allocate(bridge, 32, 32);
            expect(JSON.stringify(seen)).toBe(JSON.stringify(['queued 32x32', 'late 32x32']));
            expect(bridge.getContext('2d')).not.toBeNull();
        });

        await it('does not resync the size while the allocation is unchanged', () => {
            const bridge = new Canvas2DBridge();
            allocate(bridge, 32, 32);
            bridge.canvas!.width = 8;
            allocate(bridge, 32, 32);
            expect(bridge.canvas!.width).toBe(8);
        });

        await it('on a change resizes the canvas, then fires the DOM event, the signal and onResize', () => {
            const bridge = new Canvas2DBridge();
            allocate(bridge, 32, 32);
            const order: string[] = [];
            bridge.canvas!.addEventListener('resize', () => order.push(`dom ${bridge.canvas!.width}`));
            bridge.connect('resize', (_self, w, h) => order.push(`signal ${w}x${h}`));
            bridge.onResize((w, h) => order.push(`callback ${w}x${h}`));
            allocate(bridge, 48, 16);
            expect(JSON.stringify(order)).toBe(JSON.stringify(['dom 48', 'signal 48x16', 'callback 48x16']));
        });

        await it('disconnects a handler by id and refuses an unknown signal or id', () => {
            const bridge = new Canvas2DBridge();
            const id = bridge.connect('resize', () => {});
            bridge.disconnect(id);
            expect(() => bridge.disconnect(id)).toThrow();
            expect(() => bridge.connect('draw', () => {})).toThrow('no signal');
        });

        await it('maps content-width/height onto the minimum size, in both spellings', () => {
            const bridge = new Canvas2DBridge();
            bridge.contentWidth = 64;
            bridge.content_height = 32;
            expect(bridge.content_width).toBe(64);
            expect(bridge.contentHeight).toBe(32);
        });

        await it('takes its driver from native-canvas, the file a platform variant replaces', () => {
            // Declared there, not re-exported: the library build would resolve a re-export past it.
            expect(typeof createNativeCanvasDriver).toBe('function');
            expect(createNativeCanvasDriver.length).toBe(0);
        });

        await it('refuses to create a native view off Android', () => {
            expect(() => new Canvas2DBridge().createNativeView()).toThrow('Platform not supported');
        });
    });
};
