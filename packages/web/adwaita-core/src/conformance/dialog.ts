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

import type {
    BottomSheetChrome,
    BottomSheetCloseOutcome,
    BottomSheetCloseSource,
    BottomSheetOpenOutcome,
    BottomSheetOpenSource,
    BottomSheetSwipeTrackerConfig,
    BottomSheetSwipeTrackerState,
    BottomSheetTeardownCallback,
} from '../dialog.js';

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
            { kind: 'requestClose', source: 'dimming' },
            { kind: 'setOpen', open: true },
        ],
        outcomes: ['close'],
        notifications: [true, false, true],
        callbacks: ['closing'],
        open: true,
        hasBeenOpen: true,
        rule: 'a dismissed sheet re-opens, and notifies a third time. Every other row stops at its first close, so a close path that latched (a listener torn down and never re-attached, a state that only travels one way) would leave the whole table green',
        derivedFrom:
            'adw_bottom_sheet_set_open adw-bottom-sheet.c:1661-1778: has_been_open (:1673) gates only the teardown replay, never a later open',
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

// --- Bottom-sheet OPEN conformance vectors ---
//
// `Adw.BottomSheet` has one user-facing way in, and it is the bottom bar. Neither port had
// it, so neither port could be opened by a user at all: the browser element and the
// NativeScript widget both exposed `open` and stopped there, and an app whose only
// affordance IS the bar (easy6502's GNOME editor declares `bottom-bar` and writes `open`
// from nowhere) lost its sheet entirely in the port.
//
// Three of the four inputs below are REACHABILITY rather than a branch in a callback, which
// is why reading `bottom_bar_released_cb` alone is not enough to implement this.
//
// Reference: refs/libadwaita/src/adw-bottom-sheet.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** One `resolveBottomSheetOpen` expectation. */
export interface BottomSheetOpenVector {
    /** Which affordance asked to open. */
    source: BottomSheetOpenSource;
    /** `AdwBottomSheet:open` at the time of the request. */
    open: boolean;
    /** `AdwBottomSheet:can-open` at the time of the request. */
    canOpen: boolean;
    /** Whether `AdwBottomSheet:bottom-bar` is set. */
    hasBottomBar: boolean;
    /** `AdwBottomSheet:reveal-bottom-bar`. */
    revealBottomBar: boolean;
    /** What the C source does with it. */
    outcome: BottomSheetOpenOutcome;
    rule: string;
    derivedFrom: string;
}

/**
 * Every distinguishable `(source, open, canOpen, hasBottomBar, revealBottomBar)` the open
 * gate answers differently for — so a renderer cannot pass by wiring the bar to `open = true`
 * and calling it done.
 */
