// Bottom-sheet dismissal conformance vectors — the spec all three
// implementations are held to.
//
// `Adw.BottomSheet` has FOUR dismissal paths and they are four different gates. Collapsing
// them into one predicate —
// `if (!open) return; if (!canClose) { emit close-attempt; return; } open = false;` — is
// right for exactly one of the four. These rows are the difference, and three of them are
// counter-intuitive:
//   - the drag handle is `can_target = FALSE`, i.e. not clickable at all, so it is not the
//     primary close button;
//   - Escape on a CLOSED sheet still emits `close-attempt`;
//   - the `sheet.close` action on a closed sheet DELEGATES to the parent.
//
// Reference: refs/libadwaita/src/adw-bottom-sheet.c
// Reference: refs/libadwaita/src/adw-dialog.c (the closing/closed callback pair)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { BottomSheetCloseOutcome, BottomSheetCloseSource, BottomSheetTeardownCallback } from '../dialog.js';

/** One `resolveBottomSheetClose` expectation. */
export interface BottomSheetCloseVector {
    /** Which affordance asked to close. */
    source: BottomSheetCloseSource;
    /** `AdwBottomSheet:open` at the time of the request. */
    open: boolean;
    /** `AdwBottomSheet:can-close` at the time of the request. */
    canClose: boolean;
    /** What the C source does with it. */
    outcome: BottomSheetCloseOutcome;
    rule: string;
    derivedFrom: string;
}

/**
 * The full decision table — every `(source, open, canClose)` combination that is
 * distinguishable, so a renderer cannot pass by implementing three of the four
 * paths and aliasing the fourth.
 */
