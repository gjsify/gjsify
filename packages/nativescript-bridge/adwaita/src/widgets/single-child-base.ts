// The shared half of the containers that hold ONE child and add no look of their own —
// `Adw.Bin`, `Gtk.Revealer`, `Gtk.Overlay` and `Gtk.ScrolledWindow` — for NativeScript.
//
// A BASE AND NOT FOUR COPIES, because the second copy is where the drift starts: a
// `GridLayout` with one star cell, a `child` that replaces its predecessor,
// `_addChildFromBuilder` making every XML child THE child (the inherited `addChild` leaves
// `child` null — the measured `AdwClamp` incident) are the same in all four, and the
// `css-classes` verbs come from `AdwStyledLayoutBase`, which the multi-child containers share.
// What differs is where the child goes (`_adopt` / `_release`) and what the
// widget does with it, so those are the two hooks.
//
// TRANSPARENT, AS GTK'S ARE. `bin`, `revealer`, `overlay` and `scrolledwindow` are CSS
// NAMES, never members of `css-classes`, and Adwaita gives none of them a fill, radius or
// padding — so the constructor writes no `className` at all, and an untouched widget leaves
// the property as NativeScript left it (`undefined`; see "What the slice PROMISES" in the
// package AGENTS.md). `styleClasses` writes exactly what a caller put there, which is how a
// `.blp`'s `css-classes: ["card"]` lands.
//
// Named `Adw…` like `AdwSplitViewBase`, the sibling base, so the gates that read widget
// classes by prefix see it; it is abstract and constructed only through its subclasses.
//
// THE MAIN CHILD GOES FIRST. A `GridLayout` paints its children in order, and `Gtk.Overlay`
// stacks its overlays above the main child whichever was written first, so the child is
// inserted at index 0 rather than appended.
//
// Reference: refs/libadwaita/src/adw-bin.c (AdwBin)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, type View } from '@nativescript/core';

import { AdwStyledLayoutBase } from './styled-layout-base.js';

export abstract class AdwSingleChildBase extends AdwStyledLayoutBase {
    private _child: View | null = null;

    constructor() {
        super();
        // Both `star`, as `AdwNavigationPage` does: the one cell is the whole container, and
        // the child's own `halign` / `valign` decide where in it the child sits.
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));
    }

    // --- child ---

    /** The child, or `null`. */
    get child(): View | null {
        return this._child;
    }

    set child(view: View | null) {
        const next = view ?? null;
        if (next === this._child) return;
        if (this._child) {
            this._release(this._child);
            this._child = null;
        }
        if (next) {
            this._child = next;
            this._adopt(next);
        }
    }

    /** `gtk_*_set_child` — the method spelling of {@link child}. */
    set_child(view: View | null): void {
        this.child = view;
    }

    /** `gtk_*_get_child`. */
    get_child(): View | null {
        return this._child;
    }

    /**
     * XML inflation — a bare child and `child:` mean the same thing, so every child a
     * template declares is THE child. A widget with a second destination overrides this.
     */
    _addChildFromBuilder(_name: string, view: View): void {
        this.child = view;
    }

    /** Put the child where this widget shows it. The default is the one cell, at the bottom. */
    protected _adopt(view: View): void {
        GridLayout.setColumn(view, 0);
        GridLayout.setRow(view, 0);
        this.insertChild(view, 0);
    }

    /** Take the child back out of wherever {@link _adopt} put it. */
    protected _release(view: View): void {
        this.removeChild(view);
    }
}
