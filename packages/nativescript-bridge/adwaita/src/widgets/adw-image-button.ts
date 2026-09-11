// AdwImageButton — a Libadwaita-style flat icon button for NativeScript.
//
// Adwaita header bars use flat icon buttons (`button.image-button`): a 16px symbolic
// icon centered in a ~34px ROUNDED SQUARE (the `$button_radius: 9px` corner — a full
// circle is the explicit `.circular` exception, e.g. window controls / FABs) that is
// transparent at rest and darkens on press. NativeScript's `Button` is text-only (it
// cannot host a child view), so an icon button is a tappable `GridLayout` holding a
// centered `Image` whose source is an Adwaita symbolic icon rasterised by
// {@link renderSymbolicIcon}. Press feedback reuses the same
// {@link attachRowPressFeedback} the activatable rows use (NS only auto-highlights
// `Button`); the rounded-square shape + flat fill come from the `.adw-image-button` CSS.
//
// {@link iconName} takes an Adwaita icon NAME (`'go-previous-symbolic'`, resolved
// through `icon-theme.ts`' compiled subset) or an Adwaita symbolic SVG SOURCE string
// (e.g. `goPreviousSymbolic` from `@gjsify/adwaita-icons`). Add a `tap` listener for
// the click.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (.image-button)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, Image, ItemSpec } from '@nativescript/core';
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
import { attachRowPressFeedback } from './row-press.js';
import { xmlNumber } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';

/** Default symbolic-icon size, in DIPs — the Adwaita 16px icon grid. */
export const DEFAULT_ICON_BUTTON_ICON_SIZE = DEFAULT_ICON_PIXEL_SIZE;

export class AdwImageButton extends withSignals(GridLayout) {
    /** The centered icon image. */
    protected readonly _image: Image;
    // The value the CALLER set, name or source — see `GtkImage._icon` for why the
    // resolution is deferred to render time rather than done in the setter.
    private _icon = '';
    // Default fill follows the active color scheme; an explicit `iconColor` pins it.
    private _iconColor = themeIconColor();
    private _explicitColor = false;
    // The two GTK size properties under their own names, exactly as `GtkImage` carries
    // them (#1584) — this widget renders the same symbolic through the same engine, so a
    // second vocabulary for its size would be the false friend one file over.
    private _iconSize: GtkIconSizeNick = 'inherit';
    private _pixelSize = PIXEL_SIZE_UNSET;
    private _unsubScheme: (() => void) | null = null;

    constructor(props?: ConstructProps<AdwImageButton>) {
        super();

        this.className = 'adw-image-button';
        // `star` (not `auto`) so the single cell FILLS the 34px button — an `auto`
        // cell shrinks to the 16px icon and pins it top-left; a filled cell lets the
        // icon's center/middle alignment actually centre it.
        this.addRow(new ItemSpec(1, 'star'));
        this.addColumn(new ItemSpec(1, 'star'));

        const image = new Image();
        image.className = 'adw-image-button-icon';
        image.stretch = 'aspectFit';
        image.width = this._renderedSize;
        image.height = this._renderedSize;
        image.horizontalAlignment = 'center';
        image.verticalAlignment = 'middle';
        this.addChild(image);
        this._image = image;

        // Adwaita flat buttons darken on press; NS auto-applies the `highlighted`
        // state only to `Button`, so wire it by hand (shared helper).
        attachRowPressFeedback(this);

        // Re-render the icon bitmap in the light/dark fg when the scheme flips,
        // while on screen (subscribe on load, drop on unload — no leak).
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

    /** The size the glyph draws at right now: `pixelSize` when set, else `iconSize`. */
    private get _renderedSize(): number {
        return iconPixelSize(this._iconSize, this._pixelSize);
    }

    /** Resize the icon box and re-rasterise the glyph into it. */
    private _applySize(): void {
        const size = this._renderedSize;
        this._image.width = size;
        this._image.height = size;
        this._render();
    }

    /** Re-render the icon bitmap from the current svg / colour / size. */
    private _render(): void {
        const svg = resolveIconSource(this._icon);
        if (!svg) return;
        const source = renderSymbolicIcon(svg, { size: this._renderedSize, color: this._iconColor });
        if (source) this._image.imageSource = source;
    }

    /**
     * The icon to render: an Adwaita icon NAME (`'go-previous-symbolic'`) or an Adwaita
     * symbolic SVG SOURCE string (e.g. `goPreviousSymbolic`). A name the compiled subset
     * does not carry draws the `image-missing` glyph; `''` draws nothing.
     */
    get iconName(): string {
        return this._icon;
    }

    set iconName(value: string) {
        this._icon = value ?? '';
        this._applySize();
    }

    /** The icon fill colour (hex). Setting it PINS the colour (it no longer follows
     *  the light/dark scheme) — for context colours that must survive both schemes. */
    get iconColor(): string {
        return this._iconColor;
    }

    set iconColor(value: string) {
        this._explicitColor = true;
        this._iconColor = value || DEFAULT_ICON_COLOR;
        this._render();
    }

    /**
     * `Gtk.Image:icon-size` on the glyph — one of `inherit`, `normal` (16 DIPs) or
     * `large` (32). THE ENUM, not a number: for a size in DIPs use {@link pixelSize}.
     * A value that is not a member throws, naming it and the three that are (#1584).
     */
    get iconSize(): GtkIconSizeNick {
        return this._iconSize;
    }

    set iconSize(value: GtkIconSizeNick) {
        this._iconSize = gtkIconSizeNick(value, this._iconSize);
        this._applySize();
    }

    /**
     * `Gtk.Image:pixel-size` on the glyph — its edge length in DIPs, overriding
     * {@link iconSize}. This is what `iconSize` did before #1584. It reads back `-1` while
     * unset, as `gtk_image_get_pixel_size` does; assigning a non-positive value clears it.
     */
    get pixelSize(): number {
        return this._pixelSize;
    }

    set pixelSize(raw: number | string) {
        this._pixelSize = storedPixelSize(xmlNumber(raw, this._pixelSize));
        this._applySize();
    }

    /** The underlying icon {@link Image} (e.g. to tweak alignment). */
    get image(): Image {
        return this._image;
    }
}
