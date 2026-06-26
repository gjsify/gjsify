// AdwImageButton — a Libadwaita-style circular icon button for NativeScript.
//
// Adwaita header bars use flat, CIRCULAR icon buttons (`button.image-button`): a
// 16px symbolic icon centered in a ~34px circle that is transparent at rest and
// darkens on press. NativeScript's `Button` is text-only (it cannot host a child
// view), so an icon button is a tappable `GridLayout` holding a centered `Image`
// whose source is an Adwaita symbolic icon rasterised by {@link renderSymbolicIcon}.
// Press feedback reuses the same {@link attachRowPressFeedback} the activatable rows
// use (NS only auto-highlights `Button`); the circular shape + flat fill come from
// the `.adw-image-button` CSS.
//
// Pass an Adwaita symbolic SVG string (e.g. `goPreviousSymbolic` from
// `@gjsify/adwaita-icons`) to {@link icon}. Add a `tap` listener for the click.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (.image-button)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, Image, ItemSpec } from '@nativescript/core';
import { DEFAULT_ICON_COLOR } from './icon-path.js';
import { renderSymbolicIcon } from './icons.js';
import { attachRowPressFeedback } from './row-press.js';

/** Default symbolic-icon size, in DIPs — the Adwaita 16px icon grid. */
export const DEFAULT_ICON_BUTTON_ICON_SIZE = 16;

export class AdwImageButton extends GridLayout {
    /** The centered icon image. */
    protected readonly _image: Image;
    private _iconSvg = '';
    private _iconColor = DEFAULT_ICON_COLOR;
    private _iconSize = DEFAULT_ICON_BUTTON_ICON_SIZE;

    constructor() {
        super();

        this.className = 'adw-image-button';
        this.addRow(new ItemSpec(1, 'auto'));
        this.addColumn(new ItemSpec(1, 'auto'));

        const image = new Image();
        image.className = 'adw-image-button-icon';
        image.stretch = 'aspectFit';
        image.width = this._iconSize;
        image.height = this._iconSize;
        image.horizontalAlignment = 'center';
        image.verticalAlignment = 'middle';
        this.addChild(image);
        this._image = image;

        // Adwaita circular flat buttons darken on press; NS auto-applies the
        // `highlighted` state only to `Button`, so wire it by hand (shared helper).
        attachRowPressFeedback(this);
    }

    /** Re-render the icon bitmap from the current svg / colour / size. */
    private _render(): void {
        if (!this._iconSvg) return;
        const source = renderSymbolicIcon(this._iconSvg, { size: this._iconSize, color: this._iconColor });
        if (source) this._image.imageSource = source;
    }

    /** The Adwaita symbolic SVG string to render (e.g. `goPreviousSymbolic`). */
    get icon(): string {
        return this._iconSvg;
    }

    set icon(svg: string) {
        this._iconSvg = svg ?? '';
        this._image.width = this._iconSize;
        this._image.height = this._iconSize;
        this._render();
    }

    /** The icon fill colour (hex). Re-renders. Light/dark callers set this per theme. */
    get iconColor(): string {
        return this._iconColor;
    }

    set iconColor(value: string) {
        this._iconColor = value || DEFAULT_ICON_COLOR;
        this._render();
    }

    /** The icon size in DIPs (default 16). Re-renders + resizes the image box. */
    get iconSize(): number {
        return this._iconSize;
    }

    set iconSize(value: number) {
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