export const BOTTOM_SHEET_CLOSE_VECTORS: ReadonlyArray<BottomSheetCloseVector> = [
    // --- dimming (the modal scrim) ---
    {
        source: 'dimming',
        open: true,
        canClose: true,
        outcome: 'close',
        rule: 'a scrim click on an unlocked open sheet closes it',
        derivedFrom: 'released_cb, adw-bottom-sheet.c:236-240',
    },
    {
        source: 'dimming',
        open: true,
        canClose: false,
        outcome: 'close-attempt',
        rule: 'a locked sheet SIGNALS the scrim click instead of swallowing it',
        derivedFrom: 'released_cb, adw-bottom-sheet.c:237-238',
    },
    {
        source: 'dimming',
        open: false,
        canClose: true,
        outcome: 'ignored',
        rule: 'the scrim is not an event target while the sheet is closed, so nothing happens and nothing is signalled',
        derivedFrom: 'gtk_widget_set_can_target (self->dimming, open), adw-bottom-sheet.c:1148 + 1692',
    },
    {
        source: 'dimming',
        open: false,
        canClose: false,
        outcome: 'ignored',
        rule: 'unreachable-while-closed beats the can-close signal — a locked CLOSED sheet says nothing',
        derivedFrom: 'adw-bottom-sheet.c:1692 (reachability) before released_cb:237',
    },

    // --- escape (the Esc shortcut on the sheet bin) ---
    {
        source: 'escape',
        open: true,
        canClose: true,
        outcome: 'close',
        rule: 'Escape closes an unlocked open sheet',
        derivedFrom: 'maybe_close_cb, adw-bottom-sheet.c:393-395',
    },
    {
        source: 'escape',
        open: true,
        canClose: false,
        outcome: 'close-attempt',
        rule: 'Escape on a locked sheet signals',
        derivedFrom: 'maybe_close_cb, adw-bottom-sheet.c:398',
    },
    {
        source: 'escape',
        open: false,
        canClose: true,
        outcome: 'close-attempt',
        rule: 'THE SURPRISING ONE: Escape on a closed-but-focused sheet still signals, because the emit is the fallthrough for every case that is not (can_close && open). The sheet bin stays focusable while it shows a bottom bar. Both ports returned nothing here',
        derivedFrom: 'maybe_close_cb, adw-bottom-sheet.c:393-399',
    },
    {
        source: 'escape',
        open: false,
        canClose: false,
        outcome: 'close-attempt',
        rule: 'the fallthrough covers this corner too',
        derivedFrom: 'maybe_close_cb, adw-bottom-sheet.c:398',
    },

    // --- close-button (the `sheet.close` widget action) ---
    {
        source: 'close-button',
        open: true,
        canClose: true,
        outcome: 'close',
        rule: 'the sheet.close action closes an unlocked open sheet',
        derivedFrom: 'sheet_close_cb, adw-bottom-sheet.c:377-380',
    },
    {
        source: 'close-button',
        open: true,
        canClose: false,
        outcome: 'close-attempt',
        rule: 'can_close is tested FIRST, before the open check',
        derivedFrom: 'sheet_close_cb, adw-bottom-sheet.c:372-375',
    },
    {
        source: 'close-button',
        open: false,
        canClose: true,
        outcome: 'delegate',
        rule: 'sheet.close on an already-closed sheet forwards the action to the PARENT (a sheet inside a sheet closes the outer one) rather than doing nothing',
        derivedFrom: 'sheet_close_cb, adw-bottom-sheet.c:382-385',
    },
    {
        source: 'close-button',
        open: false,
        canClose: false,
        outcome: 'close-attempt',
        rule: 'a locked sheet never reaches the delegation branch — the can_close guard returns first',
        derivedFrom: 'sheet_close_cb, adw-bottom-sheet.c:372-375',
    },

    // --- drag-handle (decorative) ---
    {
        source: 'drag-handle',
        open: true,
        canClose: true,
        outcome: 'ignored',
        rule: 'THE SHARED MISTAKE: the drag handle is not an event target in libadwaita, so it closes nothing. Both ports had wired it to close the sheet',
        derivedFrom: 'gtk_widget_set_can_focus/can_target (self->drag_handle, FALSE), adw-bottom-sheet.c:1197-1198',
    },
    {
        source: 'drag-handle',
        open: true,
        canClose: false,
        outcome: 'ignored',
        rule: 'not a can-close question at all — a decorative widget cannot attempt anything',
        derivedFrom: 'adw-bottom-sheet.c:1197-1198',
    },
    {
        source: 'drag-handle',
        open: false,
        canClose: true,
        outcome: 'ignored',
        rule: 'its only behavioural role is elsewhere: allow_mouse_drag = show_drag_handle || bottom_bar',
        derivedFrom: 'adw-bottom-sheet.c:1197-1198 + update_swipe_tracker:455-457',
    },

    // --- swipe (the AdwSwipeTracker gesture) ---
    {
        source: 'swipe',
        open: true,
        canClose: true,
        outcome: 'close',
        rule: 'a downward swipe past the midpoint closes an unlocked open sheet',
        derivedFrom: 'prepare_cb adw-bottom-sheet.c:1050 → end_swipe_cb adw-bottom-sheet.c:1099-1103',
    },
    {
        source: 'swipe',
        open: true,
        canClose: false,
        outcome: 'ignored',
        rule: 'a locked sheet swallows the swipe SILENTLY — prepare_cb refuses to detect it, so unlike the scrim and Escape there is no close-attempt',
        derivedFrom: 'prepare_cb, adw-bottom-sheet.c:1050-1051',
    },
    {
        source: 'swipe',
        open: false,
        canClose: true,
        outcome: 'ignored',
        rule: 'a swipe on a closed sheet is an OPEN gesture (gated by can-open), never a close one',
        derivedFrom: 'prepare_cb, adw-bottom-sheet.c:1052-1053',
    },
];

/** One step of a {@link BottomSheetPresentationVector}, in the order it is applied. */
export type BottomSheetPresentationStep =
    /** The programmatic path — `adw_bottom_sheet_set_open`, ignores `can-close`. */
    | { readonly kind: 'setOpen'; readonly open: boolean }
    /** `adw_bottom_sheet_set_can_close`. */
    | { readonly kind: 'setCanClose'; readonly canClose: boolean }
    /** The interactive path — runs the {@link BOTTOM_SHEET_CLOSE_VECTORS} gate. */
    | { readonly kind: 'requestClose'; readonly source: BottomSheetCloseSource };

/**
 * One end-to-end presentation expectation.
 *
 * Every field except `callbacks`/`hasBeenOpen` is observable from a RENDERER too
 * — `notifications` is the `notify::open` event stream, `outcomes` is what the
 * widget's `requestClose()` returns — so the same row drives the core suite, the
 * browser suite and the NativeScript suite. `callbacks` and `hasBeenOpen` are
 * the core-only seam `AdwDialog` consumes.
 */
