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
// Pass an Adwaita symbolic SVG string (e.g. `panDownSymbolic` from
// `@gjsify/adwaita-icons`) to {@link icon}.
//
// Reference: refs/libadwaita/src/stylesheet (symbolic icon usage).
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Image } from '@nativescript/core';
import { onAdwaitaColorSchemeChanged, themeIconColor } from './color-scheme.js';
import { DEFAULT_ICON_COLOR } from './icon-path.js';
import { renderSymbolicIcon } from './icons.js';
import { xmlNumber } from './xml-values.js';

/** Default decorative-icon size, in DIPs — the Adwaita 16px symbolic grid. */
export const DEFAULT_GTK_IMAGE_SIZE = 16;

export class GtkImage extends Image {
    private _iconSvg = '';
    // Default fill follows the active color scheme (dark fg on light, near-white
    // on dark); an explicit `iconColor` pins it and stops following the theme.
    private _iconColor = themeIconColor();
    private _explicitColor = false;
    private _iconSize = DEFAULT_GTK_IMAGE_SIZE;
    private _unsubScheme: (() => void) | null = null;

    constructor() {
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
        this.width = this._iconSize;
        this.height = this._iconSize;

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
    }

    /** Adopt the active scheme's default fill (no-op if the caller pinned a colour). */
    private _syncThemeColor(): void {
        if (this._explicitColor) return;
        const next = themeIconColor();
        if (next === this._iconColor) return;
        this._iconColor = next;
        this._render();
    }

    private _render(): void {
        if (!this._iconSvg) return;
        const source = renderSymbolicIcon(this._iconSvg, { size: this._iconSize, color: this._iconColor });
        if (source) this.imageSource = source;
    }

    /** The Adwaita symbolic SVG string to render (e.g. `panDownSymbolic`). */
    get iconName(): string {
        return this._iconSvg;
    }

    set iconName(svg: string) {
        this._iconSvg = svg ?? '';
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

    /** The icon size in DIPs (default 16). Re-renders + resizes the image box. */
    get iconSize(): number {
        return this._iconSize;
    }

    set iconSize(raw: number | string) {
        const value = xmlNumber(raw, this.iconSize);
        this._iconSize = Number.isFinite(value) && value > 0 ? value : DEFAULT_GTK_IMAGE_SIZE;
        this.width = this._iconSize;
        this.height = this._iconSize;
        this._render();
    }
}
