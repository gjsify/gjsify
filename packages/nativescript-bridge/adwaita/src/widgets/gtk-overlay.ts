// GtkOverlay — a main child with other widgets stacked on top of it, for NativeScript.
//
// A REAL `GridLayout` with ONE star cell that EVERY child shares, which is how this
// platform stacks views: two views in one cell paint on top of each other in the order they
// were added. The main child is kept at the bottom (`AdwSingleChildBase` inserts it at
// index 0) and each overlay goes above it in `add_overlay` order, so the last overlay added
// is the topmost, as in GTK.
//
// PLACEMENT IS THE OVERLAY'S OWN. GTK places an overlay by its `halign` / `valign`
// (`fill` by default) inside the main child's allocation — which is exactly what a child of
// a one-cell grid does with its own alignment, so there is nothing to compute here and the
// port's `halign` / `valign` (`widget-layout.ts`) are what a `.blp` writes. The overlay-only
// knobs (`measure`, `clip-overlay`) and the `get-child-position` signal have no counterpart.
//
// A `.blp` writes the two destinations as `child: …` and `[overlay] …`, which the shared-tree
// builder hands over as the slot names `child` and `overlay`; a bare child is the main child,
// as `gtk_overlay_buildable_add_child` makes it.
//
// Reference: refs/gtk gtk/gtkoverlay.c (GtkOverlay)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { GridLayout, type View } from '@nativescript/core';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { builderSlotsOf, resolveBuilderSlot } from './builder-slots.js';
import { AdwSingleChildBase } from './single-child-base.js';

export class GtkOverlay extends AdwSingleChildBase {
    /** `child` and the `[overlay]` internal-child type; a bare child is the main child. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(['child', 'overlay'], 'child');

    private readonly _overlays: View[] = [];

    constructor(props?: ConstructProps<GtkOverlay>) {
        super();
        applyConstructProps(this, props);
    }

    /** Stack `view` above everything already in the overlay — `gtk_overlay_add_overlay`. */
    add_overlay(view: View): void {
        if (this._overlays.includes(view)) return;
        GridLayout.setColumn(view, 0);
        GridLayout.setRow(view, 0);
        this.addChild(view);
        this._overlays.push(view);
    }

    /** `gtk_overlay_remove_overlay`. A view that is not an overlay of this one is left alone. */
    remove_overlay(view: View): void {
        const at = this._overlays.indexOf(view);
        if (at === -1) return;
        this._overlays.splice(at, 1);
        this.removeChild(view);
    }

    /** The overlays, bottom to top. */
    get overlays(): readonly View[] {
        return [...this._overlays];
    }

    /** XML inflation — `overlay` stacks the view, anything else is the main child. */
    _addChildFromBuilder(name: string, view: View): void {
        if (resolveBuilderSlot(name, ['overlay'], 'child') === 'overlay') this.add_overlay(view);
        else this.child = view;
    }
}
