// The Canvas2DBridge size and resize contract (ADR 0107), as vectors a door runs against itself.
//
// GJS is the ORACLE: `conformance.gjs.spec.ts` runs these against the real `Gtk.DrawingArea`
// widget, so a vector that fails there is a wrong vector. The browser runs the same vectors
// against `<gjsify-canvas2d-bridge>`. The vectors pin what an app relies on, not the platform's
// internals: the notification ORDER between the DOM event, the `resize` signal and `onResize`
// is deliberately unpinned, because GTK emits its inherited signal from inside the allocation.
//
// ALSO UNPINNED, found by running the oracle: GTK compares the canvas size with the allocation on
// EVERY draw, so an app that sized the canvas itself has it reset (and `resize` fired) by the next
// `queue_draw()`. The browser and NativeScript doors compare with the previous ALLOCATION only,
// so such a size survives there. ADR 0107 records the deviation.

export interface Canvas2DCanvasLike {
    width: number;
    height: number;
    addEventListener(type: 'resize', listener: () => void): void;
}

export interface Canvas2DBridgeLike {
    readonly canvas: Canvas2DCanvasLike | null;
    getContext(id: '2d'): unknown;
    onReady(cb: (canvas: Canvas2DCanvasLike, ctx: unknown) => void): void;
    onResize(cb: (width: number, height: number) => void): void;
    // biome-ignore lint/suspicious/noExplicitAny: GJS and the DOM element type the handler differently
    connect(signal: 'resize', handler: (...args: any[]) => unknown): number;
}

export interface Canvas2DSubject {
    name: string;
    create(): Canvas2DBridgeLike;
    /**
     * Give the bridge an allocation of `width` x `height` LOGICAL pixels and wait until the toolkit
     * has delivered it. Allocating the size it already has must still let a pending draw happen.
     */
    allocate(bridge: Canvas2DBridgeLike, width: number, height: number): Promise<void>;
}

export interface Canvas2DVector {
    row: string;
    rule: string;
    observe(subject: Canvas2DSubject): Promise<unknown>;
    shows: unknown;
}

type Size = [number, number];

export const CANVAS2D_VECTORS: readonly Canvas2DVector[] = [
    {
        row: 'size-1',
        rule: 'there is no canvas and no context before the first allocation',
        observe: async (subject) => {
            const bridge = subject.create();
            return { canvas: bridge.canvas, context: bridge.getContext('2d') };
        },
        shows: { canvas: null, context: null },
    },
    {
        row: 'size-2',
        rule: 'the canvas is created at the allocation in logical pixels and a queued onReady runs once',
        observe: async (subject) => {
            const bridge = subject.create();
            const ready: Size[] = [];
            bridge.onReady((canvas) => ready.push([canvas.width, canvas.height]));
            await subject.allocate(bridge, 32, 24);
            await subject.allocate(bridge, 32, 24);
            return {
                ready,
                canvas: [bridge.canvas!.width, bridge.canvas!.height],
                context: bridge.getContext('2d') !== null,
            };
        },
        shows: { ready: [[32, 24]], canvas: [32, 24], context: true },
    },
    {
        row: 'size-3',
        rule: 'onReady after the context exists runs synchronously',
        observe: async (subject) => {
            const bridge = subject.create();
            await subject.allocate(bridge, 16, 16);
            let ran = false;
            bridge.onReady(() => {
                ran = true;
            });
            return ran;
        },
        shows: true,
    },
    {
        row: 'size-4',
        rule: 'an allocation change resizes the canvas BEFORE the DOM event, the signal and onResize, each once',
        observe: async (subject) => {
            const bridge = subject.create();
            await subject.allocate(bridge, 32, 32);
            const dom: Size[] = [];
            const signal: Size[] = [];
            const callback: Size[] = [];
            const canvas = bridge.canvas!;
            canvas.addEventListener('resize', () => dom.push([canvas.width, canvas.height]));
            bridge.connect('resize', (...args: unknown[]) => {
                const [w, h] = args.slice(-2) as Size;
                signal.push([w, h]);
            });
            bridge.onResize((w, h) => callback.push([w, h]));
            await subject.allocate(bridge, 48, 16);
            return { dom, signal, callback };
        },
        shows: { dom: [[48, 16]], signal: [[48, 16]], callback: [[48, 16]] },
    },
];

export async function driveCanvas2DVectors(
    subject: Canvas2DSubject,
    harness: {
        describe: (name: string, fn: () => Promise<void> | void) => unknown;
        it: (name: string, fn: () => Promise<void> | void) => unknown;
        expect: (value: unknown) => { toBe(expected: unknown): void };
    },
    vectors: readonly Canvas2DVector[] = CANVAS2D_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: Canvas2DBridge size and resize`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = await vector.observe(subject);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