export const BOTTOM_SHEET_OPEN_VECTORS: ReadonlyArray<BottomSheetOpenVector> = [
    // --- bottom-bar (the click, pointer or keyboard) ---
    {
        source: 'bottom-bar',
        open: false,
        canOpen: true,
        hasBottomBar: true,
        revealBottomBar: true,
        outcome: 'open',
        rule: 'THE AFFORDANCE: clicking the bottom bar of a closed, unlocked sheet opens it. This is the row both ports were missing, and with it the only way in',
        derivedFrom:
            'bottom_bar_released_cb, adw-bottom-sheet.c:279-280 (and bottom_bar_clicked_cb:404-406 for the keyboard door)',
    },
    {
        source: 'bottom-bar',
        open: false,
        canOpen: false,
        hasBottomBar: true,
        revealBottomBar: true,
        outcome: 'ignored',
        rule: 'can-open off refuses the click, and refuses it SILENTLY — there is no open-attempt signal to answer with',
        derivedFrom: 'bottom_bar_released_cb, adw-bottom-sheet.c:269-272',
    },
    {
        source: 'bottom-bar',
        open: false,
        canOpen: true,
        hasBottomBar: false,
        revealBottomBar: true,
        outcome: 'ignored',
        rule: 'NO BAR, NO DOOR: with bottom-bar unset the stack never shows the bin, so can-open has nothing to gate — upstream says so in the property docs',
        derivedFrom:
            'show_bottom_bar adw-bottom-sheet.c:294-295 + set_bottom_bar:1615-1616 + the can-open doc at :2013',
    },
    {
        source: 'bottom-bar',
        open: false,
        canOpen: false,
        hasBottomBar: false,
        revealBottomBar: true,
        outcome: 'ignored',
        rule: 'both gates shut is still one answer',
        derivedFrom: 'adw-bottom-sheet.c:269-272 + :294-295',
    },
    {
        source: 'bottom-bar',
        open: false,
        canOpen: true,
        hasBottomBar: true,
        revealBottomBar: false,
        outcome: 'ignored',
        rule: 'a bar that is not revealed is off screen, so there is nothing to click — the sheet bin is child-invisible at rest',
        derivedFrom: 'reveal_animation_done_cb, adw-bottom-sheet.c:362-364 (same expression at :341-343)',
    },
    {
        source: 'bottom-bar',
        open: true,
        canOpen: true,
        hasBottomBar: true,
        revealBottomBar: true,
        outcome: 'ignored',
        rule: 'an open sheet shows the sheet page, not the bar: the affordance is not on screen to be clicked twice',
        derivedFrom: 'adw_bottom_sheet_set_open, adw-bottom-sheet.c:1701-1702',
    },

    // --- swipe (the AdwSwipeTracker gesture, upward) ---
    {
        source: 'swipe',
        open: false,
        canOpen: true,
        hasBottomBar: true,
        revealBottomBar: true,
        outcome: 'open',
        rule: 'an upward swipe off the bar opens the sheet — the tracker arm that is live precisely when a bar exists',
        derivedFrom: 'update_swipe_tracker adw-bottom-sheet.c:451-453 + prepare_cb:1052-1053',
    },
    {
        source: 'swipe',
        open: false,
        canOpen: false,
        hasBottomBar: true,
        revealBottomBar: true,
        outcome: 'ignored',
        rule: 'prepare_cb refuses to detect an opening swipe on a sheet that may not be opened',
        derivedFrom: 'prepare_cb, adw-bottom-sheet.c:1052-1053',
    },
    {
        source: 'swipe',
        open: false,
        canOpen: true,
        hasBottomBar: false,
        revealBottomBar: true,
        outcome: 'ignored',
        rule: 'THE QUIET ONE: with no bar the tracker may still be enabled by can-close, but the swipe AREA is a zero-height rectangle at progress 0, so no drag ever starts. can-open cannot rescue it',
        derivedFrom: 'get_swipe_area, adw-bottom-sheet.c:1412-1433 (bottom_bar_height = 0, so rect.height = 0)',
    },
    {
        source: 'swipe',
        open: true,
        canOpen: true,
        hasBottomBar: true,
        revealBottomBar: true,
        outcome: 'ignored',
        rule: 'a gesture on an OPEN sheet is a dismissal, handled by the close gate — never a second open',
        derivedFrom: 'prepare_cb, adw-bottom-sheet.c:1050-1051',
    },

    // --- drag-handle (decorative, exactly as in the close gate) ---
    {
        source: 'drag-handle',
        open: false,
        canOpen: true,
        hasBottomBar: true,
        revealBottomBar: true,
        outcome: 'ignored',
        rule: 'REGRESSION PIN: the handle is untargetable, so it is not the way in either. Making it the open affordance to compensate for a missing bottom bar would contradict BOTTOM_SHEET_CLOSE_VECTORS, which pins the same widget as inert on the way out',
        derivedFrom: 'gtk_widget_set_can_focus/can_target (self->drag_handle, FALSE), adw-bottom-sheet.c:1197-1198',
    },
    {
        source: 'drag-handle',
        open: false,
        canOpen: true,
        hasBottomBar: false,
        revealBottomBar: true,
        outcome: 'ignored',
        rule: 'and it is not a fallback for a sheet without a bar — a decorative widget has no state in which it acts',
        derivedFrom: 'adw-bottom-sheet.c:1196-1198',
    },
];

