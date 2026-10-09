// GtkSource.Gutter, GutterRenderer and GutterRendererText — the columns beside a view's text.
//
// A TRUE SUBSET of GtkSourceView 5: names, defaults and return values are GtkSource's, read off the
// typelib (`view-vectors.ts` runs them against it). A renderer is a GtkWidget there; here it is a
// plain object holding the widget properties an app sets on it. This model owns WHICH renderers sit
// in which gutter and in what order. Painting them, and `vfunc_query_data`, come with the next slice.

/** `Gtk.TextWindowType`: the two sides that carry a gutter. */
const WINDOW_LEFT = 3;
const WINDOW_RIGHT = 4;

// [snake_case, camelCase, default]: the GtkWidget properties GutterRenderer inherits and apps set.
const WIDGET_PROPERTIES = [
    ['margin_start', 'marginStart', 0],
    ['margin_end', 'marginEnd', 0],
    ['width_request', 'widthRequest', -1],
    ['focusable', 'focusable', false],
    ['focus_on_click', 'focusOnClick', true],
] as const;

type WidgetPropertyName = (typeof WIDGET_PROPERTIES)[number][0];

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

export abstract class GutterRenderer {
    declare margin_start: number;
    declare marginStart: number;
    declare margin_end: number;
    declare marginEnd: number;
    declare width_request: number;
    declare widthRequest: number;
    declare focusable: boolean;
    declare focus_on_click: boolean;
    declare focusOnClick: boolean;

    private owner: Gutter | null = null;
    private readonly widget = new Map<WidgetPropertyName, number | boolean>(
        WIDGET_PROPERTIES.map(([name, , fallback]) => [name, fallback]),
    );

    constructor(properties: GutterRendererProperties = {}) {
        if (new.target === (GutterRenderer as unknown)) {
            throw new TypeError('Cannot instantiate abstract type GtkSourceGutterRenderer');
        }
        for (const [name, value] of Object.entries(properties)) {
            if (!this.widget.has(snakeCase(name) as WidgetPropertyName)) {
                throw new Error(`No property ${name} on ${new.target.name}`);
            }
            (this as unknown as Record<string, unknown>)[name] = value;
        }
    }

    /** The view of the gutter this renderer sits in, `null` while it sits in none. */
    get_view(): object | null {
        return this.owner?.get_view() ?? null;
    }
    get view(): object | null {
        return this.get_view();
    }

    /** Asks the gutter to repaint this column. Nothing is painted yet, so there is nothing to ask. */
    queue_draw(): void {}

    /** @internal Set by `Gutter.insert` and `remove`; not part of GtkSource. */
    attach(gutter: Gutter | null): void {
        this.owner = gutter;
    }

    /** @internal The held widget properties, for the driver that sizes the column. */
    widgetProperty(name: WidgetPropertyName, value?: number | boolean): number | boolean {
        if (value !== undefined) this.widget.set(name, value);
        return this.widget.get(name) as number | boolean;
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
    private plain: string | null = null;
    private marked: string | null = null;

    // Applied after `super`: a field initialiser would run later and wipe what the base set.
    constructor(properties: GutterRendererTextProperties = {}) {
        const { text, markup, ...widget } = properties;
        super(widget);
        if (text !== undefined) this.text = text;
        if (markup !== undefined) this.markup = markup;
    }

    get text(): string | null {
        return this.plain;
    }
    set text(value: string | null) {
        this.plain = value;
        this.marked = null;
    }

    get markup(): string | null {
        return this.marked;
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

export class Gutter {
    private readonly placed: { renderer: GutterRenderer; position: number }[] = [];

    constructor(
        private readonly owner: object,
        readonly window_type: number,
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
        renderer.attach(this);
        this.placed.push({ renderer, position });
        this.sort();
        return true;
    }

    remove(renderer: GutterRenderer): void {
        const at = this.placed.findIndex((entry) => entry.renderer === renderer);
        if (at < 0) return;
        this.placed.splice(at, 1);
        renderer.attach(null);
    }

    reorder(renderer: GutterRenderer, position: number): void {
        const entry = this.placed.find((candidate) => candidate.renderer === renderer);
        if (entry === undefined) return;
        entry.position = position;
        this.sort();
    }

    queue_draw(): void {}

    /** @internal Left to right; renderers at one position keep the order they were inserted in. */
    get renderers(): readonly GutterRenderer[] {
        return this.placed.map((entry) => entry.renderer);
    }

    private sort(): void {
        this.placed.sort((a, b) => a.position - b.position);
    }
}

/** The gutters of one view, made when first asked for. */
export class GutterSet {
    private readonly gutters = new Map<number, Gutter>();

    constructor(private readonly view: object) {}

    /** `gtk_source_view_get_gutter`: `null` for a side that has no gutter. */
    get(windowType: number): Gutter | null {
        if (windowType !== WINDOW_LEFT && windowType !== WINDOW_RIGHT) return null;
        let gutter = this.gutters.get(windowType);
        if (gutter === undefined) {
            gutter = new Gutter(this.view, windowType);
            this.gutters.set(windowType, gutter);
        }
        return gutter;
    }
}
