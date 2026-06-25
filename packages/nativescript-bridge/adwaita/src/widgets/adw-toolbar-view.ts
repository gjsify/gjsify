// AdwToolbarView — a Libadwaita-style toolbar view for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (rows `auto, *, auto`): a top-bar slot
// (header bars / toolbars), an expanding content slot, and a bottom-bar slot.
// Mirrors `Adw.ToolbarView`: `addTopBar()` / `setContent()` / `addBottomBar()`.
//
// FIDELITY: faithful. The vertical top/content/bottom arrangement maps directly
// onto an NS `GridLayout`. Adwaita's automatic top/bottom-bar "raised" shadow on
// scroll is not reproducible (no scroll-linked shadow in the CSS subset) — the
// bars carry a static hairline separator instead.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-toolbar-view`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_toolbars.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, StackLayout, View } from '@nativescript/core';

export class AdwToolbarView extends GridLayout {
    /** The top-bar slot (row 0) — stack of header bars / toolbars. */
    protected readonly _topBox: StackLayout;
    /** The bottom-bar slot (row 2) — stack of bottom toolbars. */
    protected readonly _bottomBox: StackLayout;
    /** The currently-installed content view (row 1), if any. */
    private _content: View | null = null;

    constructor() {
        super();

        this.className = 'adw-toolbar-view';

        this.addColumn(new ItemSpec(1, 'star'));
        // Rows: top hugs, content expands, bottom hugs.
        this.addRow(new ItemSpec(1, 'auto'));
        this.addRow(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'auto'));

        const topBox = new StackLayout();
        topBox.orientation = 'vertical';
        topBox.className = 'adw-toolbar-view-top';
        GridLayout.setRow(topBox, 0);
        this.addChild(topBox);
        this._topBox = topBox;

        const bottomBox = new StackLayout();
        bottomBox.orientation = 'vertical';
        bottomBox.className = 'adw-toolbar-view-bottom';
        GridLayout.setRow(bottomBox, 2);
        this.addChild(bottomBox);
        this._bottomBox = bottomBox;
    }

    /** Append a widget (e.g. an {@link AdwHeaderBar}) to the top-bar slot. */
    addTopBar(view: View): void {
        this._topBox.addChild(view);
    }

    /** Append a widget to the bottom-bar slot. */
    addBottomBar(view: View): void {
        this._bottomBox.addChild(view);
    }

    /** Set (or replace) the main content view. Pass `null` to clear it. */
    setContent(view: View | null): void {
        if (this._content) {
            this.removeChild(this._content);
            this._content = null;
        }
        if (view) {
            GridLayout.setRow(view, 1);
            this.addChild(view);
            this._content = view;
        }
    }

    /** The currently-installed content view, or `null`. */
    get content(): View | null {
        return this._content;
    }

    /** The top-bar slot container. */
    get topBar(): StackLayout {
        return this._topBox;
    }

    /** The bottom-bar slot container. */
    get bottomBar(): StackLayout {
        return this._bottomBox;
    }
}