/** One `resolveBottomSheetSwipeTracker` expectation. */
export interface BottomSheetSwipeTrackerVector {
    /** The four properties `update_swipe_tracker` reads. */
    state: BottomSheetSwipeTrackerState;
    /** The three settings it writes. */
    config: BottomSheetSwipeTrackerConfig;
    rule: string;
    derivedFrom: string;
}

/**
 * `update_swipe_tracker`'s three assignments, row by row.
 *
 * CORE-ONLY: an `AdwSwipeTracker` has no counterpart in either port — neither renderer runs a
 * gesture tracker, so there is no object to read these settings off. Its `enabled` line is
 * the same fact as the `'swipe'` rows of BOTTOM_SHEET_OPEN_VECTORS and BOTTOM_SHEET_CLOSE_VECTORS,
 * which both renderers drive against their real widgets; this table is the third assignment
 * and the conjunction written out, not a second source of truth.
 */
export const BOTTOM_SHEET_SWIPE_TRACKER_VECTORS: ReadonlyArray<BottomSheetSwipeTrackerVector> = [
    {
        state: { canOpen: true, canClose: false, hasBottomBar: false, showDragHandle: true },
        config: { enabled: false, allowMouseDrag: true, lowerOvershoot: false },
        rule: 'THE CONJUNCT: can-open alone does not enable the tracker — the `&& bottom_bar != NULL` beside it is why a barless sheet is unopenable by gesture',
        derivedFrom: 'update_swipe_tracker, adw-bottom-sheet.c:451-453',
    },
    {
        state: { canOpen: true, canClose: false, hasBottomBar: true, showDragHandle: true },
        config: { enabled: true, allowMouseDrag: true, lowerOvershoot: true },
        rule: 'with a bar, can-open enables the tracker on its own — a sheet that can be opened but never dismissed by gesture',
        derivedFrom: 'adw-bottom-sheet.c:451-453 + :458-459',
    },
    {
        state: { canOpen: false, canClose: true, hasBottomBar: false, showDragHandle: true },
        config: { enabled: true, allowMouseDrag: true, lowerOvershoot: false },
        rule: 'the other arm: can-close enables it with no bar at all, which is the barless sheet every port shipped — a tracker that exists only to CLOSE',
        derivedFrom: 'adw-bottom-sheet.c:451-453',
    },
    {
        state: { canOpen: false, canClose: false, hasBottomBar: true, showDragHandle: true },
        config: { enabled: false, allowMouseDrag: true, lowerOvershoot: true },
        rule: 'both gates shut disables the tracker even though a bar exists — presence of a bar is necessary, never sufficient',
        derivedFrom: 'adw-bottom-sheet.c:451-453',
    },
    {
        state: { canOpen: true, canClose: true, hasBottomBar: true, showDragHandle: false },
        config: { enabled: true, allowMouseDrag: true, lowerOvershoot: true },
        rule: 'a bar substitutes for the drag handle as the thing a MOUSE may drag — the handle is decorative, but it is what allow_mouse_drag keys on when there is no bar',
        derivedFrom: 'adw-bottom-sheet.c:455-457',
    },
    {
        state: { canOpen: true, canClose: true, hasBottomBar: false, showDragHandle: false },
        config: { enabled: true, allowMouseDrag: false, lowerOvershoot: false },
        rule: 'no handle and no bar leaves a touch-only tracker: enabled by can-close, but nothing on screen invites a mouse to drag it',
        derivedFrom: 'adw-bottom-sheet.c:455-459',
    },
];

/** One step of a {@link BottomSheetBottomBarVector}, in the order it is applied. */
export type BottomSheetBottomBarStep =
    /** `adw_bottom_sheet_set_bottom_bar` — a widget, or NULL. */
    | { readonly kind: 'setBottomBar'; readonly present: boolean }
    /** `adw_bottom_sheet_set_can_open`. */
    | { readonly kind: 'setCanOpen'; readonly canOpen: boolean }
    /** `adw_bottom_sheet_set_reveal_bottom_bar`. */
    | { readonly kind: 'setRevealBottomBar'; readonly reveal: boolean }
    /** `adw_bottom_sheet_set_modal`. */
    | { readonly kind: 'setModal'; readonly modal: boolean }
    /** The programmatic path — `adw_bottom_sheet_set_open`, ignores `can-open`. */
    | { readonly kind: 'setOpen'; readonly open: boolean }
    /** The interactive path — runs the {@link BOTTOM_SHEET_OPEN_VECTORS} gate. */
    | { readonly kind: 'requestOpen'; readonly source: BottomSheetOpenSource };

