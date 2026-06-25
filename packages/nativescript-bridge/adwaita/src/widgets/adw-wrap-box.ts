// AdwWrapBox — a Libadwaita-style flowing wrap box for NativeScript.
//
// Renders a REAL NativeScript `WrapLayout`: children flow left-to-right and wrap
// onto the next line when they run out of horizontal room. Mirrors `Adw.WrapBox`:
// `orientation`, `add(child)`. NS `WrapLayout` is the closest native primitive.
//
// FIDELITY: faithful. `WrapLayout` is a direct native equivalent of `Adw.WrapBox`'s
// flow behaviour. Per-child spacing is approximated via uniform margins (NS
// `WrapLayout` spaces by item margins, not a `child-spacing` gap property); the
// `lineSpacing`/`childSpacing` knobs set a uniform margin on added children.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-wrap-box`.
// Reference: refs/libadwaita/src/stylesheet (AdwWrapBox is a layout, no dedicated scss)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { View, WrapLayout } from '@nativescript/core';

export class AdwWrapBox extends WrapLayout {
    private _childSpacing = 6;
    private _lineSpacing = 6;

    constructor() {
        super();

        this.className = 'adw-wrap-box';
        this.orientation = 'horizontal';
    }

    /** Append a child; applies the uniform child/line spacing as a margin. */
    add(view: View): void {
        this._applySpacing(view);
        this.addChild(view);
    }

    /** Remove a previously-added child. */
    remove(view: View): void {
        this.removeChild(view);
    }

    private _applySpacing(view: View): void {
        // NS WrapLayout has no gap property — express spacing as a half-margin on
        // each child so the inter-item gap reads as `childSpacing` / `lineSpacing`.
        const half = (n: number) => Math.max(0, n / 2);
        view.set(
            'margin',
            `${half(this._lineSpacing)} ${half(this._childSpacing)} ${half(this._lineSpacing)} ${half(this._childSpacing)}`,
        );
    }

    /** Horizontal gap between items in a line, in DIPs. */
    get childSpacing(): number {
        return this._childSpacing;
    }

    set childSpacing(value: number) {
        this._childSpacing = Number.isFinite(value) && value >= 0 ? value : 0;
    }

    /** Vertical gap between wrapped lines, in DIPs. */
    get lineSpacing(): number {
        return this._lineSpacing;
    }

    set lineSpacing(value: number) {
        this._lineSpacing = Number.isFinite(value) && value >= 0 ? value : 0;
    }
}
