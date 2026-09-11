// GtkImage — a decorative Adwaita symbolic icon for NativeScript.
//
// NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034 clause 1). A non-interactive
// image rendering a symbolic is `Gtk.Image` with an icon-name; libadwaita ships no
// icon type at all. The file used to be `adw-icon.ts` exporting `AdwIcon`, which
// named the design system while claiming to name the widget — and the namespace
// barrel already said so, exporting it as `Gtk.Image` while the class kept the
// other prefix. The browser element took the GIR name on 2026-09-01 and this one
// was deliberately left, because the storybook coverage gate joins the two
// renderers on the BARE name and a one-sided rename would have split one widget
// into two one-renderer rows. Both sides say `image` now, so the pair is one row
// and its `sameWidgetAs` bridge is gone.
//
// A non-interactive `Image` that renders an Adwaita symbolic SVG (a row chevron,
// a status glyph, …) through {@link renderSymbolicIcon} — the same native
// `PathParser`→`Bitmap` engine `AdwImageButton` uses, minus the tappable circular
// chrome. Use this for a glyph that sits inside another widget (e.g. the
// `AdwComboRow` down-chevron); for a tappable icon BUTTON use `AdwImageButton`.
//
// {@link iconName} takes an Adwaita icon NAME (`'list-add-symbolic'`, resolved through
// `icon-theme.ts`' compiled subset) or an Adwaita symbolic SVG SOURCE string (e.g.
// `panDownSymbolic` from `@gjsify/adwaita-icons`). Both doors, one property — the two
// grammars are disjoint, and `resolveIconSource` is where that is decided.
//
// SIZE IS TWO PROPERTIES, because it is two on `Gtk.Image` (#1584): {@link iconSize} is
// the three-member `Gtk.IconSize` enum and {@link pixelSize} is the count of DIPs, with
// the second overriding the first the way `gtk_image_set_pixel_size` does. Until #1584
// this port had ONE, called `iconSize` and taking DIPs — GTK's `pixel-size` under GTK's
// `icon-size` name, a false friend no name comparison could see.
//
// Reference: refs/libadwaita/src/stylesheet (symbolic icon usage).
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Image } from '@nativescript/core';
import { onAdwaitaColorSchemeChanged, themeIconColor } from './color-scheme.js';
import { DEFAULT_ICON_COLOR } from './icon-path.js';
import { resolveIconSource } from './icon-theme.js';
import {
    DEFAULT_ICON_PIXEL_SIZE,
    type GtkIconSizeNick,
    gtkIconSizeNick,
    iconPixelSize,
    PIXEL_SIZE_UNSET,
    storedPixelSize,
} from './gtk-icon-size.js';
import { renderSymbolicIcon } from './icons.js';
import { xmlNumber } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';

/** Default decorative-icon size, in DIPs — the Adwaita 16px symbolic grid. */
export const DEFAULT_GTK_IMAGE_SIZE = DEFAULT_ICON_PIXEL_SIZE;

export class GtkImage extends withSignals(Image) {
    // The value the CALLER set, name or source, so the getter round-trips it the way
    // `gtk_image_get_icon_name` returns the name that was set. Resolution happens at
    // render time instead, which is also what makes a late `registerIcon` visible on the
    // next re-render rather than frozen at assignment.
    private _icon = '';
    // Default fill follows the active color scheme (dark fg on light, near-white
    // on dark); an explicit `iconColor` pins it and stops following the theme.
    private _iconColor = themeIconColor();
    private _explicitColor = false;
    // The two GTK size properties, each under its own name (#1584). `_pixelSize` carries
    // `Gtk.Image:pixel-size`'s own -1 until a caller sets one: unset, so `_iconSize`
    // decides. Neither IS the rendered size — {@link iconPixelSize} computes that.
    private _iconSize: GtkIconSizeNick = 'inherit';
    private _pixelSize = PIXEL_SIZE_UNSET;
    private _unsubScheme: (() => void) | null = null;

