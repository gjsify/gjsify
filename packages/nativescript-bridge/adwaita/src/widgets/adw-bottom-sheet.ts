// AdwBottomSheet — a Libadwaita-style bottom sheet for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` overlaying a content layer (row-spanned)
// with a bottom-anchored sheet panel that is shown/hidden. Mirrors
// `Adw.BottomSheet`: `setContent()` (the always-visible body), `setSheet()` (the
// panel that slides up), `open`/`close`, `can-close` and the `close-attempt`
// signal.
//
// The open state and the dismissal gate are NOT implemented here: they live in
// `@gjsify/adwaita-core` (`BottomSheetPresentation` + `resolveBottomSheetClose`,
// ADR 0004), ported from the C source and shared with `@gjsify/adwaita-web`. The
// NS half is `widgets/bottom-sheet-state.ts`, which is where the spec drives it
// from — this module cannot be imported off-device (`extends GridLayout`).
//
// Two behaviours arrived with that lift and one left:
//   + `can-close` is honoured, and a refused dismissal emits `close-attempt`.
//     Before this, a locked sheet was silently dismissable here.
//   + `requestClose(source)` is the interactive entry point, so a host can route
//     the Android back button / an in-sheet close button through the same gate
//     the browser port uses. `open()`/`close()` stay the PROGRAMMATIC pair and
//     deliberately ignore `can-close` ("Bottom sheet can still be closed using
//     [property@BottomSheet:open]", adw-bottom-sheet.c:2071).
//   - the drag handle no longer closes the sheet on tap. libadwaita builds it
//     with can_focus = FALSE and can_target = FALSE (adw-bottom-sheet.c:1197-1198):
//     it is a decorative pill whose only behavioural role is
//     `allow_mouse_drag = show_drag_handle || bottom_bar`.
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
// Reference: refs/libadwaita/src/adw-bottom-sheet.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_bottom-sheet.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, StackLayout, View } from '@nativescript/core';
import type { BottomSheetCloseOutcome, BottomSheetCloseSource } from '@gjsify/adwaita-core';

import {
    CLOSE_ATTEMPT,
    NOTIFY_OPEN,
    SHEET_CLOSE,
    addMarkerClass,
    applySheetVisibility,
    createBottomSheetPresentation,
    removeMarkerClass,
    requestBottomSheetClose,
    sheetVisibility,
    type NotifyOpenEventData,
} from './bottom-sheet-state.js';

export { CLOSE_ATTEMPT, NOTIFY_OPEN, SHEET_CLOSE };
export type { NotifyOpenEventData };

/** Marker class applied to the view handed to {@link AdwBottomSheet.setContent}. */
const CONTENT_CLASS = 'adw-bottom-sheet-content';
/** Marker class applied to the view handed to {@link AdwBottomSheet.setSheet}. */
const SHEET_CLASS = 'adw-bottom-sheet-sheet';

export class AdwBottomSheet extends GridLayout {
    /** The always-visible content layer. */
    private _content: View | null = null;
    /** The bottom sheet panel wrapper (drag handle + sheet child). */
    protected readonly _sheetPanel: StackLayout;
    private _sheetChild: View | null = null;
    /** The shared open/can-close model — the single source of truth for both. */
    private readonly _state = createBottomSheetPresentation();

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
        sheetPanel.visibility = sheetVisibility(this._state.open);
        GridLayout.setColumn(sheetPanel, 0);
        GridLayout.setRow(sheetPanel, 0);

        const handle = new Label();
        handle.text = '━';
        handle.className = 'adw-bottom-sheet-handle';
        handle.horizontalAlignment = 'center';
        // can_target = FALSE (adw-bottom-sheet.c:1198) — the handle is decorative
        // and must not swallow (or act on) a tap.
        handle.isUserInteractionEnabled = false;
        sheetPanel.addChild(handle);

        this.addChild(sheetPanel);
        this._sheetPanel = sheetPanel;

        this._state.subscribe((open) => {
            applySheetVisibility(this._sheetPanel, open);
            const data: NotifyOpenEventData = { eventName: NOTIFY_OPEN, object: this, open };
            this.notify(data);
        });
    }

    /** Set (or replace) the always-visible content layer (painted under the sheet). */
    setContent(view: View | null): void {
        // `adw_bottom_sheet_set_content` early-returns on an unchanged widget
        // (adw-bottom-sheet.c:1497-1498); without that guard the marker class
        // was appended again on every call.
        if (this._content === view) return;
        if (this._content) {
            this._content.className = removeMarkerClass(this._content.className, CONTENT_CLASS);
            this.removeChild(this._content);
        }
        this._content = view;
        if (view) {
            view.className = addMarkerClass(view.className, CONTENT_CLASS);
            GridLayout.setColumn(view, 0);
            GridLayout.setRow(view, 0);
            // Insert BELOW the sheet panel so the panel paints on top.
            this.insertChild(view, 0);
        }
    }

    /** Set (or replace) the sheet panel's child (shown when open). */
    setSheet(view: View | null): void {
        // adw_bottom_sheet_set_sheet, adw-bottom-sheet.c:1547-1556.
        if (this._sheetChild === view) return;
        if (this._sheetChild) {
            this._sheetChild.className = removeMarkerClass(this._sheetChild.className, SHEET_CLASS);
            this._sheetPanel.removeChild(this._sheetChild);
        }
        this._sheetChild = view;
        if (view) {
            view.className = addMarkerClass(view.className, SHEET_CLASS);
            this._sheetPanel.addChild(view);
        }
    }

    /** Open the sheet programmatically. */
    open(): void {
        this.openState = true;
    }

    /**
     * Close the sheet programmatically. Like `AdwBottomSheet:open` this ignores
     * `can-close`; a user-driven dismissal belongs in {@link requestClose}.
     */
    close(): void {
        this.openState = false;
    }

    /** Whether the sheet is open. Toggling shows/hides the panel + emits `notify::open`. */
    get openState(): boolean {
        return this._state.open;
    }

    set openState(value: boolean) {
        this._state.setOpen(value);
    }

    /**
     * Whether the user may dismiss the sheet (`AdwBottomSheet:can-close`). When
     * off, a refused dismissal emits `close-attempt` instead of closing.
     */
    get canClose(): boolean {
        return this._state.canClose;
    }

    set canClose(value: boolean) {
        this._state.setCanClose(value);
    }

    /**
     * Route a dismissal affordance through the shared gate and act on the
     * verdict: close, emit `close-attempt`, emit `sheet.close` for the host to
     * forward, or do nothing.
     *
     * NativeScript has no Escape key and no widget-level back handling, so the
     * HOST routes what it has here — typically Android's back button as
     * `requestClose('escape')` and an in-sheet close button as
     * `requestClose('close-button')`.
     */
    requestClose(source: BottomSheetCloseSource): BottomSheetCloseOutcome {
        const { outcome, eventName } = requestBottomSheetClose(this._state, source);
        if (eventName) this.notify({ eventName, object: this });
        return outcome;
    }
}
