// AdwBottomSheet — a Libadwaita-style bottom sheet for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` overlaying a content layer (row-spanned)
// with a bottom-anchored sheet panel that is shown/hidden. Mirrors
// `Adw.BottomSheet`: `setContent()` (the always-visible body), `setSheet()` (the
// panel that slides up), `open`/`close`, and a `notify::open` event.
//
// FIDELITY: compromised on the slide + scrim. NS has no z-index / box-shadow /
// translate transition in this CSS subset, so the sheet is bottom-aligned within
// the grid and toggled by `visibility` (instant show/hide, NO upward slide
// animation and NO dimming scrim/backdrop-blur over the content). The
// content-underneath + drag-handle + rounded-top-sheet LOOK and the open/close
// state machine are faithful; a real NS app wanting the slide can wrap `open`/
// `close` in `view.animate({ translate })`, which is outside this widget's
// CSS-subset contract. (A `modal` bottom sheet on a phone would more naturally be
// a native `Dialogs`/modal Page — this widget targets the in-page sheet form.)
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-bottom-sheet`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_bottom-sheet.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, StackLayout, View, type EventData } from '@nativescript/core';

/** Event name emitted when {@link AdwBottomSheet.open} changes. Mirrors GObject `notify::open`. */
export const NOTIFY_OPEN = 'notify::open';

/** Payload of the `notify::open` event. */
export interface NotifyOpenEventData extends EventData {
    /** Whether the sheet is now open. */
    open: boolean;
}

export class AdwBottomSheet extends GridLayout {
    /** The always-visible content layer. */
    private _content: View | null = null;
    /** The bottom sheet panel wrapper (drag handle + sheet child). */
    protected readonly _sheetPanel: StackLayout;
    private _sheetChild: View | null = null;
    private _open = false;

    constructor() {
        super();

        this.className = 'adw-bottom-sheet';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));

        // The sheet panel is bottom-anchored within the (single-cell) grid and
        // painted last so it sits on top of the content.
        const sheetPanel = new StackLayout();
        sheetPanel.orientation = 'vertical';
        sheetPanel.className = 'adw-bottom-sheet-panel';
        sheetPanel.verticalAlignment = 'bottom';
        sheetPanel.visibility = 'collapse';
        GridLayout.setColumn(sheetPanel, 0);
        GridLayout.setRow(sheetPanel, 0);

        const handle = new Label();
        handle.text = '━';
        handle.className = 'adw-bottom-sheet-handle';
        handle.horizontalAlignment = 'center';
        handle.addEventListener('tap', () => this.close());
        sheetPanel.addChild(handle);

        this.addChild(sheetPanel);
        this._sheetPanel = sheetPanel;
    }

    /** Set (or replace) the always-visible content layer (painted under the sheet). */
    setContent(view: View | null): void {
        if (this._content) this.removeChild(this._content);
        this._content = view;
        if (view) {
            view.className = `${view.className ?? ''} adw-bottom-sheet-content`.trim();
            GridLayout.setColumn(view, 0);
            GridLayout.setRow(view, 0);
            // Insert BELOW the sheet panel so the panel paints on top.
            this.insertChild(view, 0);
        }
    }

    /** Set (or replace) the sheet panel's child (shown when open). */
    setSheet(view: View | null): void {
        if (this._sheetChild) this._sheetPanel.removeChild(this._sheetChild);
        this._sheetChild = view;
        if (view) {
            view.className = `${view.className ?? ''} adw-bottom-sheet-sheet`.trim();
            this._sheetPanel.addChild(view);
        }
    }

    /** Open the sheet. */
    open(): void {
        this.openState = true;
    }

    /** Close the sheet. */
    close(): void {
        this.openState = false;
    }

    /** Whether the sheet is open. Toggling shows/hides the panel + emits `notify::open`. */
    get openState(): boolean {
        return this._open;
    }

    set openState(value: boolean) {
        const next = !!value;
        if (next === this._open) return;
        this._open = next;
        this._sheetPanel.visibility = next ? 'visible' : 'collapse';
        const data: NotifyOpenEventData = {
            eventName: NOTIFY_OPEN,
            object: this,
            open: next,
        };
        this.notify(data);
    }
}
