// AdwPreferencesPage — a Libadwaita-style preferences page for NativeScript.
//
// Renders a REAL NativeScript `ScrollView` wrapping a vertical `StackLayout` that
// holds `AdwPreferencesGroup`s — the page-level wrapper that scrolls its content,
// mirroring `Adw.PreferencesPage`. Styled via the `adw-preferences-page` CSS class
// (see `src/theme/adwaita.css`) — NOT a webview.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `_preferences.scss`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_preferences.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { ScrollView, StackLayout, View } from '@nativescript/core';

export class AdwPreferencesPage extends ScrollView {
    /** The vertical stack that actually holds the groups. */
    protected readonly _content: StackLayout;

    constructor() {
        super();

        this.orientation = 'vertical';
        this.className = 'adw-preferences-page';

        const content = new StackLayout();
        content.orientation = 'vertical';
        content.className = 'adw-preferences-page-content';

        // ScrollView holds exactly one scrollable child via its `content` slot.
        this.content = content;
        this._content = content;
    }

    /** Append a preferences group (or any view) to the page. */
    addGroup(view: View): void {
        this._content.addChild(view);
    }

    /** Remove a previously-added group from the page. */
    removeGroup(view: View): void {
        this._content.removeChild(view);
    }

    /** The vertical content stack holding the groups. */
    get groups(): StackLayout {
        return this._content;
    }
}