/**
 * One end-to-end bottom-bar expectation.
 *
 * Every field is observable from a RENDERER: `chrome` is what it has to paint (which layer
 * shows, whether the surface is on screen, whether the bar looks inert) and `notifications`
 * is the `notify::open` stream. So the same row drives the core suite and both renderer
 * suites against their real widgets.
 */
export interface BottomSheetBottomBarVector {
    /** Applied in order, through the surface every implementation exposes. */
    steps: readonly BottomSheetBottomBarStep[];
    /** The outcome of each `requestOpen` step, in order. */
    outcomes: readonly BottomSheetOpenOutcome[];
    /** Every `notify::open` payload, in order. */
    notifications: readonly boolean[];
    /** `open` after the last step. */
    open: boolean;
    /** What the renderer must be showing after the last step. */
    chrome: BottomSheetChrome;
    rule: string;
    derivedFrom: string;
}

/**
 * The three-plus-two-method surface a {@link BottomSheetBottomBarVector} is replayed
 * against. Core implements it directly; each renderer implements it by driving its REAL
 * widget (adopting a bar child, writing an attribute, clicking the bar).
 */
export interface BottomSheetBottomBarAdapter {
    /** Give the sheet a bottom bar, or take it away (`AdwBottomSheet:bottom-bar`). */
    setBottomBar(present: boolean): void;
    /** `AdwBottomSheet:can-open`. */
    setCanOpen(canOpen: boolean): void;
    /** `AdwBottomSheet:reveal-bottom-bar`. */
    setRevealBottomBar(reveal: boolean): void;
    /** `AdwBottomSheet:modal`. */
    setModal(modal: boolean): void;
    /** The programmatic path (`AdwBottomSheet:open`). */
    setOpen(open: boolean): void;
    /** The interactive path — returns what the gate decided. */
    requestOpen(source: BottomSheetOpenSource): BottomSheetOpenOutcome;
}

/**
 * Replay a vector's steps against `adapter`, collecting the outcome of each `requestOpen`
 * step in order. Shared by all three suites so no side can drift in HOW it replays a row.
 */
export function runBottomSheetBottomBarSteps(
    adapter: BottomSheetBottomBarAdapter,
    steps: readonly BottomSheetBottomBarStep[],
): BottomSheetOpenOutcome[] {
    const outcomes: BottomSheetOpenOutcome[] = [];
    for (const step of steps) {
        switch (step.kind) {
            case 'setBottomBar':
                adapter.setBottomBar(step.present);
                break;
            case 'setCanOpen':
                adapter.setCanOpen(step.canOpen);
                break;
            case 'setRevealBottomBar':
                adapter.setRevealBottomBar(step.reveal);
                break;
            case 'setModal':
                adapter.setModal(step.modal);
                break;
            case 'setOpen':
                adapter.setOpen(step.open);
                break;
            case 'requestOpen':
                outcomes.push(adapter.requestOpen(step.source));
                break;
        }
    }
    return outcomes;
}

