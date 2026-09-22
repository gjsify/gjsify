// AdwBottomSheet — a Libadwaita-style bottom sheet for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` overlaying a content layer (row-spanned)
// with a bottom-anchored sheet panel that is shown/hidden. Mirrors
// `Adw.BottomSheet`: `set_content()` (the always-visible body), `set_sheet()` (the
// panel that slides up), `open`, `can-close` and the `close-attempt` signal.
//
// The open state and the dismissal gate are NOT implemented here: they live in
// `@gjsify/adwaita-core` (`BottomSheetPresentation` + `resolveBottomSheetClose`,
// ADR 0004), ported from the C source and shared with `@gjsify/adwaita-web`. The
// NS half is `widgets/bottom-sheet-state.ts`, which is where the spec drives it
// from — this module cannot be imported off-device (`extends GridLayout`).
//
// `requestClose(source)` is the INTERACTIVE entry point, so a host can route the
// Android back button or an in-sheet close button through the same gate the browser
// port uses; writing `open` is the PROGRAMMATIC path and deliberately ignores
// `can-close`, as upstream says outright. The drag handle does NOT close on tap:
// libadwaita builds it `can_focus = FALSE`, `can_target = FALSE`, a decorative pill
// whose only behavioural role is `allow_mouse_drag = show_drag_handle || bottom_bar`.
//
// THE BOTTOM BAR IS THE WAY IN. `set_bottom_bar()` gives the sheet the collapsed form it
// morphs out of, and a tap on it is the ONLY affordance libadwaita offers a user for
// opening a sheet (`bottom_bar_released_cb`, adw-bottom-sheet.c:263-284). Without one, a
// sheet can be opened by its host and by nobody on the device — which is what this port
// shipped, and what left easy6502's quick help unreachable on Android while its GNOME
// original (whose `editor.blp` declares `bottom-bar` and writes `open` nowhere) worked.
//
// FIDELITY: compromised on the slide + scrim. This CSS subset has no z-index,
// box-shadow or translate transition, so the sheet is bottom-aligned in the grid and
// toggled by `visibility`: instant show/hide, no upward slide, no dimming
// scrim/backdrop-blur. The look and the state machine are faithful; an app wanting the
// slide wraps the `open` write in `view.animate({ translate })`. (A `modal` sheet on a
// phone is more naturally a native `Dialogs`/modal Page — this targets the in-page form.)
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-bottom-sheet`.
// Reference: refs/libadwaita/src/adw-bottom-sheet.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_bottom-sheet.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';
import { GridLayout, ItemSpec, Label, StackLayout } from '@nativescript/core';
import type {
    BottomSheetCloseOutcome,
    BottomSheetCloseSource,
    BottomSheetOpenOutcome,
    BottomSheetOpenSource,
} from '@gjsify/adwaita-core';

import {
    BOTTOM_BAR_CLASS,
    CLOSE_ATTEMPT,
    NOTIFY_OPEN,
    SHEET_CLOSE,
    addMarkerClass,
    applyBottomSheetChrome,
    createBottomSheetPresentation,
    removeMarkerClass,
    requestBottomSheetClose,
    type BottomSheetPanes,
    type NotifyOpenEventData,
} from './bottom-sheet-state.js';
import { builderSlotsOf, resolveBuilderSlot } from './builder-slots.js';
import { xmlBoolean } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { attachRowPressFeedback } from './row-press.js';
import { withSignals } from './signals.js';

export { CLOSE_ATTEMPT, NOTIFY_OPEN, SHEET_CLOSE };
export type { NotifyOpenEventData };

/** Marker class applied to the view handed to {@link AdwBottomSheet.set_content}. */
const CONTENT_CLASS = 'adw-bottom-sheet-content';
/** Marker class applied to the view handed to {@link AdwBottomSheet.set_sheet}. */
const SHEET_CLASS = 'adw-bottom-sheet-sheet';

/** The three layers an XML child of a bottom sheet can ask for. */
const BOTTOM_SHEET_SLOTS = ['sheet', 'bottomBar', 'content'] as const;

export class AdwBottomSheet extends withSignals(GridLayout) {
    /** The names this widget's `_addChildFromBuilder` honours — see `./builder-slots.ts`. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(BOTTOM_SHEET_SLOTS, 'content');

    /** The always-visible content layer. */
    private _content: View | null = null;
    /** The bottom-anchored bin holding both layers — libadwaita's `sheet_bin`. */
    protected readonly _sheetPanel: StackLayout;
    /** The sheet page inside the bin: drag handle + sheet child. */
    private readonly _sheetPage: StackLayout;
    /** The bottom-bar bin — the bin's other layer, tapped to open the sheet. */
    private readonly _bottomBarBin: StackLayout;
    private _sheetChild: View | null = null;
    private _bottomBar: View | null = null;
    /** The shared open/can-close model — the single source of truth for both. */
    private readonly _state = createBottomSheetPresentation();

    constructor(props?: ConstructProps<AdwBottomSheet>) {
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
        GridLayout.setColumn(sheetPanel, 0);
        GridLayout.setRow(sheetPanel, 0);

        // The bin's two layers. In libadwaita they are one `GtkStack`; here they are two
        // siblings whose visibility {@link applyBottomSheetChrome} drives together, because
        // toggling them separately is how a port paints a bar over an open sheet.
        const bottomBarBin = new StackLayout();
        bottomBarBin.orientation = 'vertical';
        bottomBarBin.className = BOTTOM_BAR_CLASS;
        // The tap is the affordance. `requestOpen` still runs the gate, so `can-open` off
        // keeps the bar tappable and refuses, exactly as the C handler does.
        bottomBarBin.addEventListener('tap', () => this.requestOpen('bottom-bar'));
        attachRowPressFeedback(bottomBarBin);
        sheetPanel.addChild(bottomBarBin);

        const sheetPage = new StackLayout();
        sheetPage.orientation = 'vertical';
        sheetPanel.addChild(sheetPage);

        const handle = new Label();
        handle.text = '━';
        handle.className = 'adw-bottom-sheet-handle';
        handle.horizontalAlignment = 'center';
        // can_target = FALSE (adw-bottom-sheet.c:1198) — the handle is decorative
        // and must not swallow (or act on) a tap.
        handle.isUserInteractionEnabled = false;
        sheetPage.addChild(handle);

        this.addChild(sheetPanel);
        this._sheetPanel = sheetPanel;
        this._sheetPage = sheetPage;
        this._bottomBarBin = bottomBarBin;
        this._paintChrome();

        this._state.subscribe((open) => {
            this._paintChrome();
            const data: NotifyOpenEventData = { eventName: NOTIFY_OPEN, object: this, open };
            this.notify(data);
        });

        applyConstructProps(this, props);
    }

    /** Push the current chrome onto the three views — the widget's whole rendering step. */
    private _paintChrome(): void {
        const panes: BottomSheetPanes = {
            panel: this._sheetPanel,
            page: this._sheetPage,
            bottomBar: this._bottomBarBin,
        };
        applyBottomSheetChrome(panes, this._state.chrome);
    }

    /** Set (or replace) the always-visible content layer (painted under the sheet) — `adw_bottom_sheet_set_content`. */
    set_content(view: View | null): void {
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

    /** Set (or replace) the sheet panel's child (shown when open) — `adw_bottom_sheet_set_sheet`. */
    set_sheet(view: View | null): void {
        // adw_bottom_sheet_set_sheet, adw-bottom-sheet.c:1547-1556.
        if (this._sheetChild === view) return;
        if (this._sheetChild) {
            this._sheetChild.className = removeMarkerClass(this._sheetChild.className, SHEET_CLASS);
            this._sheetPage.removeChild(this._sheetChild);
        }
        this._sheetChild = view;
        if (view) {
            view.className = addMarkerClass(view.className, SHEET_CLASS);
            this._sheetPage.addChild(view);
        }
    }

    /**
     * Set (or replace) the bottom bar — `adw_bottom_sheet_set_bottom_bar`, shown in the
     * sheet's place while it is closed.
     *
     * Presence is an INPUT to the open gate, not decoration: taking the bar away takes every
     * on-device way of opening this sheet with it, which is why the state hears about it
     * (upstream re-runs `update_swipe_tracker` from the same setter, adw-bottom-sheet.c:1629).
     */
    set_bottom_bar(view: View | null): void {
        if (this._bottomBar === view) return;
        // No marker class on the bar's own child: the bin carries the styling, and the two
        // markers above exist only because `set_content`/`set_sheet` hand their view to a
        // node this theme does not paint. One fewer class to keep the stylesheet honest about.
        if (this._bottomBar) this._bottomBarBin.removeChild(this._bottomBar);
        this._bottomBar = view;
        if (view) this._bottomBarBin.addChild(view);
        this._state.setHasBottomBar(view !== null);
        this._paintChrome();
    }

    /**
     * An XML child asks for the sheet, the bottom bar or the content, and a bare one is
     * CONTENT — the always-visible layer, which is what a sheet with nothing behind it
     * would be missing. `LayoutBase`'s inherited default would put any of them into the
     * grid alongside the sheet panel, where it neither paints under the sheet nor moves
     * with it.
     */
    _addChildFromBuilder(name: string, view: View): void {
        const slot = resolveBuilderSlot(name, BOTTOM_SHEET_SLOTS, 'content');
        if (slot === 'sheet') this.set_sheet(view);
        else if (slot === 'bottomBar') this.set_bottom_bar(view);
        else this.set_content(view);
    }

    /**
     * The always-visible content layer, or `null`.
     *
     * A read-back for `set_content`: a write-only pane cannot be asserted, and the XML
     * door made that concrete — the gallery probe has to ask the widget where the
     * child it declared actually went.
     */
    get content(): View | null {
        return this._content;
    }

    /** The sheet panel's child, or `null` — the read-back for `set_sheet`. */
    get sheet(): View | null {
        return this._sheetChild;
    }

    /** The bottom bar's child, or `null` — the read-back for `set_bottom_bar`. */
    get bottomBar(): View | null {
        return this._bottomBar;
    }

    /**
     * Whether the sheet is open (`AdwBottomSheet:open`). Toggling shows/hides the panel
     * and emits `notify::open`.
     *
     * Like the GTK property this ignores `can-close`; a user-driven dismissal belongs in
     * {@link requestClose}.
     *
     * BREAKING: was `openState`, and `sheet.open = true` / `= false` replace the port's
     * own `open()` / `close()` methods, which libadwaita has no counterpart for. Why the
     * collision with them was not a reason to keep the divergent name is ADR 0034
     * § Amendment 11.
     */
    get open(): boolean {
        return this._state.open;
    }

    set open(value: boolean | string) {
        this._state.setOpen(xmlBoolean(value, false));
    }

    /**
     * Whether the user may dismiss the sheet (`AdwBottomSheet:can-close`). When
     * off, a refused dismissal emits `close-attempt` instead of closing.
     */
    get canClose(): boolean {
        return this._state.canClose;
    }

    set canClose(raw: boolean | string) {
        const value = xmlBoolean(raw, this.canClose);
        this._state.setCanClose(value);
    }

    /**
     * Whether the user may open the sheet from its bottom bar (`AdwBottomSheet:can-open`).
     *
     * Off, the bar STAYS on screen and only gains the inert marker: libadwaita refuses the
     * click in the handler rather than disabling the button (adw-bottom-sheet.c:2031-2038).
     * There is no `open-attempt` signal to answer with, so a refused tap is silent.
     */
    get canOpen(): boolean {
        return this._state.canOpen;
    }

    set canOpen(raw: boolean | string) {
        if (!this._state.setCanOpen(xmlBoolean(raw, this.canOpen))) return;
        this._paintChrome();
    }

    /** Whether the bottom bar is shown while the sheet is closed (`AdwBottomSheet:reveal-bottom-bar`). */
    get revealBottomBar(): boolean {
        return this._state.revealBottomBar;
    }

    set revealBottomBar(raw: boolean | string) {
        if (!this._state.setRevealBottomBar(xmlBoolean(raw, this.revealBottomBar))) return;
        this._paintChrome();
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

    /**
     * Route an open affordance through the shared gate — the bar's own tap goes through
     * here, and a host with a gesture of its own passes `'swipe'`.
     *
     * Unlike {@link requestClose} there is nothing to emit on a refusal: libadwaita has no
     * `open-attempt` counterpart to `close-attempt`, so `'ignored'` is silent.
     */
    requestOpen(source: BottomSheetOpenSource): BottomSheetOpenOutcome {
        return this._state.requestOpen(source);
    }
}