export interface BottomSheetPresentationVector {
    /** Applied in order, through the surface every implementation exposes. */
    steps: readonly BottomSheetPresentationStep[];
    /** The outcome of each `requestClose` step, in order (other steps contribute nothing). */
    outcomes: readonly BottomSheetCloseOutcome[];
    /** Every `notify::open` payload, in order. A spurious notification makes this longer. */
    notifications: readonly boolean[];
    /** The `closing`/`closed` callback log — core-only (`adw_bottom_sheet_set_callbacks`). */
    callbacks: readonly BottomSheetTeardownCallback[];
    /** `open` after the last step. */
    open: boolean;
    /** `has_been_open` after the last step. */
    hasBeenOpen: boolean;
    rule: string;
    derivedFrom: string;
}

/**
 * The three-method surface a {@link BottomSheetPresentationVector} is replayed
 * against. Core implements it directly; each renderer implements it by driving
 * its REAL widget (an attribute write, a property set, a `requestClose()` call),
 * so the same script exercises the same behaviour on every side.
 */
export interface BottomSheetPresentationAdapter {
    /** The programmatic path (`AdwBottomSheet:open`). */
    setOpen(open: boolean): void;
    /** `AdwBottomSheet:can-close`. */
    setCanClose(canClose: boolean): void;
    /** The interactive path — returns what the gate decided. */
    requestClose(source: BottomSheetCloseSource): BottomSheetCloseOutcome;
}

/**
 * Replay a vector's steps against `adapter`, collecting the outcome of each
 * `requestClose` step in order. Shared by all three suites so no side can drift
 * in HOW it replays a row.
 */
export function runBottomSheetSteps(
    adapter: BottomSheetPresentationAdapter,
    steps: readonly BottomSheetPresentationStep[],
): BottomSheetCloseOutcome[] {
    const outcomes: BottomSheetCloseOutcome[] = [];
    for (const step of steps) {
        switch (step.kind) {
            case 'setOpen':
                adapter.setOpen(step.open);
                break;
            case 'setCanClose':
                adapter.setCanClose(step.canClose);
                break;
            case 'requestClose':
                outcomes.push(adapter.requestClose(step.source));
                break;
        }
    }
    return outcomes;
}

/**
 * `adw_bottom_sheet_set_open`'s state machine as scripts: the idempotent guard,
 * the never-been-open teardown replay, and which paths notify.
 *
 * The `notifications` column caught a live bug: emitting `notify::open` whenever the open
 * ATTRIBUTE VALUE changes rather than when the open STATE changes makes
 * `setAttribute('open','')` then `setAttribute('open','false')` fire a second notification
 * carrying an unchanged payload.
 */
