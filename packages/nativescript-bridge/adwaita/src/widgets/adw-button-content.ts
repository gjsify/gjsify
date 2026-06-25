// AdwButtonContent — a Libadwaita-style icon+label content for NativeScript.
//
// Renders a REAL NativeScript horizontal `StackLayout` with a leading glyph
// `Label` and a text `Label`, meant to be placed as the child content of a button
// (or used as the label widget of an {@link AdwSplitButton}). Mirrors
// `Adw.ButtonContent`: `iconName` + `label`.
//
// FIDELITY: approximated for the icon. `Adw.ButtonContent` shows a themed symbolic
// icon; the NS subset has no icon-theme lookup, so `iconName` is rendered as a
// glyph `Label` (pass an emoji or font glyph). The icon+label horizontal pairing
// is otherwise faithful.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-button-content`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (.button .content)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Label, StackLayout } from '@nativescript/core';

export class AdwButtonContent extends StackLayout {
    /** The leading glyph label (lazily in the tree — only when an icon is set). */
    protected readonly _iconLabel: Label;
    /** The text label. */
    protected readonly _label: Label;
    private _hasIcon = false;

    constructor() {
        super();

        this.orientation = 'horizontal';
        this.className = 'adw-button-content';
        this.horizontalAlignment = 'center';

        const iconLabel = new Label();
        iconLabel.className = 'adw-button-content-icon';
        iconLabel.verticalAlignment = 'middle';
        this._iconLabel = iconLabel;

        const label = new Label();
        label.className = 'adw-button-content-label';
        label.verticalAlignment = 'middle';
        this.addChild(label);
        this._label = label;
    }

    /**
     * A leading glyph (emoji / font glyph; the NS subset has no icon-theme lookup).
     * Setting a non-empty value inserts it before the label; empty removes it.
     */
    get iconName(): string {
        return this._hasIcon ? (this._iconLabel.text ?? '') : '';
    }

    set iconName(value: string) {
        const text = value ?? '';
        this._iconLabel.text = text;
        const want = text.length > 0;
        if (want && !this._hasIcon) {
            this.removeChild(this._label);
            this.addChild(this._iconLabel);
            this.addChild(this._label);
            this._hasIcon = true;
        } else if (!want && this._hasIcon) {
            this.removeChild(this._iconLabel);
            this._hasIcon = false;
        }
    }

    /** The button content text. */
    get label(): string {
        return this._label.text ?? '';
    }

    set label(value: string) {
        this._label.text = value ?? '';
    }
}
