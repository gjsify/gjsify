// AdwButtonRow — a Libadwaita-style button row for NativeScript.
//
// Extends {@link AdwActionRow}: a boxed-list row that is itself tappable, with a
// centered/accent title and an optional leading glyph. Mirrors `Adw.ButtonRow`:
// the whole row acts as a button, emitting `activated` (the Adw signal) on tap.
// Use inside an {@link AdwPreferencesGroup} like any other row.
//
// FIDELITY: faithful. The row is a real tappable `GridLayout`; the centered accent
// label matches `Adw.ButtonRow`'s default. The optional `startIcon` is a REAL
// Adwaita symbolic icon (an {@link AdwIcon}, accent-coloured to match the title).
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-button-row`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (.row.button)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { StackLayout, type EventData } from '@nativescript/core';
import { AdwActionRow } from './adw-action-row.js';
import { AdwIcon } from './adw-icon.js';
import { attachRowPressFeedback } from './row-press.js';

/** The Adwaita accent (suggested) colour the button-row title + start icon use. */
const ADW_ACCENT = '#3584e4';

/** Event name emitted when the row is tapped. Mirrors `Adw.ButtonRow::activated`. */
export const ACTIVATED = 'activated';

export class AdwButtonRow extends AdwActionRow {
    /** The horizontal content box (leading icon + centered title). */
    protected readonly _contentBox: StackLayout;
    /** The leading symbolic icon (lazily added — only when an icon is set). */
    protected readonly _startIcon: AdwIcon;
    private _hasStartIcon = false;
    private _startIconSvg = '';

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

        const startIcon = new AdwIcon();
        startIcon.className = `${startIcon.className} adw-button-row-start-icon`.trim();
        startIcon.verticalAlignment = 'middle';
        startIcon.iconColor = ADW_ACCENT;

        contentBox.addChild(this._titleLabel);
        this._textStack.addChild(contentBox);
        this._textStack.horizontalAlignment = 'center';
        this._contentBox = contentBox;
        this._startIcon = startIcon;

        // The whole row is the button.
        this.addEventListener('tap', () => {
            const data: EventData = { eventName: ACTIVATED, object: this };
            this.notify(data);
        });
        // ...and darkens on press, like an Adwaita `.button` row.
        attachRowPressFeedback(this);
    }

    /**
     * A leading Adwaita symbolic SVG string before the centered title (e.g.
     * `listAddSymbolic`). Setting a non-empty value inserts it; empty removes it.
     */
    get startIcon(): string {
        return this._startIconSvg;
    }

    set startIcon(value: string) {
        this._startIconSvg = value ?? '';
        this._startIcon.icon = this._startIconSvg;
        const want = this._startIconSvg.length > 0;
        if (want && !this._hasStartIcon) {
            // Icon goes BEFORE the title (index 0 in the content box).
            this._contentBox.removeChild(this._titleLabel);
            this._contentBox.addChild(this._startIcon);
            this._contentBox.addChild(this._titleLabel);
            this._hasStartIcon = true;
        } else if (!want && this._hasStartIcon) {
            this._contentBox.removeChild(this._startIcon);
            this._hasStartIcon = false;
        }
    }

    /**
     * The start icon's fill colour (hex). Defaults to the Adwaita accent; callers
     * set the destructive red when the row carries `destructive-action` so the
     * symbolic icon matches the title colour (the icon bitmap is pre-coloured, so
     * CSS cannot recolour it).
     */
    get startIconColor(): string {
        return this._startIcon.iconColor;
    }

    set startIconColor(value: string) {
        this._startIcon.iconColor = value || ADW_ACCENT;
    }
}