/** The bottom bar's life as scripts: adopting one, gating it, revealing it, clicking it. */
export const BOTTOM_SHEET_BOTTOM_BAR_VECTORS: ReadonlyArray<BottomSheetBottomBarVector> = [
    {
        steps: [],
        outcomes: [],
        notifications: [],
        open: false,
        chrome: { layer: 'sheet', surfaceVisible: false, bottomBarInert: false, dimmed: false },
        rule: 'a fresh sheet has NO bottom bar and is off screen — but can-open already defaults TRUE, so the gate is open and only the bar is missing',
        derivedFrom: 'adw_bottom_sheet_init adw-bottom-sheet.c:1129-1132 + the can-open pspec default at :940-943',
    },
    {
        steps: [{ kind: 'setBottomBar', present: true }],
        outcomes: [],
        notifications: [],
        open: false,
        chrome: { layer: 'bottom-bar', surfaceVisible: true, bottomBarInert: false, dimmed: false },
        rule: 'adopting a bar puts the sheet bin on screen showing the BAR, without opening anything and without notifying',
        derivedFrom: 'adw_bottom_sheet_set_bottom_bar adw-bottom-sheet.c:1613-1627',
    },
    {
        steps: [
            { kind: 'setBottomBar', present: true },
            { kind: 'requestOpen', source: 'bottom-bar' },
        ],
        outcomes: ['open'],
        notifications: [true],
        open: true,
        chrome: { layer: 'sheet', surfaceVisible: true, bottomBarInert: false, dimmed: true },
        rule: 'THE WHOLE POINT: the bar is clicked, the sheet opens, and the bin morphs from bar to sheet',
        derivedFrom: 'bottom_bar_released_cb adw-bottom-sheet.c:279-280 -> set_open:1701-1702',
    },
    {
        steps: [{ kind: 'requestOpen', source: 'bottom-bar' }],
        outcomes: ['ignored'],
        notifications: [],
        open: false,
        chrome: { layer: 'sheet', surfaceVisible: false, bottomBarInert: false, dimmed: false },
        rule: 'REGRESSION PIN: with no bar there is no affordance, and the sheet stays unreachable. This is the state both ports shipped in, and the reason a consumer reached for `open = true` beside the widget',
        derivedFrom: 'adw-bottom-sheet.c:294-295 + the can-open doc at :2013',
    },
    {
        steps: [
            { kind: 'setBottomBar', present: true },
            { kind: 'setCanOpen', canOpen: false },
            { kind: 'requestOpen', source: 'bottom-bar' },
            { kind: 'requestOpen', source: 'swipe' },
        ],
        outcomes: ['ignored', 'ignored'],
        notifications: [],
        open: false,
        chrome: { layer: 'bottom-bar', surfaceVisible: true, bottomBarInert: true, dimmed: false },
        rule: 'a locked-open bar STAYS ON SCREEN and merely looks inert — unlike can-close, which has a signal, can-open just refuses',
        derivedFrom: 'adw_bottom_sheet_set_can_open adw-bottom-sheet.c:2031-2038',
    },
    {
        steps: [
            { kind: 'setBottomBar', present: true },
            { kind: 'setCanOpen', canOpen: false },
            { kind: 'requestOpen', source: 'bottom-bar' },
            { kind: 'setCanOpen', canOpen: true },
            { kind: 'requestOpen', source: 'bottom-bar' },
        ],
        outcomes: ['ignored', 'open'],
        notifications: [true],
        open: true,
        chrome: { layer: 'sheet', surfaceVisible: true, bottomBarInert: false, dimmed: true },
        rule: 'unlocking mid-life makes the same affordance start working, and drops the inert class with it',
        derivedFrom: 'adw-bottom-sheet.c:2028-2040',
    },
    {
        steps: [
            { kind: 'setBottomBar', present: true },
            { kind: 'setRevealBottomBar', reveal: false },
            { kind: 'requestOpen', source: 'bottom-bar' },
        ],
        outcomes: ['ignored'],
        notifications: [],
        open: false,
        chrome: { layer: 'bottom-bar', surfaceVisible: false, bottomBarInert: false, dimmed: false },
        rule: 'hiding the bar hides the whole bin, so the click cannot land — note the layer is still `bottom-bar`: it is the SURFACE that is gone, not the choice of child',
        derivedFrom:
            'adw_bottom_sheet_set_reveal_bottom_bar adw-bottom-sheet.c:2177-2191 + reveal_animation_done_cb:362-364',
    },
    {
        steps: [
            { kind: 'setBottomBar', present: true },
            { kind: 'setRevealBottomBar', reveal: false },
            { kind: 'setOpen', open: true },
        ],
        outcomes: [],
        notifications: [true],
        open: true,
        chrome: { layer: 'sheet', surfaceVisible: true, bottomBarInert: false, dimmed: true },
        rule: 'reveal-bottom-bar governs the BAR, never the sheet: an owner opens a sheet whose bar is hidden and the sheet still shows',
        derivedFrom: 'adw_bottom_sheet_set_open adw-bottom-sheet.c:1686 (child_visible TRUE unconditionally on open)',
    },
    {
        steps: [
            { kind: 'setBottomBar', present: true },
            { kind: 'requestOpen', source: 'bottom-bar' },
            { kind: 'setOpen', open: false },
            { kind: 'requestOpen', source: 'bottom-bar' },
        ],
        outcomes: ['open', 'open'],
        notifications: [true, false, true],
        open: true,
        chrome: { layer: 'sheet', surfaceVisible: true, bottomBarInert: false, dimmed: true },
        rule: 'the bar comes BACK when the sheet closes and opens it again — a port that switched to the sheet page once and never switched back would leave every row above green and the second click dead',
        derivedFrom:
            'adw_bottom_sheet_set_open adw-bottom-sheet.c:1701-1705 (show_bottom_bar TRUE on the closing side)',
    },
    {
        steps: [
            { kind: 'setBottomBar', present: true },
            { kind: 'setBottomBar', present: false },
            { kind: 'requestOpen', source: 'bottom-bar' },
        ],
        outcomes: ['ignored'],
        notifications: [],
        open: false,
        chrome: { layer: 'sheet', surfaceVisible: false, bottomBarInert: false, dimmed: false },
        rule: 'taking the bar away takes the affordance with it — presence is state, not a one-way latch',
        derivedFrom: 'adw_bottom_sheet_set_bottom_bar adw-bottom-sheet.c:1610-1629',
    },
    {
        steps: [
            { kind: 'setBottomBar', present: true },
            { kind: 'requestOpen', source: 'drag-handle' },
            { kind: 'requestOpen', source: 'swipe' },
        ],
        outcomes: ['ignored', 'open'],
        notifications: [true],
        open: true,
        chrome: { layer: 'sheet', surfaceVisible: true, bottomBarInert: false, dimmed: true },
        rule: 'the handle stays inert even where an open affordance exists beside it, and the swipe is that affordance',
        derivedFrom: 'adw-bottom-sheet.c:1197-1198 + prepare_cb:1052-1053',
    },
    {
        steps: [
            { kind: 'setModal', modal: false },
            { kind: 'setOpen', open: true },
        ],
        outcomes: [],
        notifications: [true],
        open: true,
        chrome: { layer: 'sheet', surfaceVisible: true, bottomBarInert: false, dimmed: false },
        rule: 'a non-modal sheet opens over content that stays undimmed and reachable — there is no scrim to click',
        derivedFrom: 'adw_bottom_sheet_set_open adw-bottom-sheet.c:1686-1687 (child_visible = modal)',
    },
    {
        steps: [
            { kind: 'setOpen', open: true },
            { kind: 'setModal', modal: false },
        ],
        outcomes: [],
        notifications: [true],
        open: true,
        chrome: { layer: 'sheet', surfaceVisible: true, bottomBarInert: false, dimmed: false },
        rule: 'turning modal off while the sheet is up takes the dimming away at once, without closing or notifying',
        derivedFrom: 'adw_bottom_sheet_set_modal adw-bottom-sheet.c:1981-1982',
    },
    {
        steps: [
            { kind: 'setModal', modal: false },
            { kind: 'setModal', modal: true },
        ],
        outcomes: [],
        notifications: [],
        open: false,
        chrome: { layer: 'sheet', surfaceVisible: false, bottomBarInert: false, dimmed: false },
        rule: 'modal alone never dims: a closed sheet has nothing to dim for, whatever modal says',
        derivedFrom: 'adw-bottom-sheet.c:1981 (only while progress is not 0) + open_animation_done_cb:338-339',
    },
];
