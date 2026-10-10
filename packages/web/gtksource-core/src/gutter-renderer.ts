// GtkSource.Gutter, GutterRenderer and GutterRendererText — the columns beside a view's text.
//
// A TRUE SUBSET of GtkSourceView 5: names, defaults and return values are GtkSource's, read off the
// typelib (`view-vectors.ts` runs them against it). A renderer is a GtkWidget there; here it is a
// `GObject.Object` holding the widget properties an app sets on it, so `GObject.registerClass` works on
// a subclass (ADR 0103 amendment). This model owns WHICH renderers sit in which gutter and in what
// order, and tells its listener (the editor session) when a column needs painting; the session asks
// each renderer's `vfunc_query_data` for every visible line and a platform driver paints the answer.

import { GIR_TYPE, GObjectObject } from '@gjsify/adwaita-core';

import type { Buffer } from './buffer.js';

/** `Gtk.TextWindowType`: the two sides that carry a gutter. */
export const WINDOW_LEFT = 3;
export const WINDOW_RIGHT = 4;

// [snake_case, camelCase, default]: the GtkWidget properties GutterRenderer inherits and apps set.
const WIDGET_PROPERTIES = [
    ['margin_start', 'marginStart', 0],
    ['margin_end', 'marginEnd', 0],
    ['width_request', 'widthRequest', -1],
    ['focusable', 'focusable', false],
    ['focus_on_click', 'focusOnClick', true],
] as const;

type WidgetPropertyName = (typeof WIDGET_PROPERTIES)[number][0];

const WIDGET_NAMES: ReadonlySet<string> = new Set(WIDGET_PROPERTIES.map(([name]) => name));

export interface GutterRendererProperties {
    margin_start?: number;
    margin_end?: number;
    width_request?: number;
    focusable?: boolean;
    focus_on_click?: boolean;
}

export interface GutterRendererTextProperties extends GutterRendererProperties {
    text?: string | null;
    markup?: string | null;
}

