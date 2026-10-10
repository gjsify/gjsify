// The gutter paint vectors (ADR 0103 decisions 3 and 4): what a renderer is asked, when, and how often.
// The ORACLE runs them on real `gi://GtkSource` in a window; a port runs them in the DOM. A pass needs
// pixels, so the NativeScript door (no device here) runs only the vectors that do not `paints`.

import type { GtkSourceViewSurfaceLike, GutterLike, GutterRendererLike, ViewLike } from './view-vectors.js';

/** The `GtkSource.GutterLines` members a renderer reads in `vfunc_query_data`. */
export interface GutterLinesLike {
    get_first(): number;
    get_last(): number;
    is_cursor(line: number): boolean;
}

/** The slice of `GObject` a registered renderer subclass uses. */
export interface GObjectLike {
    registerClass<T>(meta: object, klass: T): T;
    ParamSpec: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        uint(name: string, nick: string, blurb: string, flags: any, min: number, max: number, def: number): unknown;
    };
    ParamFlags: { READWRITE: unknown };
}

/** Where a pass happens: a window with a main loop on GJS, the document on the web. */
export interface GutterPaintHarness {
    /** Puts `view` where it is painted and resolves once its first pass has run. */
    present(view: ViewLike): Promise<void>;
    /** Resolves once the repaint a `queue_draw` asked for would have run. */
    settle(): Promise<void>;
}

export interface GutterPaintSurface extends GtkSourceViewSurfaceLike {
    GObject: GObjectLike;
}

export interface GutterPaintVector {
    readonly rule: string;
    /** Needs a painted pass, so a door without pixels skips it. */
    readonly paints: boolean;
    /** `Class.vfunc_name` entries of `UNLOCKED_VFUNCS` this vector proves against GJS. */
    readonly unlocks?: readonly string[];
    readonly observe: (ns: GutterPaintSurface, harness: GutterPaintHarness) => Promise<unknown>;
    readonly shows: unknown;
}

const LEFT = 3;
const RIGHT = 4;
let serial = 0;

interface Query {
    line: number;
    first: number;
    last: number;
    cursor: boolean;
}

/** A renderer that records each `vfunc_query_data` and shows `#<line>`. */
function recording(ns: GutterPaintSurface): { renderer: GutterRendererLike; queries: Query[] } {
    const queries: Query[] = [];
    class Recorder extends (ns.GtkSource.GutterRendererText as new (properties?: object) => GutterRendererLike) {
        vfunc_query_data(lines: GutterLinesLike, line: number): void {
            queries.push({
                line,
                first: lines.get_first(),
                last: lines.get_last(),
                cursor: lines.is_cursor(line),
            });
            this.text = `#${line}`;
        }
    }
    const Registered = ns.GObject.registerClass({ GTypeName: `GoVecRecorder${++serial}` }, Recorder);
    return { renderer: new Registered({ width_request: 40 }), queries };
}

/** The lines of the first pass: up to the first line a second pass asks for again. */
function firstPass(queries: readonly Query[]): number[] {
    const seen: number[] = [];
    for (const query of queries) {
        if (seen.includes(query.line)) break;
        seen.push(query.line);
    }
    return seen;
}

async function shown(ns: GutterPaintSurface, harness: GutterPaintHarness, text: string, position = 0, side = LEFT) {
    const view = new ns.GtkSource.View();
    view.buffer.text = text;
    const gutter = view.get_gutter(side) as GutterLike;
    const { renderer, queries } = recording(ns);
    gutter.insert(renderer, position);
    await harness.present(view);
    return { view, gutter, renderer, queries };
}

/** A renderer class with a declared property, as an app writes one. */
function numbered(ns: GutterPaintSurface) {
    class Numbered extends (ns.GtkSource.GutterRendererText as new (properties?: object) => GutterRendererLike) {
        declare private stored: number | undefined;
        seen: [number, string | null][] = [];
        get start_value(): number {
            return this.stored ?? 0;
        }
        set start_value(value: number) {
            this.stored = value;
            this.queue_draw();
        }
        vfunc_query_data(_lines: GutterLinesLike, line: number): void {
            this.text = String(this.start_value + line);
            this.seen.push([line, this.text]);
        }
    }
    const { ParamSpec, ParamFlags } = ns.GObject;
    return ns.GObject.registerClass(
        {
            GTypeName: `GoVecNumbered${++serial}`,
            Properties: { 'start-value': ParamSpec.uint('start-value', '', '', ParamFlags.READWRITE, 0, 1000, 0) },
        },
        Numbered,
    );
}

