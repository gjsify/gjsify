// AdwBottomSheet's NativeScript-specific half — the parts that are not the
// open/closed state machine or the dismissal gate.
//
// Both are HEADLESS in `@gjsify/adwaita-core` as `BottomSheetPresentation` +
// `resolveBottomSheetClose` (ADR 0004), shared with `@gjsify/adwaita-web` and pinned by
// the conformance vectors. NativeScript-specific is how the state becomes pixels: the
// CSS subset has no transform transition, so the sheet panel is toggled between
// `visible` and `collapse` (see `adw-bottom-sheet.ts`), plus which native event each
// gate verdict turns into. TYPE-only NS imports, so specs run off-device (AGENTS.md).
//
// Reference: refs/libadwaita/src/adw-bottom-sheet.c (AdwBottomSheet)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { EventData, View } from '@nativescript/core';
import { BottomSheetPresentation } from '@gjsify/adwaita-core';
import type { BottomSheetChrome, BottomSheetCloseOutcome, BottomSheetCloseSource } from '@gjsify/adwaita-core';

/** Event name emitted when the sheet's open state changes. Mirrors GObject `notify::open`. */
export const NOTIFY_OPEN = 'notify::open';

/**
 * Event name emitted when a dismissal is refused. Mirrors the
 * `AdwBottomSheet::close-attempt` signal (adw-bottom-sheet.c:1010-1026).
 */
export const CLOSE_ATTEMPT = 'close-attempt';

/**
 * Event name emitted when the `sheet.close` action is used on an ALREADY-closed
 * sheet, so the host can forward it to an enclosing sheet/dialog — the NS
 * equivalent of `gtk_widget_activate_action (parent, "sheet.close")`
 * (adw-bottom-sheet.c:382-385).
 */
export const SHEET_CLOSE = 'sheet.close';

/** Payload of the `notify::open` event. */
export interface NotifyOpenEventData extends EventData {
    /** Whether the sheet is now open. */
    open: boolean;
}

/** The two `View.visibility` values the sheet panel ever takes. */
export type NsSheetVisibility = 'visible' | 'collapse';

/** The open/can-close model an `AdwBottomSheet` delegates to. */
export function createBottomSheetPresentation(): BottomSheetPresentation {
    return new BottomSheetPresentation();
}

/**
 * The `visibility` a sheet pane must carry to be shown or not. NS has no transform
 * transition in its CSS subset, so every reveal is instant — the spring animation and its
 * intermediate `progress` are not modelled here.
 */
export function sheetVisibility(shown: boolean): NsSheetVisibility {
    return shown ? 'visible' : 'collapse';
}

/** Marker class on the bottom-bar bin — the collapsed form the sheet morphs out of. */
export const BOTTOM_BAR_CLASS = 'adw-bottom-sheet-bottom-bar';

/**
 * Marker class for a bar that refuses to open (`AdwBottomSheet:can-open` off).
 *
 * libadwaita spells it `inert` on the bin (adw-bottom-sheet.c:2033-2036) and takes only the
 * hover/active feedback away with it; the bar stays a live, focusable button. Prefixed here
 * because every class this port emits is held against `theme/adwaita.css` by name.
 */
export const INERT_CLASS = 'adw-bottom-sheet-inert';

/** Marker class on the scrim a modal sheet lays over its content while it is open. */
export const DIMMING_CLASS = 'adw-bottom-sheet-dimming';

/** The four views a bottom sheet's chrome is painted onto. */
export interface BottomSheetPanes {
    /**
     * The scrim between the content and the sheet — libadwaita's `dimming` gizmo. Painted
     * over the content and under the panel, so a tap on the dimmed area lands HERE and never
     * on the content a modal sheet blocks.
     */
    dimming: View;
    /** The bottom-anchored bin — libadwaita's `sheet_bin`. */
    panel: View;
    /** The sheet page inside it: drag handle plus the sheet child. */
    page: View;
    /** The bottom-bar bin, the page's sibling in the same slot. */
    bottomBar: View;
}

/**
 * Paint a {@link BottomSheetChrome} onto the real views.
 *
 * The two `visibility` writes are ONE stack in libadwaita (`sheet_stack`), so they are
 * mutually exclusive by construction here: NS has no stack, and two independently toggled
 * panes is how a port ends up showing a bar on top of an open sheet.
 */
export function applyBottomSheetChrome(panes: BottomSheetPanes, chrome: BottomSheetChrome): void {
    panes.dimming.visibility = sheetVisibility(chrome.dimmed);
    panes.panel.visibility = sheetVisibility(chrome.surfaceVisible);
    panes.page.visibility = sheetVisibility(chrome.layer === 'sheet');
    panes.bottomBar.visibility = sheetVisibility(chrome.layer === 'bottom-bar');
    panes.bottomBar.className = chrome.bottomBarInert
        ? addMarkerClass(panes.bottomBar.className, INERT_CLASS)
        : removeMarkerClass(panes.bottomBar.className, INERT_CLASS);
}

/**
 * Which event a gate verdict makes the widget emit, or `null` when it emits
 * nothing.
 *
 * `'close'` is absent on purpose: the state applies it, and the resulting
 * `notify::open` IS the notification. `'ignored'` is the genuinely silent one —
 * a locked sheet swallowing a swipe, or a tap on the decorative drag handle.
 */
export function bottomSheetCloseEvent(outcome: BottomSheetCloseOutcome): string | null {
    switch (outcome) {
        case 'close-attempt':
            return CLOSE_ATTEMPT;
        case 'delegate':
            return SHEET_CLOSE;
        case 'close':
        case 'ignored':
            return null;
    }
}

/** What a dismissal request produced: the verdict plus the event to emit, if any. */
export interface BottomSheetCloseResult {
    /** The gate's verdict, already applied to the state. */
    outcome: BottomSheetCloseOutcome;
    /** Event name for `notify()`, or `null` when the gate is silent. */
    eventName: string | null;
}

/**
 * The whole of `AdwBottomSheet.requestClose` except the `notify()` call.
 *
 * It lives HERE rather than inside the `extends GridLayout` module so the spec
 * can drive the real path: a spec that re-assembled `state.requestClose()` and
 * `bottomSheetCloseEvent()` itself would be transcribing the code under test and
 * could not detect the drift it exists to catch.
 */
export function requestBottomSheetClose(
    state: BottomSheetPresentation,
    source: BottomSheetCloseSource,
): BottomSheetCloseResult {
    const outcome = state.requestClose(source);
    return { outcome, eventName: bottomSheetCloseEvent(outcome) };
}

/** Split a NativeScript `className` into its individual classes. */
function classList(className: string | null | undefined): string[] {
    return (className ?? '').split(' ').filter((entry) => entry.length > 0);
}

/**
 * Add a marker class to a view's `className` exactly once.
 *
 * libadwaita never writes to the child's own style classes — the marker lives on
 * the internal bin (`adw_bottom_sheet_set_content`, adw-bottom-sheet.c:1497-1510).
 * This port does write it, and used to do so with a bare string concat, so
 * `set_content(v)` twice left `'adw-bottom-sheet-content adw-bottom-sheet-content'`.
 */
export function addMarkerClass(className: string | null | undefined, marker: string): string {
    const classes = classList(className);
    if (!classes.includes(marker)) classes.push(marker);
    return classes.join(' ');
}

/**
 * Drop a marker class again — a view replaced by another must not keep the
 * marker of the slot it no longer occupies.
 */
export function removeMarkerClass(className: string | null | undefined, marker: string): string {
    return classList(className)
        .filter((entry) => entry !== marker)
        .join(' ');
}
