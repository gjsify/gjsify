// The `GtkSource.View` property defaults slice 2 claims. The ORACLE reads them off the pspecs of real
// `gi://GtkSource` (no display needed); a port reads them off a fresh view.

export interface GtkSourceViewDefaultsVector {
    readonly property: string;
    /** The member a port spells it as. */
    readonly member: string;
    readonly shows: boolean | number;
}

export const GTKSOURCE_VIEW_DEFAULT_VECTORS: readonly GtkSourceViewDefaultsVector[] = [
    { property: 'auto-indent', member: 'autoIndent', shows: false },
    { property: 'indent-width', member: 'indentWidth', shows: -1 },
    { property: 'show-line-numbers', member: 'showLineNumbers', shows: false },
    { property: 'highlight-current-line', member: 'highlightCurrentLine', shows: false },
    { property: 'monospace', member: 'monospace', shows: false },
    { property: 'editable', member: 'editable', shows: true },
    { property: 'cursor-visible', member: 'cursorVisible', shows: true },
    { property: 'left-margin', member: 'leftMargin', shows: 0 },
    { property: 'right-margin', member: 'rightMargin', shows: 0 },
    { property: 'top-margin', member: 'topMargin', shows: 0 },
    { property: 'bottom-margin', member: 'bottomMargin', shows: 0 },
];

// --- slice 4: the View surface -------------------------------------------------------------------
// Observed through the GJS names only. The enum vectors need no display; the instance vectors build a
// `GtkSource.View`, which on GJS needs one (the oracle spec guards them with `Gtk.init_check()`).

interface AdjustmentLike {
    get_value(): number;
}

export interface ViewLike {
    cursor_visible: boolean;
    editable: boolean;
    highlight_current_line: boolean;
    show_line_numbers: boolean;
    readonly vadjustment: AdjustmentLike;
    readonly hadjustment: AdjustmentLike;
    get_cursor_visible(): boolean;
    set_cursor_visible(value: boolean): void;
    get_editable(): boolean;
    set_editable(value: boolean): void;
    get_vadjustment(): AdjustmentLike;
    get_direction(): number;
    set_direction(direction: number): void;
    get_first_child(): unknown;
    get_next_sibling(): unknown;
    get_parent(): unknown;
    get_gutter(windowType: number): GutterLike | null;
    buffer: { text: string };
}

export interface GutterRendererLike {
    text: string | null;
    markup: string | null;
    margin_start: number;
    marginStart: number;
    margin_end: number;
    width_request: number;
    focusable: boolean;
    focus_on_click: boolean;
    get_view(): unknown;
    set_text(text: string, length: number): void;
    set_markup(markup: string, length: number): void;
    queue_draw(): void;
}

export interface GutterLike {
    readonly view: unknown;
    readonly window_type: number;
    get_view(): unknown;
    insert(renderer: GutterRendererLike, position: number): boolean;
    remove(renderer: GutterRendererLike): void;
    reorder(renderer: GutterRendererLike, position: number): void;
    queue_draw(): void;
}

export interface ScrolledWindowLike {
    readonly vadjustment: AdjustmentLike;
    get_policy(): [number, number];
    set_policy(h: number, v: number): void;
    set_vadjustment(adjustment: AdjustmentLike): void;
    get_vadjustment(): AdjustmentLike;
}

/** The parts of `Gtk` and `GtkSource` the slice-4 and slice-6 vectors read. */
export interface GtkSourceViewSurfaceLike {
    Gtk: {
        TextWindowType: Record<string, number>;
        PolicyType: Record<string, number>;
        TextDirection: Record<string, number>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ScrolledWindow: new (properties?: any) => ScrolledWindowLike;
    };
    GtkSource: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        View: new (properties?: any) => ViewLike;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        GutterRenderer: new (properties?: any) => GutterRendererLike;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        GutterRendererText: new (properties?: any) => GutterRendererLike;
    };
}

export interface GtkSourceViewSurfaceVector {
    readonly rule: string;
    /** Whether a `GtkSource.View` instance is built, which needs a display on GJS. */
    readonly instance: boolean;
    readonly observe: (ns: GtkSourceViewSurfaceLike) => unknown;
    readonly shows: unknown;
}

const pick = (table: Record<string, number>, names: readonly string[]): Record<string, number> =>
    Object.fromEntries(names.map((name) => [name, table[name]]));

