// The `css-classes` half of every container this port builds on a `GridLayout` and gives
// no look of its own — `Adw.Bin`, `Gtk.Overlay`, `Gtk.Box`, `Gtk.Grid`, `Gtk.ListBox`, a
// window — for NativeScript.
//
// A BASE AND NOT SIX COPIES, because the second copy is where the drift starts: the five
// `css-classes` verbs, `styleClasses` and the one `className` write they all end in are the
// same in every one of them. `AdwSingleChildBase` (one star cell and a `child`) and the
// multi-child containers differ in what they do with their children, never in this.
//
// TRANSPARENT, AS GTK'S ARE. `bin`, `box`, `grid`, `list` are CSS NAMES, never members of
// `css-classes`, and Adwaita gives none of them a fill, radius or padding — so the
// constructor writes no `className` at all, and an untouched widget leaves the property as
// NativeScript left it (`undefined`; see "What the slice PROMISES" in the package
// AGENTS.md). `styleClasses` writes exactly what a caller put there, which is how a `.blp`'s
// `css-classes: ["card"]` lands. A widget with a look of its own (a window, a dialog, a
// list) overrides {@link _ownClass}.
//
// Abstract and named `Adw…` like `AdwSplitViewBase`, so the gates that read widget classes
// by prefix see it; constructed only through its subclasses, which take their own bag.
//
// Reference: refs/gtk gtk/gtkwidget.c (gtk_widget_add_css_class and its siblings)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { GridLayout } from '@nativescript/core';

import { type AdwStyleClassesInput, classNameWith, StyleClassList } from './style-classes.js';
import { withSignals } from './signals.js';

export abstract class AdwStyledLayoutBase extends withSignals(GridLayout) {
    private readonly _style = new StyleClassList();

    // Declared, though it adds nothing, because `check-nativescript-xml-doors.mjs` reads every
    // widget class for the one constructor that offers or refuses the construct-props bag.
    // This base refuses it (`NO_CONSTRUCT_PROPS`): a bag applied here would run before the
    // subclass built its tracks, rows or card.
    constructor() {
        super();
    }

    /**
     * `GtkWidget:css-classes`, spelled `styleClasses` — `cssClasses` is the platform's own
     * live `Set` (`style-classes.ts`). From XML it is a space-separated list.
     */
    get styleClasses(): string[] {
        return this._style.classes;
    }

    set styleClasses(value: AdwStyleClassesInput) {
        this._style.replace(value);
        this._restyle();
    }

    /** `gtk_widget_add_css_class`. */
    add_css_class(name: string): void {
        this._style.add(name);
        this._restyle();
    }

    /** `gtk_widget_remove_css_class`. */
    remove_css_class(name: string): void {
        this._style.remove(name);
        this._restyle();
    }

    /** `gtk_widget_has_css_class`. */
    has_css_class(name: string): boolean {
        return this._style.has(name);
    }

    /** `gtk_widget_get_css_classes`. */
    get_css_classes(): string[] {
        return this._style.classes;
    }

    /** `gtk_widget_set_css_classes` — REPLACES the list. */
    set_css_classes(names: readonly string[]): void {
        this._style.replaceAll(names);
        this._restyle();
    }

    /**
     * The class the widget wears for what it IS, before any `css-classes`. Empty for the
     * transparent containers; a window or a dialog overrides it, because those have a
     * background GTK's `.background` gives them.
     */
    protected get _ownClass(): string {
        return '';
    }

    protected _restyle(): void {
        this.className = classNameWith(this._ownClass, this._style.classes);
    }
}
