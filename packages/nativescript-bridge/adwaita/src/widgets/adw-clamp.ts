// AdwClamp — a Libadwaita-style max-width clamp for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (single `*` column/row) whose single
// child is centered and capped to {@link AdwClamp.maximumSize} DIPs wide. Mirrors
// `Adw.Clamp`: on a phone the child is usually full-width (narrower than the cap);
// the cap matters on tablets / landscape where it keeps content readable instead of
// stretching edge-to-edge. Default maximum size 600 (Adwaita's `AdwClamp` default).
//
// IMPLEMENTATION NOTE: `Adw.Clamp` tightens toward the max via a smooth tightening
// function; here the child is simply centered and hard-capped to `maximumSize`
// (`width = min(maximumSize, natural)`) via an inline width + center alignment —
// the closest the NS layout/CSS subset allows without a custom measure pass.
//
// Reference: AdwClamp (libadwaita) — default maximum-size 600, tightening-threshold 400.
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, View } from '@nativescript/core';

/** Adwaita's `AdwClamp` default `maximum-size`, in DIPs. */
export const DEFAULT_CLAMP_MAX_SIZE = 600;

export class AdwClamp extends GridLayout {
    private _maximumSize = DEFAULT_CLAMP_MAX_SIZE;
    private _child: View | null = null;

    constructor() {
        super();

        this.className = 'adw-clamp';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));
    }

    /** Set (or replace) the clamped, centered child. Pass `null` to clear it. */
    setChild(view: View | null): void {
        if (this._child) {
            this.removeChild(this._child);
            this._child = null;
        }
        if (view) {
            view.horizontalAlignment = 'center';
            view.width = this._maximumSize;
            GridLayout.setColumn(view, 0);
            GridLayout.setRow(view, 0);
            this.addChild(view);
            this._child = view;
        }
    }

    /** The currently-clamped child, or `null`. */
    get child(): View | null {
        return this._child;
    }

    /** The maximum width the child is capped to, in DIPs. */
    get maximumSize(): number {
        return this._maximumSize;
    }

    set maximumSize(value: number) {
        this._maximumSize = Number.isFinite(value) && value > 0 ? value : DEFAULT_CLAMP_MAX_SIZE;
        if (this._child) {
            this._child.width = this._maximumSize;
        }
    }
}