export const GTKSOURCE_VIEW_SURFACE_VECTORS: readonly GtkSourceViewSurfaceVector[] = [
    {
        rule: 'Gtk.TextWindowType carries the typelib numbers',
        instance: false,
        observe: ({ Gtk }) => pick(Gtk.TextWindowType, ['WIDGET', 'TEXT', 'LEFT', 'RIGHT', 'TOP']),
        shows: { WIDGET: 1, TEXT: 2, LEFT: 3, RIGHT: 4, TOP: 5 },
    },
    {
        rule: 'Gtk.PolicyType carries the typelib numbers',
        instance: false,
        observe: ({ Gtk }) => pick(Gtk.PolicyType, ['ALWAYS', 'AUTOMATIC', 'NEVER', 'EXTERNAL']),
        shows: { ALWAYS: 0, AUTOMATIC: 1, NEVER: 2, EXTERNAL: 3 },
    },
    {
        rule: 'Gtk.TextDirection carries the typelib numbers',
        instance: false,
        observe: ({ Gtk }) => pick(Gtk.TextDirection, ['NONE', 'LTR', 'RTL']),
        shows: { NONE: 0, LTR: 1, RTL: 2 },
    },
    {
        rule: 'cursor_visible is true by default and the property and accessors agree',
        instance: true,
        observe: ({ GtkSource }) => {
            const view = new GtkSource.View();
            const before = [view.cursor_visible, view.get_cursor_visible()];
            view.cursor_visible = false;
            const afterProperty = [view.cursor_visible, view.get_cursor_visible()];
            view.set_cursor_visible(true);
            return [before, afterProperty, [view.cursor_visible, view.get_cursor_visible()]];
        },
        shows: [
            [true, true],
            [false, false],
            [true, true],
        ],
    },
    {
        rule: 'set_editable and the editable property agree',
        instance: true,
        observe: ({ GtkSource }) => {
            const view = new GtkSource.View();
            view.set_editable(false);
            const viaSetter = [view.editable, view.get_editable()];
            view.editable = true;
            return [viaSetter, [view.editable, view.get_editable()]];
        },
        shows: [
            [false, false],
            [true, true],
        ],
    },
    {
        rule: 'highlight_current_line and show_line_numbers are plain boolean properties',
        instance: true,
        observe: ({ GtkSource }) => {
            const view = new GtkSource.View();
            const before = [view.highlight_current_line, view.show_line_numbers];
            view.highlight_current_line = true;
            view.show_line_numbers = true;
            return [before, [view.highlight_current_line, view.show_line_numbers]];
        },
        shows: [
            [false, false],
            [true, true],
        ],
    },
    {
        rule: 'vadjustment and hadjustment are two stable, distinct adjustments',
        instance: true,
        observe: ({ GtkSource }) => {
            const view = new GtkSource.View();
            return [
                view.vadjustment === view.get_vadjustment(),
                view.vadjustment === view.hadjustment,
                view.vadjustment.get_value(),
            ];
        },
        shows: [true, false, 0],
    },
    {
        rule: 'direction is LTR by default and set_direction is read back',
        instance: true,
        observe: ({ Gtk, GtkSource }) => {
            const view = new GtkSource.View();
            const before = view.get_direction();
            view.set_direction(Gtk.TextDirection.RTL);
            return [before, view.get_direction()];
        },
        shows: [1, 2],
    },
    {
        rule: 'a fresh view has no sibling and no parent',
        instance: true,
        observe: ({ GtkSource }) => {
            const view = new GtkSource.View();
            return [view.get_next_sibling(), view.get_parent()];
        },
        shows: [null, null],
    },
    {
        rule: 'a scrolled window starts AUTOMATIC on both axes and set_policy is read back',
        instance: false,
        observe: ({ Gtk }) => {
            const window = new Gtk.ScrolledWindow();
            const before = window.get_policy();
            window.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.ALWAYS);
            return [before, window.get_policy()];
        },
        shows: [
            [1, 1],
            [2, 0],
        ],
    },
    {
        rule: 'set_policy refuses a value that is not a Gtk.PolicyType',
        instance: false,
        observe: ({ Gtk }) => {
            const window = new Gtk.ScrolledWindow();
            try {
                window.set_policy(7, 1);
                return 'accepted';
            } catch {
                return 'threw';
            }
        },
        shows: 'threw',
    },
    {
        rule: 'a scrolled window adopts the view adjustment it is given',
        instance: true,
        observe: ({ Gtk, GtkSource }) => {
            const view = new GtkSource.View();
            const window = new Gtk.ScrolledWindow();
            window.set_vadjustment(view.vadjustment);
            return [window.get_vadjustment() === view.vadjustment, window.vadjustment === view.vadjustment];
        },
        shows: [true, true],
    },
    {
        rule: 'get_gutter answers one gutter per side, LEFT and RIGHT apart',
        instance: true,
        observe: ({ Gtk, GtkSource }) => {
            const view = new GtkSource.View();
            const { LEFT, RIGHT } = Gtk.TextWindowType;
            return [
                view.get_gutter(LEFT) !== null,
                view.get_gutter(LEFT) === view.get_gutter(LEFT),
                view.get_gutter(RIGHT) === view.get_gutter(RIGHT),
                view.get_gutter(LEFT) !== view.get_gutter(RIGHT),
            ];
        },
        shows: [true, true, true, true],
    },
    {
        rule: 'a gutter knows its view and its side',
        instance: true,
        observe: ({ Gtk, GtkSource }) => {
            const view = new GtkSource.View();
            const left = view.get_gutter(Gtk.TextWindowType.LEFT) as GutterLike;
            const right = view.get_gutter(Gtk.TextWindowType.RIGHT) as GutterLike;
            return [left.get_view() === view, left.view === view, left.window_type, right.window_type];
        },
        shows: [true, true, 3, 4],
    },
    {
        rule: 'get_gutter answers null for a side that has no gutter',
        instance: true,
        observe: ({ Gtk, GtkSource }) => {
            const view = new GtkSource.View();
            const { TEXT, WIDGET, TOP } = Gtk.TextWindowType;
            return [view.get_gutter(TEXT), view.get_gutter(WIDGET), view.get_gutter(TOP)];
        },
        shows: [null, null, null],
    },
    {
        rule: 'a text renderer starts empty with the widget defaults',
        instance: true,
        observe: ({ GtkSource }) => {
            const renderer = new GtkSource.GutterRendererText();
            return [
                renderer.text,
                renderer.markup,
                renderer.margin_start,
                renderer.margin_end,
                renderer.width_request,
                renderer.focusable,
                renderer.focus_on_click,
                renderer.get_view(),
            ];
        },
        shows: [null, null, 0, 0, -1, false, true, null],
    },
    {
        rule: 'a text renderer takes widget properties at construction, snake_case or camelCase',
        instance: true,
        observe: ({ GtkSource }) => {
            const renderer = new GtkSource.GutterRendererText({
                margin_start: 12,
                margin_end: 8,
                width_request: 36,
                focusable: true,
                focus_on_click: false,
                text: 'q',
            });
            const camel = new GtkSource.GutterRendererText({ marginStart: 3 });
            camel.marginStart = 5;
            return [
                renderer.margin_start,
                renderer.margin_end,
                renderer.width_request,
                renderer.focusable,
                renderer.focus_on_click,
                renderer.text,
                camel.margin_start,
            ];
        },
        shows: [12, 8, 36, true, false, 'q', 5],
    },
    {
        rule: 'a renderer refuses a property it does not have',
        instance: true,
        observe: ({ GtkSource }) => {
            try {
                new GtkSource.GutterRendererText({ bogus: 1 });
                return 'accepted';
            } catch {
                return 'threw';
            }
        },
        shows: 'threw',
    },
    {
        rule: 'GutterRenderer is abstract',
        instance: true,
        observe: ({ GtkSource }) => {
            try {
                new GtkSource.GutterRenderer();
                return 'accepted';
            } catch {
                return 'threw';
            }
        },
        shows: 'threw',
    },
    {
        rule: 'text and markup replace each other, and a length cuts the string in bytes',
        instance: true,
        observe: ({ GtkSource }) => {
            const renderer = new GtkSource.GutterRendererText();
            renderer.set_text('abcdef', 3);
            const cut = [renderer.text, renderer.markup];
            renderer.set_markup('<b>x</b>', -1);
            const marked = [renderer.text, renderer.markup];
            renderer.text = 'zz';
            return [cut, marked, [renderer.text, renderer.markup]];
        },
        shows: [
            ['abc', null],
            [null, '<b>x</b>'],
            ['zz', null],
        ],
    },
    {
        rule: 'insert claims a renderer for the view, a second insert is refused, remove gives it back',
        instance: true,
        observe: ({ Gtk, GtkSource }) => {
            const view = new GtkSource.View();
            const left = view.get_gutter(Gtk.TextWindowType.LEFT) as GutterLike;
            const right = view.get_gutter(Gtk.TextWindowType.RIGHT) as GutterLike;
            const renderer = new GtkSource.GutterRendererText();
            const inserted = left.insert(renderer, 0);
            const held = renderer.get_view() === view;
            const again = [left.insert(renderer, 1), right.insert(renderer, 1)];
            left.remove(renderer);
            const released = renderer.get_view();
            return [inserted, held, again, released, right.insert(renderer, 0)];
        },
        shows: [true, true, [false, false], null, true],
    },
    {
        rule: 'reorder and queue_draw answer nothing',
        instance: true,
        observe: ({ Gtk, GtkSource }) => {
            const view = new GtkSource.View();
            const left = view.get_gutter(Gtk.TextWindowType.LEFT) as GutterLike;
            const renderer = new GtkSource.GutterRendererText();
            left.insert(renderer, 0);
            return [left.reorder(renderer, 3), left.queue_draw(), renderer.queue_draw()];
        },
        shows: [undefined, undefined, undefined],
    },
];
