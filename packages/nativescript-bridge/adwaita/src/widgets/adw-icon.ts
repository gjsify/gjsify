// AdwIcon — a decorative Adwaita symbolic icon for NativeScript.
//
// A non-interactive `Image` that renders an Adwaita symbolic SVG (a row chevron,
// a status glyph, …) through {@link renderSymbolicIcon} — the same native
// `PathParser`→`Bitmap` engine `AdwImageButton` uses, minus the tappable circular
// chrome. Use this for a glyph that sits inside another widget (e.g. the
// `AdwComboRow` down-chevron); for a tappable icon BUTTON use `AdwImageButton`.
//
// Pass an Adwaita symbolic SVG string (e.g. `panDownSymbolic` from
// `@gjsify/adwaita-icons`) to {@link icon}.
//
// Reference: refs/libadwaita/src/stylesheet (symbolic icon usage).
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Image } from '@nativescript/core';
import { DEFAULT_ICON_COLOR } from './icon-path.js';
import { renderSymbolicIcon } from './icons.js';

/** Default decorative-icon size, in DIPs — the Adwaita 16px symbolic grid. */
export const DEFAULT_ADW_ICON_SIZE = 16;

export class AdwIcon extends Image {
    private _iconSvg = '';
    private _iconColor = DEFAULT_ICON_COLOR;
    private _iconSize = DEFAULT_ADW_ICON_SIZE;

    constructor() {
        super();
        this.className = 'adw-icon';
        this.stretch = 'aspectFit';
        this.width = this._iconSize;
        this.height = this._iconSize;
    }

    private _render(): void {
        if (!this._iconSvg) return;
        const source = renderSymbolicIcon(this._iconSvg, { size: this._iconSize, color: this._iconColor });
        if (source) this.imageSource = source;
    }

    /** The Adwaita symbolic SVG string to render (e.g. `panDownSymbolic`). */
    get icon(): string {
        return this._iconSvg;
    }

    set icon(svg: string) {
        this._iconSvg = svg ?? '';
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
        this._iconSize = Number.isFinite(value) && value > 0 ? value : DEFAULT_ADW_ICON_SIZE;
        this.width = this._iconSize;
        this.height = this._iconSize;
        this._render();
    }
}
