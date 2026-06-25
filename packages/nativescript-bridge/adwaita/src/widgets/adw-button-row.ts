// AdwButtonRow — a Libadwaita-style button row for NativeScript.
//
// Extends {@link AdwActionRow}: a boxed-list row that is itself tappable, with a
// centered/accent title and an optional leading glyph. Mirrors `Adw.ButtonRow`:
// the whole row acts as a button, emitting `activated` (the Adw signal) on tap.
// Use inside an {@link AdwPreferencesGroup} like any other row.
//
// FIDELITY: faithful. The row is a real tappable `GridLayout`; the centered accent
// label matches `Adw.ButtonRow`'s default. The optional `startIcon` is a leading
// glyph `Label` (NS subset has no icon-theme lookup — pass an emoji / font glyph),
// the same approximation `AdwStatusPage` uses.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-button-row`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (.row.button)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Label, StackLayout, type EventData } from '@nativescript/core';
import { AdwActionRow } from './adw-action-row.js';

/** Event name emitted when the row is tapped. Mirrors `Adw.ButtonRow::activated`. */
export const ACTIVATED = 'activated';

export class AdwButtonRow extends AdwActionRow {
    /** The horizontal content box (leading glyph + centered title). */
    protected readonly _contentBox: StackLayout;
    /** The leading glyph label (lazily added — only when an icon is set). */
    protected readonly _startIconLabel: Label;
    private _hasStartIcon = false;

    constructor() {
        super();

        this.className = 'adw-row adw-action-row adw-button-row';

        // Replace the inherited title stack content presentation: hide the default
        // title label (still used as the data sink) and present a centered content
        // box in its place. We reuse the inherited `_titleLabel` as the accent text.
        this._titleLabel.className = 'adw-button-row-title';
        this._titleLabel.horizontalAlignment = 'center';

        // Wrap the inherited title label inside a horizontal box so an optional
        // leading glyph can sit before it, both centered.
        this._textStack.removeChild(this._titleLabel);
        const contentBox = new StackLayout();
        contentBox.orientation = 'horizontal';
        contentBox.className = 'adw-button-row-content';
        contentBox.horizontalAlignment = 'center';

        const startIcon = new Label();
        startIcon.className = 'adw-button-row-start-icon';

        contentBox.addChild(this._titleLabel);
        this._textStack.addChild(contentBox);
        this._textStack.horizontalAlignment = 'center';
        this._contentBox = contentBox;
        this._startIconLabel = startIcon;

        // The whole row is the button.
        this.addEventListener('tap', () => {
            const data: EventData = { eventName: ACTIVATED, object: this };
            this.notify(data);
        });
    }

    /**
     * A leading glyph before the centered title (emoji / font glyph). Setting a
     * non-empty value inserts it; empty removes it.
     */
    get startIcon(): string {
        return this._hasStartIcon ? (this._startIconLabel.text ?? '') : '';
    }

    set startIcon(value: string) {
        const text = value ?? '';
        this._startIconLabel.text = text;
        const want = text.length > 0;
        if (want && !this._hasStartIcon) {
            // Glyph goes BEFORE the title (index 0 in the content box).
            this._contentBox.removeChild(this._titleLabel);
            this._contentBox.addChild(this._startIconLabel);
            this._contentBox.addChild(this._titleLabel);
            this._hasStartIcon = true;
        } else if (!want && this._hasStartIcon) {
            this._contentBox.removeChild(this._startIconLabel);
            this._hasStartIcon = false;
        }
    }
}
