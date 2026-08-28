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
// `requestClose(source)` is the INTERACTIVE entry point, so a host can route the
// Android back button or an in-sheet close button through the same gate the browser
// port uses; `open()`/`close()` stay the PROGRAMMATIC pair and deliberately ignore
// `can-close`, as upstream says outright. The drag handle does NOT close on tap:
// libadwaita builds it `can_focus = FALSE`, `can_target = FALSE`, a decorative pill
// whose only behavioural role is `allow_mouse_drag = show_drag_handle || bottom_bar`.
//
// FIDELITY: compromised on the slide + scrim. This CSS subset has no z-index,
// box-shadow or translate transition, so the sheet is bottom-aligned in the grid and
// toggled by `visibility`: instant show/hide, no upward slide, no dimming
// scrim/backdrop-blur. The look and the state machine are faithful; an app wanting the
// slide wraps `open`/`close` in `view.animate({ translate })`. (A `modal` sheet on a
// phone is more naturally a native `Dialogs`/modal Page — this targets the in-page form.)
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
import { resolveBuilderSlot } from './builder-slots.js';
import { xmlBoolean } from './xml-values.js';

export { CLOSE_ATTEMPT, NOTIFY_OPEN, SHEET_CLOSE };
export type { NotifyOpenEventData };

/** Marker class applied to the view handed to {@link AdwBottomSheet.setContent}. */
const CONTENT_CLASS = 'adw-bottom-sheet-content';
/** Marker class applied to the view handed to {@link AdwBottomSheet.setSheet}. */
const SHEET_CLASS = 'adw-bottom-sheet-sheet';

/** The two layers an XML child of a bottom sheet can ask for. */
const BOTTOM_SHEET_SLOTS = ['sheet', 'content'] as const;

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

    /**
     * An XML child asks for the sheet or for the content, and a bare one is CONTENT —
     * the always-visible layer, which is what a sheet with nothing behind it would be
     * missing. `LayoutBase`'s inherited default would put either into the grid
     * alongside the sheet panel, where it neither paints under the sheet nor moves
     * with it.
     */
    _addChildFromBuilder(name: string, view: View): void {
        if (resolveBuilderSlot(name, BOTTOM_SHEET_SLOTS, 'content') === 'sheet') this.setSheet(view);
        else this.setContent(view);
    }

    /**
     * The always-visible content layer, or `null`.
     *
     * A read-back for `setContent`: a write-only pane cannot be asserted, and the XML
     * door made that concrete — the gallery probe has to ask the widget where the
     * child it declared actually went.
     */
    get content(): View | null {
        return this._content;
    }

    /** The sheet panel's child, or `null` — the read-back for `setSheet`. */
    get sheet(): View | null {
        return this._sheetChild;
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

    set openState(value: boolean | string) {
        this._state.setOpen(xmlBoolean(value, false));
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