export const BOTTOM_SHEET_PRESENTATION_VECTORS: ReadonlyArray<BottomSheetPresentationVector> = [
    {
        steps: [],
        outcomes: [],
        notifications: [],
        callbacks: [],
        open: false,
        hasBeenOpen: false,
        rule: 'a fresh sheet is closed, unlocked and has never been open',
        derivedFrom: 'adw_bottom_sheet_init adw-bottom-sheet.c:1125-1133 + the open pspec default at :852-855',
    },
    {
        steps: [{ kind: 'setOpen', open: true }],
        outcomes: [],
        notifications: [true],
        callbacks: [],
        open: true,
        hasBeenOpen: true,
        rule: 'opening notifies once and latches has_been_open',
        derivedFrom: 'adw-bottom-sheet.c:1684-1689 + the notify at :1777',
    },
    {
        steps: [
            { kind: 'setOpen', open: true },
            { kind: 'setOpen', open: true },
        ],
        outcomes: [],
        notifications: [true],
        callbacks: [],
        open: true,
        hasBeenOpen: true,
        rule: 'setting the current value again is a no-op — no second notification',
        derivedFrom: 'adw-bottom-sheet.c:1672-1682',
    },
    {
        steps: [{ kind: 'setOpen', open: false }],
        outcomes: [],
        notifications: [],
        callbacks: ['closing', 'closed'],
        open: false,
        hasBeenOpen: false,
        rule: 'THE REPLAY: closing a sheet that was NEVER open changes nothing and notifies nothing, but still fires closing+closed — this is how a dialog dismissed before it ever animated in gets torn down',
        derivedFrom: 'adw-bottom-sheet.c:1672-1682',
    },
    {
        steps: [
            { kind: 'setOpen', open: true },
            { kind: 'setOpen', open: false },
            { kind: 'setOpen', open: false },
        ],
        outcomes: [],
        notifications: [true, false],
        callbacks: ['closing'],
        open: false,
        hasBeenOpen: true,
        rule: 'once has_been_open is set the replay branch is skipped: the third call fires NOTHING',
        derivedFrom: 'adw-bottom-sheet.c:1673 (the !has_been_open guard) + :1689',
    },
    {
        steps: [
            { kind: 'setCanClose', canClose: false },
            { kind: 'setOpen', open: true },
            { kind: 'setOpen', open: false },
        ],
        outcomes: [],
        notifications: [true, false],
        callbacks: ['closing'],
        open: false,
        hasBeenOpen: true,
        rule: 'can-close does NOT gate the programmatic path — "Bottom sheet can still be closed using [property@BottomSheet:open]"',
        derivedFrom:
            'adw_bottom_sheet_set_open adw-bottom-sheet.c:1661-1778 (never reads can_close) + the doc at :2071',
    },
    {
        steps: [
            { kind: 'setOpen', open: true },
            { kind: 'requestClose', source: 'dimming' },
        ],
        outcomes: ['close'],
        notifications: [true, false],
        callbacks: ['closing'],
        open: false,
        hasBeenOpen: true,
        rule: 'an accepted dismissal runs the same close path as the programmatic one',
        derivedFrom: 'released_cb adw-bottom-sheet.c:239 → adw_bottom_sheet_set_open',
    },
    {
        steps: [
            { kind: 'setOpen', open: true },
            { kind: 'setCanClose', canClose: false },
            { kind: 'requestClose', source: 'dimming' },
            { kind: 'requestClose', source: 'escape' },
            { kind: 'requestClose', source: 'swipe' },
        ],
        outcomes: ['close-attempt', 'close-attempt', 'ignored'],
        notifications: [true],
        callbacks: [],
        open: true,
        hasBeenOpen: true,
        rule: 'a locked sheet signals the scrim and Escape but swallows the swipe — three affordances, two different answers',
        derivedFrom: 'released_cb:237-238 + maybe_close_cb:398 + prepare_cb:1050-1051',
    },
    {
        steps: [
            { kind: 'setOpen', open: true },
            { kind: 'requestClose', source: 'drag-handle' },
        ],
        outcomes: ['ignored'],
        notifications: [true],
        callbacks: [],
        open: true,
        hasBeenOpen: true,
        rule: 'REGRESSION PIN: tapping the drag handle leaves an open sheet open. Both ports closed it here',
        derivedFrom: 'adw-bottom-sheet.c:1197-1198',
    },
    {
        steps: [
            { kind: 'setOpen', open: true },
            { kind: 'setOpen', open: false },
            { kind: 'requestClose', source: 'escape' },
            { kind: 'requestClose', source: 'close-button' },
        ],
        outcomes: ['close-attempt', 'delegate'],
        notifications: [true, false],
        callbacks: ['closing'],
        open: false,
        hasBeenOpen: true,
        rule: 'REGRESSION PIN: on a closed sheet Escape still signals and sheet.close delegates upward — neither port did either',
        derivedFrom: 'maybe_close_cb:393-399 + sheet_close_cb:382-385',
    },
    {
        steps: [
            { kind: 'setOpen', open: true },
            { kind: 'setCanClose', canClose: false },
            { kind: 'requestClose', source: 'escape' },
            { kind: 'setCanClose', canClose: true },
            { kind: 'requestClose', source: 'escape' },
        ],
        outcomes: ['close-attempt', 'close'],
        notifications: [true, false],
        callbacks: ['closing'],
        open: false,
        hasBeenOpen: true,
        rule: 'unlocking mid-life makes the same affordance start closing',
        derivedFrom: 'adw_bottom_sheet_set_can_close adw-bottom-sheet.c:2076-2091',
    },
];
