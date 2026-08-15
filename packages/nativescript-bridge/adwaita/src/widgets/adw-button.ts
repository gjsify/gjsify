// AdwButton — a Libadwaita-style button for NativeScript.
//
// Extends the REAL NativeScript `Button` and exposes a `variant` property that
// applies the Adwaita button style classes (`.suggested-action` / `.destructive-action`
// / `.flat` / `.pill`), styled in `src/theme/adwaita.css`. Mirrors how libadwaita
// buttons get their look from a CSS style class rather than a distinct widget:
// pill radius, accent fill for suggested, red text for destructive, transparent
// for flat.
//
// Visual spec ported from `@gjsify/adwaita-web` + libadwaita button styles.
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { ADW_BUTTON_STYLE_CLASSES, type AdwButtonStyleClass, buttonStyleClass } from '@gjsify/adwaita-core';
import { Button } from '@nativescript/core';

/**
 * The Adwaita button variants this widget can apply. `'default'` = plain button.
 *
 * The class list is `@gjsify/adwaita-core`'s, not a local table: this widget's own
 * one was MISSING `circular`, which the browser element had, and neither file could
 * see the other. `circular` is now here because the shared table says it exists.
 */
export type AdwButtonVariant = 'default' | AdwButtonStyleClass;

export class AdwButton extends Button {
    private _variant: AdwButtonVariant = 'default';

    constructor() {
        super();
        this.className = 'adw-button';
        // Adwaita buttons are FLAT — kill the Android Material elevation/shadow so
        // suggested/destructive/flat/pill don't render as raised Material buttons.
        this.set('androidElevation', 0);
    }

    /**
     * The Adwaita style variant. Setting it swaps the corresponding CSS class
     * (one of `AdwButton.variantClasses`) onto the button,
     * preserving the base `adw-button` class. Note that `pill` is the rounded
     * SHAPE and combines with no other variant here (set the shape OR the accent
     * intent — matching how this CSS subset expresses them as flat classes).
     */
    get variant(): AdwButtonVariant {
        return this._variant;
    }

    set variant(value: AdwButtonVariant) {
        this._variant = value;
        const styleClass = value === 'default' ? null : buttonStyleClass(value);
        this.className = styleClass ? `adw-button ${styleClass}` : 'adw-button';
    }

    /**
     * All Adwaita variant class names this widget recognises — exposed for tests
     * and for consumers composing class lists manually.
     */
    static get variantClasses(): readonly string[] {
        return ADW_BUTTON_STYLE_CLASSES;
    }
}