export const GUTTER_PAINT_VECTORS: readonly GutterPaintVector[] = [
    {
        rule: 'the RIGHT gutter asks its renderers per visible line, with the visible range and the cursor line',
        paints: true,
        async observe(ns, harness) {
            const { queries } = await shown(ns, harness, 'a\nb\nc', 0, RIGHT);
            const right = queries.slice(0, firstPass(queries).length);
            return { right: right.map((query) => query.line), cursor: right.map((query) => query.cursor) };
        },
        shows: { right: [0, 1, 2], cursor: [false, false, true] },
    },
    {
        rule: 'vfunc_query_data runs once per visible line, in order, with the visible range and the cursor line',
        paints: true,
        unlocks: ['GtkSource.GutterRenderer.vfunc_query_data'],
        async observe(ns, harness) {
            const { queries } = await shown(ns, harness, 'a\nb\nc');
            const first = queries.slice(0, firstPass(queries).length);
            return {
                lines: first.map((query) => query.line),
                range: [first[0]?.first, first[0]?.last],
                cursor: first.map((query) => query.cursor),
            };
        },
        shows: { lines: [0, 1, 2], range: [0, 2], cursor: [false, false, true] },
    },
    {
        rule: 'queue_draw on the renderer and on the gutter, however often, costs one more pass',
        paints: true,
        async observe(ns, harness) {
            const { renderer, gutter, queries } = await shown(ns, harness, 'a\nb\nc');
            await harness.settle();
            queries.length = 0;
            renderer.queue_draw();
            renderer.queue_draw();
            gutter.queue_draw();
            await harness.settle();
            return queries.map((query) => query.line);
        },
        shows: [0, 1, 2],
    },
    {
        rule: 'a removed renderer is asked nothing more',
        paints: true,
        async observe(ns, harness) {
            const { renderer, gutter, queries } = await shown(ns, harness, 'a\nb\nc');
            await harness.settle();
            gutter.remove(renderer);
            queries.length = 0;
            gutter.queue_draw();
            await harness.settle();
            return queries.length;
        },
        shows: 0,
    },
    {
        rule: 'a registered GutterRendererText subclass keeps its declared property and sets its text in query_data',
        paints: true,
        async observe(ns, harness) {
            const Numbered = numbered(ns);
            const view = new ns.GtkSource.View();
            view.buffer.text = 'a\nb';
            const renderer = new Numbered({ start_value: 16, width_request: 30 }) as GutterRendererLike & {
                start_value: number;
                seen: [number, string | null][];
            };
            (view.get_gutter(LEFT) as GutterLike).insert(renderer, 0);
            await harness.present(view);
            const before = renderer.seen.slice(0, 2);
            renderer.start_value = 100;
            renderer.seen = [];
            await harness.settle();
            return { before, after: renderer.seen.slice(0, 2), width: renderer.width_request };
        },
        shows: {
            before: [
                [0, '16'],
                [1, '17'],
            ],
            after: [
                [0, '100'],
                [1, '101'],
            ],
            width: 30,
        },
    },
    {
        rule: 'a registered GutterRendererText subclass is a renderer with its property and widget properties set',
        paints: false,
        async observe(ns) {
            const Numbered = numbered(ns);
            const renderer = new Numbered({
                start_value: 7,
                margin_start: 3,
                width_request: 20,
            }) as GutterRendererLike & {
                start_value: number;
            };
            return [
                renderer instanceof ns.GtkSource.GutterRendererText,
                renderer.start_value,
                renderer.margin_start,
                renderer.text,
            ];
        },
        shows: [true, 7, 3, null],
    },
];