/** GObject accepts `margin_start`, `margin-start` and `marginStart` for one property. */
function snakeCase(name: string): string {
    return name.replace(/-/g, '_').replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** The first `length` UTF-8 bytes of `text`, cut on a character, as `set_text(text, length)` takes. */
function byteSlice(text: string, length: number): string {
    if (length < 0) return text;
    let bytes = 0;
    let end = 0;
    for (const character of text) {
        const code = character.codePointAt(0) as number;
        const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
        if (bytes + size > length) break;
        bytes += size;
        end += character.length;
    }
    return text.slice(0, end);
}

/** What a renderer holds. A WeakMap, not fields: a registered subclass's properties are set inside `super()`. */
interface RendererState {
    owner: Gutter | null;
    widget: Map<WidgetPropertyName, number | boolean>;
}

const STATES = new WeakMap<object, RendererState>();

function stateOf(renderer: object): RendererState {
    let state = STATES.get(renderer);
    if (state === undefined) {
        state = { owner: null, widget: new Map(WIDGET_PROPERTIES.map(([name, , fallback]) => [name, fallback])) };
        STATES.set(renderer, state);
    }
    return state;
}

export abstract class GutterRenderer extends GObjectObject {
    static [GIR_TYPE] = 'GtkSource.GutterRenderer';

    declare margin_start: number;
    declare marginStart: number;
    declare margin_end: number;
    declare marginEnd: number;
    declare width_request: number;
    declare widthRequest: number;
    declare focusable: boolean;
    declare focus_on_click: boolean;
    declare focusOnClick: boolean;

    /** Widget properties are held here; every other key is a property a registered subclass declares. */
    constructor(properties: GutterRendererProperties & Record<string, unknown> = {}) {
        const widget: Record<string, unknown> = {};
        const declared: Record<string, unknown> = {};
        for (const [name, value] of Object.entries(properties)) {
            (WIDGET_NAMES.has(snakeCase(name)) ? widget : declared)[name] = value;
        }
        super(declared);
        if (new.target === (GutterRenderer as unknown)) {
            throw new TypeError('Cannot instantiate abstract type GtkSourceGutterRenderer');
        }
        for (const [name, value] of Object.entries(widget)) (this as Record<string, unknown>)[name] = value;
    }

    /** The view of the gutter this renderer sits in, `null` while it sits in none. */
    get_view(): object | null {
        return stateOf(this).owner?.get_view() ?? null;
    }
    get view(): object | null {
        return this.get_view();
    }

    /** Asks the gutter to repaint this column; the driver paints once per task however often this is called. */
    queue_draw(): void {
        stateOf(this).owner?.queue_draw();
    }

    /** @internal Set by `Gutter.insert` and `remove`; not part of GtkSource. */
    attach(gutter: Gutter | null): void {
        stateOf(this).owner = gutter;
    }

    /** @internal The held widget properties, for the driver that sizes the column. */
    widgetProperty(name: WidgetPropertyName, value?: number | boolean): number | boolean {
        const state = stateOf(this);
        if (value !== undefined && state.widget.get(name) !== value) {
            state.widget.set(name, value);
            state.owner?.queue_draw();
        }
        return state.widget.get(name) as number | boolean;
    }
}

for (const [snake, camel] of WIDGET_PROPERTIES) {
    for (const name of new Set([snake, camel])) {
        Object.defineProperty(GutterRenderer.prototype, name, {
            get(this: GutterRenderer) {
                return this.widgetProperty(snake);
            },
            set(this: GutterRenderer, value: number | boolean) {
                this.widgetProperty(snake, value);
            },
            enumerable: true,
        });
    }
}

/** A renderer that shows one string. `text` and `markup` replace each other, as in GtkSource. */
export class GutterRendererText extends GutterRenderer {
    // Declared, not initialised: a field initialiser would run after `super` and wipe what it set.
    declare private plain: string | null | undefined;
    declare private marked: string | null | undefined;

    constructor(properties: GutterRendererTextProperties & Record<string, unknown> = {}) {
        const { text, markup, ...widget } = properties;
        super(widget);
        if (text !== undefined) this.text = text;
        if (markup !== undefined) this.markup = markup;
    }

    get text(): string | null {
        return this.plain ?? null;
    }
    set text(value: string | null) {
        this.plain = value;
        this.marked = null;
    }

    get markup(): string | null {
        return this.marked ?? null;
    }
    set markup(value: string | null) {
        this.marked = value;
        this.plain = null;
    }

    /** `length` counts bytes, `-1` takes the whole string. */
    set_text(text: string, length: number): void {
        this.text = byteSlice(text, length);
    }
    set_markup(markup: string, length: number): void {
        this.markup = byteSlice(markup, length);
    }
}

/**
 * `GtkSource.GutterLines`, the subset a renderer reads in `vfunc_query_data`: the visible range and
 * where the cursor is. The rest (`add_class`, `get_line_yrange` …) is absent.
 */
export class GutterLines {
    constructor(
        private readonly owner: object,
        private readonly text: Buffer,
        private readonly first: number,
        private readonly last: number,
    ) {}

    get_first(): number {
        return this.first;
    }
    get_last(): number {
        return this.last;
    }
    get_buffer(): Buffer {
        return this.text;
    }
    get_view(): object {
        return this.owner;
    }
    is_cursor(line: number): boolean {
        return this.text.lineOfOffset(this.text.cursorPosition) === line;
    }
}

/** Heard by the editor session: a column was added, moved, resized or asked to repaint. */
export type GutterListener = (gutter: Gutter) => void;

/** Asked before a renderer joins a gutter; throws when no driver paints that side. */
export type GutterGuard = (gutter: Gutter) => void;

export class Gutter {
    private readonly placed: { renderer: GutterRenderer; position: number }[] = [];

    constructor(
        private readonly owner: object,
        readonly window_type: number,
        private readonly listener: GutterListener = () => {},
        private readonly guard: GutterGuard = () => {},
    ) {}

    get_view(): object {
        return this.owner;
    }
    get view(): object {
        return this.owner;
    }

    /** Claims `renderer` at `position` (lower is nearer the left); `false` when another gutter holds it. */
    insert(renderer: GutterRenderer, position: number): boolean {
        if (renderer.get_view() !== null) return false;
        this.guard(this);
        renderer.attach(this);
        this.placed.push({ renderer, position });
        this.sort();
        this.queue_draw();
        return true;
    }

    remove(renderer: GutterRenderer): void {
        const at = this.placed.findIndex((entry) => entry.renderer === renderer);
        if (at < 0) return;
        this.placed.splice(at, 1);
        renderer.attach(null);
        this.queue_draw();
    }

    reorder(renderer: GutterRenderer, position: number): void {
        const entry = this.placed.find((candidate) => candidate.renderer === renderer);
        if (entry === undefined) return;
        entry.position = position;
        this.sort();
        this.queue_draw();
    }

    queue_draw(): void {
        this.listener(this);
    }

    /** @internal Left to right; renderers at one position keep the order they were inserted in. */
    get renderers(): readonly GutterRenderer[] {
        return this.placed.map((entry) => entry.renderer);
    }

    /** @internal The position each renderer was inserted at, parallel to `renderers`. */
    get positions(): readonly number[] {
        return this.placed.map((entry) => entry.position);
    }

    private sort(): void {
        this.placed.sort((a, b) => a.position - b.position);
    }
}

/** The gutters of one view, made when first asked for. */
export class GutterSet {
    private readonly gutters = new Map<number, Gutter>();

    private listener: GutterListener = () => {};

    private guard: GutterGuard = () => {};

    constructor(readonly view: object) {}

    /** @internal The editor session hears of every change to a gutter of this view. */
    watch(listener: GutterListener, guard: GutterGuard = () => {}): void {
        this.listener = listener;
        this.guard = guard;
    }

    /** `gtk_source_view_get_gutter`: `null` for a side that has no gutter. */
    get(windowType: number): Gutter | null {
        if (windowType !== WINDOW_LEFT && windowType !== WINDOW_RIGHT) return null;
        let gutter = this.gutters.get(windowType);
        if (gutter === undefined) {
            gutter = new Gutter(
                this.view,
                windowType,
                (changed) => this.listener(changed),
                (guarded) => this.guard(guarded),
            );
            this.gutters.set(windowType, gutter);
        }
        return gutter;
    }
}

/** One stretch of a renderer's `markup`, with the Pango styles the drivers can paint. */
export interface MarkupRun {
    readonly text: string;
    readonly bold: boolean;
    readonly italic: boolean;
    readonly underline: boolean;
    readonly strikethrough: boolean;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const MARKUP_STYLES: Readonly<Record<string, 'bold' | 'italic' | 'underline' | 'strikethrough'>> = {
    b: 'bold',
    i: 'italic',
    u: 'underline',
    s: 'strikethrough',
};

/**
 * Pango markup reduced to what a gutter paints: `<b>`, `<i>`, `<u>`, `<s>` and the five entities.
 * Any other tag (`<span>`, `<big>` …) is dropped and its text kept.
 */
export function parseMarkup(markup: string): MarkupRun[] {
    const runs: MarkupRun[] = [];
    const open: string[] = [];
    const pattern = /<(\/?)([a-zA-Z]+)[^>]*>|([^<]+)/g;
    for (let match = pattern.exec(markup); match !== null; match = pattern.exec(markup)) {
        if (match[3] === undefined) {
            if (match[1] === '/') {
                const at = open.lastIndexOf(match[2]);
                if (at >= 0) open.splice(at, 1);
            } else if (!match[0].endsWith('/>')) {
                open.push(match[2]);
            }
            continue;
        }
        const text = match[3].replace(/&(amp|lt|gt|quot|apos);/g, (_all, name: string) => ENTITIES[name]);
        const styled = (style: string): boolean => open.some((tag) => MARKUP_STYLES[tag] === style);
        runs.push({
            text,
            bold: styled('bold'),
            italic: styled('italic'),
            underline: styled('underline'),
            strikethrough: styled('strikethrough'),
        });
    }
    return runs;
}
