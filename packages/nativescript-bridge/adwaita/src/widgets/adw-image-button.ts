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
// Pass an Adwaita symbolic SVG string (e.g. `goPreviousSymbolic` from
// `@gjsify/adwaita-icons`) to {@link icon}. Add a `tap` listener for the click.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (.image-button)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, Image, ItemSpec } from '@nativescript/core';
import { onAdwaitaColorSchemeChanged, themeIconColor } from './color-scheme.js';
import { DEFAULT_ICON_COLOR } from './icon-path.js';
import { renderSymbolicIcon } from './icons.js';
import { attachRowPressFeedback } from './row-press.js';
import { xmlNumber } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

/** Default symbolic-icon size, in DIPs — the Adwaita 16px icon grid. */
export const DEFAULT_ICON_BUTTON_ICON_SIZE = 16;

export class AdwImageButton extends GridLayout {
    /** The centered icon image. */
    protected readonly _image: Image;
    private _iconSvg = '';
    // Default fill follows the active color scheme; an explicit `iconColor` pins it.
    private _iconColor = themeIconColor();
    private _explicitColor = false;
    private _iconSize = DEFAULT_ICON_BUTTON_ICON_SIZE;
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
        image.width = this._iconSize;
        image.height = this._iconSize;
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

    /** Re-render the icon bitmap from the current svg / colour / size. */
    private _render(): void {
        if (!this._iconSvg) return;
        const source = renderSymbolicIcon(this._iconSvg, { size: this._iconSize, color: this._iconColor });
        if (source) this._image.imageSource = source;
    }

    /** The Adwaita symbolic SVG string to render (e.g. `goPreviousSymbolic`). */
    get iconName(): string {
        return this._iconSvg;
    }

    set iconName(svg: string) {
        this._iconSvg = svg ?? '';
        this._image.width = this._iconSize;
        this._image.height = this._iconSize;
        this._render();
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

    /** The icon size in DIPs (default 16). Re-renders + resizes the image box. */
    get iconSize(): number {
        return this._iconSize;
    }

    set iconSize(raw: number | string) {
        const value = xmlNumber(raw, this.iconSize);
        this._iconSize = Number.isFinite(value) && value > 0 ? value : DEFAULT_ICON_BUTTON_ICON_SIZE;
        this._image.width = this._iconSize;
        this._image.height = this._iconSize;
        this._render();
    }

    /** The underlying icon {@link Image} (e.g. to tweak alignment). */
    get image(): Image {
        return this._image;
    }
}
