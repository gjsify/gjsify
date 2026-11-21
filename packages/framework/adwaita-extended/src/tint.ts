import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Only plain hex reaches the CSS text: a source colour is data from a server, not trusted markup. */
export function isHexColour(value: string): boolean {
    return HEX.test(value.trim());
}

/**
 * One provider per (kind, colour), shared by every widget in that colour and never removed: a list
 * of hundreds of rows uses a handful of source colours, while a provider per row would make the
 * display restyle once per row. Keyed by class name, which already encodes both.
 */
const loaded = new Set<string>();

function load(cls: string, css: string): boolean {
    if (loaded.has(cls)) return true;
    const display = Gdk.Display.get_default();
    if (!display) return false;
    const provider = new Gtk.CssProvider();
    provider.load_from_string(css);
    Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    loaded.add(cls);
    return true;
}

/**
 * Paints a widget in an arbitrary colour by giving it a class shared by all widgets of the same
 * `kind` and colour. `rules(cls, colour)` returns the CSS for that class; the dark-theme variant
 * lifts the colour toward white so a deep source colour stays visible, through a media query, so
 * no widget has to follow the style manager.
 */
export class Tint {
    private readonly widget: Gtk.Widget;
    private readonly kind: string;
    private readonly rules: (cls: string, colour: string) => string;
    private cls: string | null = null;
    private pending: { cls: string; css: string } | null = null;

    constructor(widget: Gtk.Widget, kind: string, rules: (cls: string, colour: string) => string) {
        this.widget = widget;
        this.kind = kind;
        this.rules = rules;
        // Without a display yet (built before the application starts), load on first realize.
        widget.connect('realize', () => {
            if (this.pending && load(this.pending.cls, this.pending.css)) this.pending = null;
        });
    }

    set(colour: string | null): void {
        if (this.cls) this.widget.remove_css_class(this.cls);
        this.cls = null;
        this.pending = null;
        if (colour === null || !isHexColour(colour)) return;
        const hex = colour.trim().toLowerCase();
        const cls = `gjsify-tint-${this.kind}-${hex.slice(1)}`;
        const css =
            this.rules(cls, hex) +
            `@media (prefers-color-scheme: dark) { ${this.rules(cls, `color-mix(in srgb, ${hex} 70%, white)`)} }`;
        if (!load(cls, css)) this.pending = { cls, css };
        this.widget.add_css_class(cls);
        this.cls = cls;
    }
}