    constructor(props?: ConstructProps<GtkImage>) {
        super();
        // THE CLASS KEEPS THE `adw-` PREFIX while the widget takes the GIR name, and the
        // two are not the same vocabulary: ADR 0034 clause 1 names a WIDGET after the
        // library that owns its GType, while a style class names the DESIGN SYSTEM whose
        // stylesheet carries it — which is Adwaita's. `GtkButton` next door does exactly
        // this (`className = 'adw-button'`), and `check-nativescript-theme-classes.mjs`
        // only tracks `adw-`-prefixed names, so a class renamed along with its widget
        // silently leaves that gate's sight.
        this.className = 'adw-icon';
        this.stretch = 'aspectFit';
        this._applySize();

        // Re-render the pre-coloured bitmap in the light/dark fg when the scheme
        // flips — but only while on screen (subscribe on load, drop on unload, so
        // the listener registry only ever holds visible icons + can't leak).
        this.addEventListener('loaded', () => {
            this._syncThemeColor();
            this._unsubScheme ??= onAdwaitaColorSchemeChanged(() => this._syncThemeColor());
        });
        this.addEventListener('unloaded', () => {
            this._unsubScheme?.();
            this._unsubScheme = null;
        });

        applyConstructProps(this, props);
    }

    /** Adopt the active scheme's default fill (no-op if the caller pinned a colour). */
    private _syncThemeColor(): void {
        if (this._explicitColor) return;
        const next = themeIconColor();
        if (next === this._iconColor) return;
        this._iconColor = next;
        this._render();
    }

    /** The size this image draws at right now: `pixelSize` when set, else `iconSize`. */
    private get _renderedSize(): number {
        return iconPixelSize(this._iconSize, this._pixelSize);
    }

    /** Resize the image box and re-rasterise the glyph into it. */
    private _applySize(): void {
        const size = this._renderedSize;
        this.width = size;
        this.height = size;
        this._render();
    }

    private _render(): void {
        const svg = resolveIconSource(this._icon);
        if (!svg) return;
        const source = renderSymbolicIcon(svg, { size: this._renderedSize, color: this._iconColor });
        if (source) this.imageSource = source;
    }

    /**
     * The icon to render: an Adwaita icon NAME (`'list-add-symbolic'`) or an Adwaita
     * symbolic SVG SOURCE string (e.g. `panDownSymbolic`). A name the compiled subset
     * does not carry draws the `image-missing` glyph; `''` draws nothing.
     */
    get iconName(): string {
        return this._icon;
    }

    set iconName(value: string) {
        this._icon = value ?? '';
        this._render();
    }

    /** The icon fill colour (hex). Setting it PINS the colour (it no longer follows
     *  the light/dark scheme) — use it for context colours like white on a suggested
     *  button or destructive red, which must survive both schemes. */
    get iconColor(): string {
        return this._iconColor;
    }

    set iconColor(value: string) {
        this._explicitColor = true;
        this._iconColor = value || DEFAULT_ICON_COLOR;
        this._render();
    }

    /**
     * `Gtk.Image:icon-size` — one of `inherit`, `normal` (16 DIPs) or `large` (32).
     *
     * THE ENUM, not a number, and that is the whole of #1584: this name used to take a
     * count of DIPs, so `<gtk:Image iconSize="large" />` — which is what a reader of the
     * GTK documentation writes — failed to parse, fell back, and rendered at 16 with
     * nothing reported. For a size in DIPs use {@link pixelSize}, which is the GTK
     * property that means one. A value that is not a member THROWS, naming it and the
     * three that are accepted: there is no range here to be lenient about.
     */
    get iconSize(): GtkIconSizeNick {
        return this._iconSize;
    }

    set iconSize(value: GtkIconSizeNick) {
        this._iconSize = gtkIconSizeNick(value, this._iconSize);
        this._applySize();
    }

    /**
     * `Gtk.Image:pixel-size` — the edge length in DIPs, overriding {@link iconSize}.
     *
     * This is what the property called `iconSize` did before #1584, under the name GTK
     * gives it. It reads back `-1` while unset, which is what `gtk_image_get_pixel_size`
     * answers and NOT the size the image draws at: a getter that answered the drawn size
     * would make `image.pixelSize = image.pixelSize` pin it. Assigning any non-positive
     * value clears the override and hands the size back to {@link iconSize}.
     */
    get pixelSize(): number {
        return this._pixelSize;
    }

    set pixelSize(raw: number | string) {
        this._pixelSize = storedPixelSize(xmlNumber(raw, this._pixelSize));
        this._applySize();
    }
}
