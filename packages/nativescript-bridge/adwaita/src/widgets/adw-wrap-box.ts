// AdwWrapBox — a Libadwaita-style flowing wrap box for NativeScript.
//
// Renders a REAL NativeScript `WrapLayout`: children flow left-to-right and wrap
// onto the next line when they run out of horizontal room. Mirrors `Adw.WrapBox`:
// `orientation`, `child-spacing`, `line-spacing`, `add(child)`.
//
// FIDELITY: the flow behaviour is a direct native equivalent. The spacing is
// approximated by uniform child margins, because `WrapLayout` has no gap
// property, and the property CONTRACT — the 0 default, the negative clamp, the
// early return on no change — lives in `wrap-box-layout.ts` beside the
// conformance vectors both renderers are held to.
//
// NOT ported, because `WrapLayout` exposes only `orientation` / `itemWidth` /
// `itemHeight` and there is nothing to map them onto: `justify`, `align`,
// `justify-last-line`, `line-homogeneous`, `pack-direction`, `wrap-policy`,
// `natural-line-length` and the two length units. Tracked in issue #1048.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-wrap-box`.
// Reference: refs/libadwaita/src/adw-wrap-box.c (AdwWrapBox is a layout, no dedicated scss)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { View, WrapLayout } from '@nativescript/core';
import {
    DEFAULT_WRAP_BOX_SPACING,
    normalizeWrapBoxSpacing,
    wrapBoxChildMargin,
    wrapBoxSpacingChanges,
} from './wrap-box-layout.js';

export class AdwWrapBox extends WrapLayout {
    private _childSpacing = DEFAULT_WRAP_BOX_SPACING;
    private _lineSpacing = DEFAULT_WRAP_BOX_SPACING;

    constructor() {
        super();

        this.className = 'adw-wrap-box';
        this.orientation = 'horizontal';
    }

    /** Append a child. */
    add(view: View): void {
        this.addChild(view);
    }

    /** Remove a previously-added child. */
    remove(view: View): void {
        this.removeChild(view);
    }

    /**
     * Every path a child can enter by — `add()`, a direct `addChild()`, and XML
     * inflation via `_addChildFromBuilder` — ends here, which is why the spacing
     * is applied here and not in `add()`. It used to be applied in `add()` only,
     * so a child declared in markup got no spacing at all; C routes GtkBuildable's
     * `add_child` through the same append for the same reason.
     */
    addChild(view: View): void {
        super.addChild(view);
        this._applySpacing(view);
    }

    /** Horizontal gap between items in a line, in DIPs. Defaults to 0, as in C. */
    get childSpacing(): number {
        return this._childSpacing;
    }

    set childSpacing(value: number) {
        if (!wrapBoxSpacingChanges(this._childSpacing, value)) return;
        this._childSpacing = normalizeWrapBoxSpacing(value);
        this._applySpacingToChildren();
    }

    /** Vertical gap between wrapped lines, in DIPs. Defaults to 0, as in C. */
    get lineSpacing(): number {
        return this._lineSpacing;
    }

    set lineSpacing(value: number) {
        if (!wrapBoxSpacingChanges(this._lineSpacing, value)) return;
        this._lineSpacing = normalizeWrapBoxSpacing(value);
        this._applySpacingToChildren();
    }

    /**
     * Re-apply the spacing to every child already in the tree.
     *
     * The spacing used to be baked in at add time, so `box.childSpacing = 12`
     * after the children were added did nothing; `adw_wrap_box_set_child_spacing`
     * hands the new value to the layout manager, which re-runs the allocation for
     * children that are already there.
     */
    private _applySpacingToChildren(): void {
        for (let i = 0; i < this.getChildrenCount(); i++) this._applySpacing(this.getChildAt(i));
    }

    private _applySpacing(view: View): void {
        view.set('margin', wrapBoxChildMargin(this._childSpacing, this._lineSpacing));
    }
}
