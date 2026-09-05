// GtkButton — the Adwaita-styled GTK button for NativeScript.
//
// NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034 clause 1). libadwaita ships no
// button type: it styles `GtkButton` through `_buttons.scss`, so the widget is GTK's and
// the Adwaita part is the stylesheet — which is exactly what the `cssClasses` property
// below carries. The file used to be `adw-button.ts` exporting `AdwButton`, and that prefix
// named the design system while claiming to name the widget.
//
// Extends the REAL NativeScript `Button` and exposes a `cssClasses` property that
// carries the Adwaita button style classes (`.suggested-action` / `.destructive-action`
// / `.flat` / `.pill`), styled in `src/theme/adwaita.css`. Mirrors how libadwaita
// buttons get their look from a CSS style class rather than a distinct widget:
// pill radius, accent fill for suggested, red text for destructive, transparent
// for flat.
//
// Visual spec ported from `@gjsify/adwaita-web` + libadwaita button styles.
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Button } from '@nativescript/core';
import { classNameWith, normalizeCssClasses } from './css-classes.js';

export class GtkButton extends Button {
    private _cssClasses: string[] = [];

    constructor() {
        super();
        this.className = 'adw-button';
        // Adwaita buttons are FLAT — kill the Android Material elevation/shadow so
        // suggested/destructive/flat/pill don't render as raised Material buttons.
        this.set('androidElevation', 0);
    }

    /**
     * The style classes this button carries (`GtkWidget:css-classes`), without the
     * `adw-button` class that makes it a button — GTK's own rule for the property.
     *
     * IT WAS `variant`, AN ENUM, AND THAT WAS ONE LOOK AT A TIME (ADR 0049). Its own doc
     * said so: "`pill` is the rounded SHAPE and combines with no other variant here (set
     * the shape OR the accent intent)". GTK holds a LIST, so `.pill.suggested-action` is
     * an ordinary Adwaita button and was unreachable through the enum. The names are the
     * CLASS names now, not the web element's attribute spellings: `suggested-action`,
     * not `suggested`.
     *
     * From XML it is a space-separated list, which is what an attribute can carry:
     * `<gtk:Button cssClasses="pill suggested-action" />`.
     */
    get cssClasses(): string[] {
        return [...this._cssClasses];
    }

    set cssClasses(value: string | null | undefined) {
        this._cssClasses = normalizeCssClasses(value);
        this.className = classNameWith('adw-button', this._cssClasses);
    }
}
