// AdwWindowTitle — a Libadwaita-style window title for NativeScript.
//
// Renders a REAL NativeScript vertical `StackLayout` with a centered bold title
// `Label` and a dim subtitle `Label`, intended as the title view of an
// `ActionBar` (the NS analogue of a GTK header bar).
//
// The two labels, their visibility and the change detection are HEADLESS and
// live in `@gjsify/adwaita-core` (ADR 0004) as `WindowTitleState`, shared with
// `@gjsify/adwaita-web`. Three rules from adw-window-title.c this port did not
// have: the TITLE hides when empty (C:207-208 — the template even starts it
// `visible=False`, adw-window-title.ui:15), a set to the value already held
// returns early (C:203-204, :244-245), and a real change notifies (C:210, :251).
// Only the subtitle was ever hidden, so a header showing just a subtitle
// reserved a blank title line above it.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `_headerbar.scss` (title bold,
// subtitle dim/smaller).
// Reference: refs/libadwaita/src/adw-window-title.c, adw-window-title.ui
// Reference: refs/libadwaita/src/stylesheet/widgets/_header-bar.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Label, StackLayout, type EventData } from '@nativescript/core';
import { WindowTitleState, toLabelVisuals } from './row-state.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

/** Event name emitted when {@link AdwWindowTitle.title} changes. */
export const NOTIFY_TITLE = 'notify::title';

/** Event name emitted when {@link AdwWindowTitle.subtitle} changes. */
export const NOTIFY_SUBTITLE = 'notify::subtitle';

export class AdwWindowTitle extends StackLayout {
    /** The bold title label. */
    protected readonly _titleLabel: Label;
    /** The dim subtitle label. */
    protected readonly _subtitleLabel: Label;
    /** The headless title/subtitle pair + change detection (ADR 0004). */
    private readonly _state = new WindowTitleState();

    constructor(props?: ConstructProps<AdwWindowTitle>) {
        super();

        this.orientation = 'vertical';
        this.className = 'adw-window-title';
        this.horizontalAlignment = 'center';

        const titleLabel = new Label();
        titleLabel.className = 'adw-window-title-title';
        titleLabel.horizontalAlignment = 'center';
        this.addChild(titleLabel);
        this._titleLabel = titleLabel;

        // Both labels stay in the tree and collapse when empty — the same shape
        // `preferences-group-state.ts` and the action row use. Adding/removing
        // them made the rule structural, which is why it was only ever applied
        // to one of the two.
        const subtitleLabel = new Label();
        subtitleLabel.className = 'adw-window-title-subtitle';
        subtitleLabel.horizontalAlignment = 'center';
        this.addChild(subtitleLabel);
        this._subtitleLabel = subtitleLabel;

        this._apply();

        applyConstructProps(this, props);
    }

    /** The window title (bold, top line). Empty collapses its label. */
    get title(): string {
        return this._state.title;
    }

    set title(value: string) {
        if (!this._state.setTitle(value)) return;
        this._apply();
        this._notify(NOTIFY_TITLE);
    }

    /** The subtitle (dim second line). Empty collapses its label. */
    get subtitle(): string {
        return this._state.subtitle;
    }

    set subtitle(value: string) {
        if (!this._state.setSubtitle(value)) return;
        this._apply();
        this._notify(NOTIFY_SUBTITLE);
    }

    /** Push the derived text + visibility onto the two `Label`s. */
    private _apply(): void {
        const visuals = toLabelVisuals(this._state.state);
        this._titleLabel.text = visuals.title;
        this._titleLabel.visibility = visuals.titleVisibility;
        this._subtitleLabel.text = visuals.subtitle;
        this._subtitleLabel.visibility = visuals.subtitleVisibility;
    }

    private _notify(eventName: string): void {
        const data: EventData = { eventName, object: this };
        this.notify(data);
    }
}
