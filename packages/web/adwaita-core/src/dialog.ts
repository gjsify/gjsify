// Headless Libadwaita dialog models — the two things a dialog surface decides
// without rendering anything.
//
// 1. {@link AdwAlertResponses} mirrors the response half of `Adw.AlertDialog`: the response
//    registry (`add_response(id, label)` + `set_response_appearance`/`set_response_enabled`),
//    the default (emphasised) + close (dismissal) response semantics, and the
//    resolve-to-chosen-id contract a renderer's `present()` fulfils. It also decides which
//    response is the OK / cancel / neutral slot of a native two/three-button dialog, and
//    whether the list is too long for a plain alert (so the renderer falls back to an action
//    sheet).
//
// 2. {@link resolveBottomSheetClose} + {@link BottomSheetPresentation} are the DISMISSAL gate
//    of `Adw.BottomSheet` — which affordance may close a sheet, and what happens when it may
//    not. The four dismissal paths in the C are four DIFFERENT gates, not one
//    `if (!canClose) { emit; return; }`. They live here rather than in a bottom-sheet module
//    of their own because they are the whole of that family that is renderer-independent: the
//    layout, the swipe model and the spring animation all consume measurements only a
//    renderer produces.
//
// PLATFORM-NEUTRAL (ADR 0004): presents nothing. A renderer owns the platform half — mapping
// to NativeScript's native `confirm()`/`action()`, a browser `<dialog>`, or GTK's
// `Adw.AlertDialog` — and feeds the outcome back through
// {@link AdwAlertResponses.resolveById} / {@link AdwAlertResponses.resolveLabel}, which
// validate it against the registry and fall back to {@link AdwAlertResponses.closeResponse}
// on dismissal.
//
// Reference: refs/libadwaita/src/adw-alert-dialog.c
//   (add_response, response appearance/enabled, default/close response, response signal).
// Reference: refs/libadwaita/src/adw-bottom-sheet.c
//   (released_cb, sheet_close_cb, maybe_close_cb, prepare_cb, adw_bottom_sheet_set_open).
// Reference: refs/libadwaita/src/adw-dialog.c
//   (sheet_closing_cb / sheet_closed_cb — the two callbacks AdwDialog installs on its sheet).
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** Visual emphasis of a response button. Mirrors `Adw.ResponseAppearance`. */
export type AdwResponseAppearance = 'default' | 'suggested' | 'destructive';

/** Optional per-response attributes for {@link AdwAlertResponses.addResponse}. */
export interface AdwResponseOptions {
    /** Emphasis (suggested/destructive). Default `'default'`. Mirrors `set_response_appearance`. */
    appearance?: AdwResponseAppearance;
    /** Whether the response is selectable. Default `true`. Mirrors `set_response_enabled`. */
    enabled?: boolean;
}

/** A registered response button. `id` is what `present()` resolves to. */
export interface AdwAlertResponse {
    /** Stable response id — the value `present()` resolves to. */
    readonly id: string;
    /** Button label shown to the user. */
    label: string;
    /** Visual emphasis. */
    appearance: AdwResponseAppearance;
    /** Whether the response is selectable. */
    enabled: boolean;
}

/**
 * The response list split into the three slots a native two/three-button dialog
 * exposes: the emphasised OK (the default response, or the first), the trailing
 * cancel/close, and an optional middle neutral. Any slot may be absent.
 */
export interface OrderedConfirmResponses {
    ok?: AdwAlertResponse;
    cancel?: AdwAlertResponse;
    neutral?: AdwAlertResponse;
}

/** More than this many responses do not fit a plain two/three-button alert. */
const MAX_CONFIRM_RESPONSES = 3;

/**
 * The headless alert-dialog response model. Holds the heading/body text and the
 * response registry; owns the ordering + validation a renderer's `present()`
 * needs. Renderer-agnostic: compose it inside a platform dialog (e.g. NativeScript
 * `AdwAlertDialog extends Observable`) and delegate the response surface to it.
 */
export class AdwAlertResponses {
    private _heading: string;
    private _body: string;
    private readonly _responses: AdwAlertResponse[] = [];
    private _defaultResponse: string | null = null;
    private _closeResponse = 'close';

    constructor(heading = '', body = '') {
        this._heading = heading ?? '';
        this._body = body ?? '';
    }

    /** The dialog heading (title). */
    get heading(): string {
        return this._heading;
    }

    set heading(value: string) {
        this._heading = value ?? '';
    }

    /** The dialog body text. */
    get body(): string {
        return this._body;
    }

    set body(value: string) {
        this._body = value ?? '';
    }

    /**
     * Register a response button. `id` is what `present()` resolves to; a repeated
     * `id` updates the existing response's label/appearance/enabled in place
     * (mirroring `adw_alert_dialog_add_response` refusing duplicate ids).
     */
    addResponse(id: string, label: string, options: AdwResponseOptions = {}): void {
        const existing = this._responses.find((r) => r.id === id);
        if (existing) {
            existing.label = label;
            if (options.appearance !== undefined) existing.appearance = options.appearance;
            if (options.enabled !== undefined) existing.enabled = options.enabled;
            return;
        }
        this._responses.push({
            id,
            label,
            appearance: options.appearance ?? 'default',
            enabled: options.enabled ?? true,
        });
    }

    /** Register many responses at once (`id, label, id, label, …`). */
    addResponses(...idLabelPairs: string[]): void {
        for (let i = 0; i + 1 < idLabelPairs.length; i += 2) {
            this.addResponse(idLabelPairs[i]!, idLabelPairs[i + 1]!);
        }
    }

    /** Whether a response with `id` is registered. */
    hasResponse(id: string): boolean {
        return this._responses.some((r) => r.id === id);
    }

    /** Set a registered response's visual emphasis. No-op for an unknown id. */
    setResponseAppearance(id: string, appearance: AdwResponseAppearance): void {
        const r = this._responses.find((res) => res.id === id);
        if (r) r.appearance = appearance;
    }

    /** A registered response's emphasis, or `'default'` for an unknown id. */
    getResponseAppearance(id: string): AdwResponseAppearance {
        return this._responses.find((r) => r.id === id)?.appearance ?? 'default';
    }

    /** Enable/disable a registered response. No-op for an unknown id. */
    setResponseEnabled(id: string, enabled: boolean): void {
        const r = this._responses.find((res) => res.id === id);
        if (r) r.enabled = enabled;
    }

    /** Whether a registered response is enabled (`true` for an unknown id). */
    getResponseEnabled(id: string): boolean {
        return this._responses.find((r) => r.id === id)?.enabled ?? true;
    }

    /** The registered responses, in insertion order. */
    get responses(): ReadonlyArray<AdwAlertResponse> {
        return this._responses;
    }

    /** The default (emphasised) response id — the OK slot in a native dialog. */
    get defaultResponse(): string | null {
        return this._defaultResponse;
    }

    set defaultResponse(id: string | null) {
        this._defaultResponse = id;
    }

    /** The response id used when the dialog is dismissed without a choice. */
    get closeResponse(): string {
        return this._closeResponse;
    }

    set closeResponse(id: string) {
        this._closeResponse = id || 'close';
    }

    /**
     * Whether the response list is too long for a plain two/three-button alert
     * (so a renderer falls back to an action sheet). Mirrors the NativeScript
     * `confirm()` (≤3) vs `action()` (>3) split.
     */
    get usesActionSheet(): boolean {
        return this._responses.length > MAX_CONFIRM_RESPONSES;
    }

    /**
     * Split the responses into the native OK / cancel / neutral slots: the default
     * response (or the first) is OK, the LAST remaining is cancel/close, and a
     * middle one (when present) is neutral — the ordering a native two/three-button
     * dialog expects.
     */
    orderResponses(): OrderedConfirmResponses {
        const ok = this._responses.find((r) => r.id === this._defaultResponse) ?? this._responses[0];
        const remaining = this._responses.filter((r) => r !== ok);
        const cancel = remaining[remaining.length - 1];
        const neutral = remaining.length >= 2 ? remaining[0] : undefined;
        return { ok, cancel, neutral };
    }

    /**
     * Resolve a chosen response id to a REGISTERED id — the resolve-to-chosen-id
     * contract. Returns `id` when it names a registered response, otherwise
     * {@link closeResponse} (covering `null` / dismissal / an unknown id).
     */
    resolveById(id: string | null | undefined): string {
        return id != null && this.hasResponse(id) ? id : this._closeResponse;
    }

    /**
     * Resolve a chosen LABEL (e.g. an action-sheet selection) to a registered id,
     * or {@link closeResponse} when the label matches nothing / was dismissed.
     */
    resolveLabel(label: string | null | undefined): string {
        if (label == null) return this._closeResponse;
        return this.resolveById(this._responses.find((r) => r.label === label)?.id);
    }
}

// WHAT IS *NOT* HERE, AND WHY. `Adw.BottomSheet` is mostly geometry:
// `adw_bottom_sheet_size_allocate` clamps and lerps renderer-supplied measurements, and the
// `AdwSwipeable` half derives its distance / snap points / swipe area from the same numbers.
// None of that is lifted, because neither renderer produces those measurements — the browser
// sheet is pinned by CSS `left: 0; right: 0` and the NativeScript one is a bottom-aligned
// `StackLayout`, so there is no `align` and no `progress` to feed it. Nor is `swipe_active`
// (adw-bottom-sheet.c:269), the one bit that makes the bottom bar's pointer door differ from
// its keyboard door: it is a swipe tracker's state, and neither renderer runs one.
//
// THE BOTTOM BAR USED TO BE ON THAT LIST, and the sentence outlived its reason. A bottom bar
// is not a measurement: it is the ONLY affordance libadwaita gives a user to OPEN a sheet
// (`bottom_bar_released_cb`, adw-bottom-sheet.c:263-284), and omitting it does not degrade a
// port, it removes the sheet. Measured on easy6502, whose GNOME editor declares
// `bottom-bar: Label { label: _("Help"); … }` and writes `open` from nowhere: the port that
// left the bar out had no way at all to reach the quick help. So the OPEN GATE below is
// lifted beside the DISMISSAL GATE, and both are renderer-independent.

/**
 * Which affordance asked a bottom sheet to close.
 *
 * Not interchangeable: the C runs each through a DIFFERENT gate, and the differences are
 * exactly what a renderer flattening them into one `_attemptClose()` loses.
 *
 * - `'dimming'`      — a click on the modal scrim (`released_cb`).
 * - `'escape'`       — the <kbd>Escape</kbd> shortcut on the sheet (`maybe_close_cb`).
 * - `'close-button'` — the `sheet.close` widget action (`sheet_close_cb`).
 * - `'drag-handle'`  — the pill at the top of the sheet. Decorative in libadwaita.
 * - `'swipe'`        — a downward swipe on the sheet (`prepare_cb` → `end_swipe_cb`).
 */
export type BottomSheetCloseSource = 'dimming' | 'escape' | 'close-button' | 'drag-handle' | 'swipe';

/**
 * What a renderer must do about a close request.
 *
 * - `'close'`         — close the sheet.
 * - `'close-attempt'` — emit `close-attempt`; the sheet stays as it is.
 * - `'delegate'`      — forward the `sheet.close` action to the PARENT (a sheet
 *                       nested in another sheet/dialog closes the outer one).
 * - `'ignored'`       — do nothing, and emit nothing. Not the same as
 *                       `'close-attempt'`: a locked sheet swallows a swipe
 *                       silently but SIGNALS a scrim click.
 */
export type BottomSheetCloseOutcome = 'close' | 'close-attempt' | 'delegate' | 'ignored';

/** The two bits {@link resolveBottomSheetClose} decides from. */
export interface BottomSheetCloseState {
    /** Whether the sheet is currently revealed (`AdwBottomSheet:open`). */
    open: boolean;
    /** Whether the user may dismiss it (`AdwBottomSheet:can-close`). */
    canClose: boolean;
}

/**
 * The dismissal decision table — `Adw.BottomSheet`'s five dismissal affordances
 * as one pure function, callable without owning any state.
 *
 * Three rows are worth reading twice:
 *
 * - `('drag-handle', …)` is ALWAYS `'ignored'`. The handle is created with
 *   `can_focus = FALSE` + `can_target = FALSE`, so it cannot be clicked at all; its only
 *   behavioural role is elsewhere (`allow_mouse_drag = show_drag_handle || bottom_bar`). It
 *   is NOT a close button.
 * - `('escape', { open: false })` is `'close-attempt'`, not nothing. The emit in
 *   `maybe_close_cb` is the fallthrough for EVERY case that is not `can_close && open`, and a
 *   closed sheet is still focusable while it shows a bottom bar.
 * - `('close-button', { open: false, canClose: true })` is `'delegate'`: `sheet_close_cb`
 *   activates the parent's `sheet.close` action instead of doing nothing.
 *
 * The `'dimming'`/`'swipe'` closed rows encode a REACHABILITY gate rather than a branch
 * inside the callback: `released_cb` never tests `open`, but the scrim is `can_target = open`,
 * and `prepare_cb` refuses to even detect a swipe unless the direction matches the state.
 * Neither can fire on a closed sheet, so neither signals anything.
 */
export function resolveBottomSheetClose(
    source: BottomSheetCloseSource,
    state: BottomSheetCloseState,
): BottomSheetCloseOutcome {
    const open = !!state.open;
    const canClose = !!state.canClose;

    switch (source) {
        // Not an event target, ever.
        case 'drag-handle':
            return 'ignored';

        // `prepare_cb`: a locked sheet does not suppress the swipe *result*, it suppresses
        // swipe DETECTION — hence silence rather than a close-attempt. A closed sheet's
        // downward swipe is an OPEN gesture and is gated by can-open instead.
        case 'swipe':
            return open && canClose ? 'close' : 'ignored';

        // `released_cb`, plus the scrim's `can_target = open` reachability gate.
        case 'dimming':
            if (!open) return 'ignored';
            return canClose ? 'close' : 'close-attempt';

        // `sheet_close_cb` tests can_close FIRST, so a locked sheet signals even when it is
        // already closed.
        case 'close-button':
            if (!canClose) return 'close-attempt';
            return open ? 'close' : 'delegate';

        // `maybe_close_cb` closes only when BOTH hold; everything else falls through to the
        // signal.
        case 'escape':
            return canClose && open ? 'close' : 'close-attempt';
    }
}

/**
 * Which affordance asked a bottom sheet to OPEN.
 *
 * libadwaita gives a user exactly ONE surface to open a sheet from — the bottom bar. Both
 * doors into it are gated by `can-open`, and both are unreachable without a bar:
 *
 * - `'bottom-bar'`  — a click on the bar. The bin IS a `GtkButton`
 *                     (adw-bottom-sheet.c:1203) whose own click gesture is put in
 *                     `GTK_PHASE_NONE` by `disable_button_click` (:1209), so a pointer press
 *                     runs `bottom_bar_released_cb` (:263-284) and a keyboard activation
 *                     runs `bottom_bar_clicked_cb` (:402-407). Same verdict from both.
 * - `'swipe'`       — an upward swipe off the bar (`prepare_cb`, :1052-1053).
 * - `'drag-handle'` — the pill, decorative exactly as in the dismissal gate.
 */
export type BottomSheetOpenSource = 'bottom-bar' | 'swipe' | 'drag-handle';

/**
 * What a renderer must do about an open request. There is no `'open-attempt'`: libadwaita
 * has no signal for a refused open, so a sheet that will not open is silent.
 */
export type BottomSheetOpenOutcome = 'open' | 'ignored';

/**
 * What {@link resolveBottomSheetOpen} decides from — the SAME four properties the chrome is
 * derived from, which is the finding rather than a convenience: whether a user can open the
 * sheet is exactly the question of whether the bar is on screen and not inert.
 */
export type BottomSheetOpenState = BottomSheetChromeState;

/**
 * The open decision table.
 *
 * Only ONE of the four inputs is a branch inside a callback — `can_open`. The other three
 * are REACHABILITY, which is why a port that reads only the callbacks gets them wrong:
 *
 * - no bottom bar: the stack never switches to the bin (`show_bottom_bar` returns before the
 *   switch, adw-bottom-sheet.c:294-295; `set_bottom_bar` puts `sheet_page` back, :1615-1616),
 *   and the swipe area is a ZERO-HEIGHT rectangle at progress 0 because `bottom_bar_height`
 *   is 0 (`get_swipe_area`, :1412-1433). Upstream states the consequence outright — `can-open`
 *   "does nothing if [property@BottomSheet:bottom-bar] is not set" (:2013).
 * - already open: `set_open (TRUE)` switches the stack away from the bin (:1701-1702), so
 *   there is nothing to click, and `prepare_cb` reads an open sheet's gesture as a CLOSE
 *   (:1050-1051) rather than a second open.
 * - bar not revealed: at progress 0 `reveal_animation_done_cb` makes the whole sheet bin
 *   child-invisible (:362-364, and the same expression at :341-343), so the bar is off screen.
 *
 * `can_open` itself is NOT reachability: the bin stays focusable and merely gains the `inert`
 * style class (:2033-2036), which is why {@link BottomSheetChrome.bottomBarInert} is a class
 * to paint rather than a widget to disable.
 */
export function resolveBottomSheetOpen(
    source: BottomSheetOpenSource,
    state: BottomSheetOpenState,
): BottomSheetOpenOutcome {
    // Not an event target, ever — the same `can_target = FALSE` pill the dismissal gate ignores.
    if (source === 'drag-handle') return 'ignored';

    // Derived from the chrome rather than re-tested here: "the bar is on screen, showing, and
    // not inert" IS the open condition, and two spellings of it would be two truths.
    const chrome = resolveBottomSheetChrome(state);
    if (chrome.layer !== 'bottom-bar' || !chrome.surfaceVisible || chrome.bottomBarInert) return 'ignored';
    return 'open';
}

/** Which of the sheet bin's two stack children is showing (`sheet_stack`). */
export type BottomSheetLayer = 'sheet' | 'bottom-bar';

/** What {@link resolveBottomSheetChrome} decides from. */
export interface BottomSheetChromeState {
    /** `AdwBottomSheet:open`. */
    open: boolean;
    /** `AdwBottomSheet:can-open`. */
    canOpen: boolean;
    /** Whether `AdwBottomSheet:bottom-bar` is set. */
    hasBottomBar: boolean;
    /** `AdwBottomSheet:reveal-bottom-bar`; absent means revealed. */
    revealBottomBar?: boolean;
    /** `AdwBottomSheet:modal`; absent means modal, the pspec default (adw-bottom-sheet.c:1128). */
    modal?: boolean;
}

/** What a renderer has to put on screen for a given state. */
export interface BottomSheetChrome {
    /** Which stack child the sheet bin shows. */
    layer: BottomSheetLayer;
    /** Whether the sheet bin is on screen at all (`gtk_widget_set_child_visible`). */
    surfaceVisible: boolean;
    /** Whether the bar carries the `inert` style class — still clickable, just refusing. */
    bottomBarInert: boolean;
    /**
     * Whether the dimming layer covers the content — the scrim a click on dismisses through
     * the `'dimming'` source. Only a MODAL sheet has one on screen.
     */
    dimmed: boolean;
}

/**
 * The bin's resting appearance: which child shows, whether the bin is on screen, and whether
 * the bar looks inert.
 *
 * RESTING is the whole simplification. In C these follow `progress` across
 * `CHILD_SWITCH_THRESHOLD` mid-animation (`open_animation_cb`, adw-bottom-sheet.c:322-330);
 * with no spring animation the settled progress IS `open`, so `showing_bottom_bar` reduces to
 * `!open` — which is also its init value (:1131) for a sheet that starts closed.
 *
 * The dimming reduces the same way. `set_open (TRUE)` makes it child-visible exactly when the
 * sheet is modal (:1686-1687), `set_modal` re-applies that while the sheet is not settled closed
 * (:1981-1982), and the close animation hides it once it settles (:338-339). At rest that is
 * `open && modal`; the opacity ramp between is the animation this model does not run.
 */
export function resolveBottomSheetChrome(state: BottomSheetChromeState): BottomSheetChrome {
    const open = !!state.open;
    const hasBottomBar = !!state.hasBottomBar;
    const revealed = state.revealBottomBar ?? true;
    return {
        layer: open || !hasBottomBar ? 'sheet' : 'bottom-bar',
        surfaceVisible: open || (hasBottomBar && revealed),
        bottomBarInert: !state.canOpen,
        dimmed: open && (state.modal ?? true),
    };
}

/** What {@link resolveBottomSheetSwipeTracker} decides from. */
export interface BottomSheetSwipeTrackerState {
    /** `AdwBottomSheet:can-open`. */
    canOpen: boolean;
    /** `AdwBottomSheet:can-close`. */
    canClose: boolean;
    /** Whether `AdwBottomSheet:bottom-bar` is set. */
    hasBottomBar: boolean;
    /** `AdwBottomSheet:show-drag-handle`. */
    showDragHandle: boolean;
}

/** The three `AdwSwipeTracker` settings `update_swipe_tracker` writes. */
export interface BottomSheetSwipeTrackerConfig {
    /** Whether the tracker recognises a gesture at all. */
    enabled: boolean;
    /** Whether a mouse drag counts, not only touch. */
    allowMouseDrag: boolean;
    /** Whether the gesture may overshoot below the closed position. */
    lowerOvershoot: boolean;
}

/**
 * `update_swipe_tracker` (adw-bottom-sheet.c:450-460) as a pure function.
 *
 * `enabled` is the line that decides whether a bottom sheet can be opened by gesture at all:
 * `(can_open && bottom_bar != NULL) || can_close`. The `&& bottom_bar` conjunct is why
 * `can-open` alone buys nothing — with no bar the only live arm is `can_close`, i.e. the
 * tracker exists solely to CLOSE.
 */
export function resolveBottomSheetSwipeTracker(state: BottomSheetSwipeTrackerState): BottomSheetSwipeTrackerConfig {
    return {
        enabled: (!!state.canOpen && !!state.hasBottomBar) || !!state.canClose,
        allowMouseDrag: !!state.showDragHandle || !!state.hasBottomBar,
        lowerOvershoot: !!state.hasBottomBar,
    };
}

/** One entry in a {@link BottomSheetPresentation}'s teardown callback pair. */
export type BottomSheetTeardownCallback = 'closing' | 'closed';

/** Subscriber for {@link BottomSheetPresentation} `open` changes. */
export type BottomSheetPresentationListener = (open: boolean) => void;

/**
 * The two callbacks `AdwDialog` installs on its bottom sheet
 * (`adw_bottom_sheet_set_callbacks`). NOT the same event twice:
 *
 * - `onClosing` fires when the close STARTS — `AdwDialog` turns it into the public
 *   `AdwDialog::closed` signal.
 * - `onClosed` fires when the sheet has finished hiding — `AdwDialog` turns it into the
 *   dialog's removal from the widget tree.
 */
export interface BottomSheetPresentationOptions {
    /** The close started (`closing_callback`). */
    onClosing?: () => void;
    /** The sheet finished hiding (`closed_callback`). */
    onClosed?: () => void;
}

/**
 * The open/closed half of `Adw.BottomSheet` — the part with no geometry in it:
 * the idempotent `open` flag, the `can-close` gate applied through
 * {@link resolveBottomSheetClose}, and the `has_been_open` teardown replay.
 *
 * `setOpen` is the PROGRAMMATIC path and deliberately ignores `can-close` ("Bottom sheet can
 * still be closed using [property@BottomSheet:open]"); {@link requestClose} is the INTERACTIVE
 * path that runs the gate. Keeping them apart is what lets a locked sheet still be closed by
 * its owner.
 *
 * The same split holds the other way round: {@link requestOpen} is the user's path and runs
 * {@link resolveBottomSheetOpen}, so a sheet with no bottom bar cannot be opened by a user at
 * all, while its owner's `setOpen(true)` still works.
 */
export class BottomSheetPresentation {
    private _open = false;
    private _canClose = true;
    private _canOpen = true;
    private _hasBottomBar = false;
    private _revealBottomBar = true;
    private _modal = true;
    private _hasBeenOpen = false;
    private readonly _listeners = new Set<BottomSheetPresentationListener>();
    private readonly _onClosing: (() => void) | undefined;
    private readonly _onClosed: (() => void) | undefined;

    constructor(options: BottomSheetPresentationOptions = {}) {
        this._onClosing = options.onClosing;
        this._onClosed = options.onClosed;
    }

    /** Subscribe to `open` changes (the `notify::open` seam). Returns an unsubscribe function. */
    subscribe(listener: BottomSheetPresentationListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private _emit(): void {
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._listeners]) listener(this._open);
    }

    /** Whether the sheet is revealed (`AdwBottomSheet:open`). */
    get open(): boolean {
        return this._open;
    }

    /** Whether the user may dismiss the sheet (`AdwBottomSheet:can-close`). */
    get canClose(): boolean {
        return this._canClose;
    }

    /**
     * Whether the sheet has ever been open. Drives the teardown replay in
     * {@link setOpen}; `has_been_open` in the C source.
     */
    get hasBeenOpen(): boolean {
        return this._hasBeenOpen;
    }

    /** Whether the user may open the sheet from its bottom bar (`AdwBottomSheet:can-open`). */
    get canOpen(): boolean {
        return this._canOpen;
    }

    /** Whether a bottom bar is set (`AdwBottomSheet:bottom-bar` is non-NULL). */
    get hasBottomBar(): boolean {
        return this._hasBottomBar;
    }

    /** Whether the bottom bar is revealed (`AdwBottomSheet:reveal-bottom-bar`). */
    get revealBottomBar(): boolean {
        return this._revealBottomBar;
    }

    /** Whether the sheet dims and blocks the content while open (`AdwBottomSheet:modal`). */
    get modal(): boolean {
        return this._modal;
    }

    /** What the renderer has to show for the current state — {@link resolveBottomSheetChrome}. */
    get chrome(): BottomSheetChrome {
        return resolveBottomSheetChrome(this);
    }

    /** Set `can-close`. Returns whether it changed. */
    setCanClose(canClose: boolean): boolean {
        const next = !!canClose;
        if (next === this._canClose) return false;
        this._canClose = next;
        return true;
    }

    /** Set `can-open`. Returns whether it changed. */
    setCanOpen(canOpen: boolean): boolean {
        const next = !!canOpen;
        if (next === this._canOpen) return false;
        this._canOpen = next;
        return true;
    }

    /**
     * Record whether a bottom bar is present. Returns whether it changed.
     *
     * A renderer calls this from wherever it adopts the bar widget — the C setter is where
     * `update_swipe_tracker` is re-run (adw-bottom-sheet.c:1629), i.e. presence is an INPUT to
     * the gates, not a rendering detail.
     */
    setHasBottomBar(hasBottomBar: boolean): boolean {
        const next = !!hasBottomBar;
        if (next === this._hasBottomBar) return false;
        this._hasBottomBar = next;
        return true;
    }

    /**
     * Set `modal`. Returns whether it changed. A sheet that is open changes its dimming at
     * once, as `adw_bottom_sheet_set_modal` does (adw-bottom-sheet.c:1981-1982); `open` and
     * the gates do not move, so nothing is notified here — the renderer repaints.
     */
    setModal(modal: boolean): boolean {
        const next = !!modal;
        if (next === this._modal) return false;
        this._modal = next;
        return true;
    }

    /** Set `reveal-bottom-bar`. Returns whether it changed. */
    setRevealBottomBar(reveal: boolean): boolean {
        const next = !!reveal;
        if (next === this._revealBottomBar) return false;
        this._revealBottomBar = next;
        return true;
    }

    /**
     * The programmatic open/close — `adw_bottom_sheet_set_open`. Returns whether `open`
     * changed, i.e. whether a `notify::open` was emitted.
     *
     * `can-close` is NOT consulted: this is the owner's path, and it is how
     * `adw_dialog_force_close` closes a locked dialog.
     */
    setOpen(open: boolean): boolean {
        const next = !!open;

        // Idempotent, with ONE exception: closing a sheet that has NEVER been open replays
        // closing+closed, so a dialog dismissed before it ever animated in is still torn down.
        // Even then it does not notify, because nothing changed.
        if (this._open === next) {
            if (!this._hasBeenOpen && !next) {
                this._onClosing?.();
                this._onClosed?.();
            }
            return false;
        }

        this._open = next;
        if (next) this._hasBeenOpen = true;

        if (!next) {
            this._onClosing?.();
            // A closing handler may re-open the sheet; that re-entrant call already notified, so
            // this one must not.
            if (this._open !== next) return false;
        }

        this._emit();
        return true;
    }

    /**
     * Route a dismissal affordance through {@link resolveBottomSheetClose} and APPLY the
     * outcome — `'close'` closes the sheet, everything else leaves it untouched. The returned
     * outcome tells the renderer what to emit: a `close-attempt` signal, a `sheet.close`
     * forwarded to the parent, or nothing at all.
     */
    requestClose(source: BottomSheetCloseSource): BottomSheetCloseOutcome {
        const outcome = resolveBottomSheetClose(source, this);
        if (outcome === 'close') this.setOpen(false);
        return outcome;
    }

    /**
     * Route an open affordance through {@link resolveBottomSheetOpen} and APPLY the outcome.
     * `'ignored'` is the only other answer, and it is silent: libadwaita has no
     * `open-attempt` counterpart to `close-attempt`, so a renderer emits nothing for it.
     */
    requestOpen(source: BottomSheetOpenSource): BottomSheetOpenOutcome {
        const outcome = resolveBottomSheetOpen(source, this);
        if (outcome === 'open') this.setOpen(true);
        return outcome;
    }

    /**
     * The sheet has finished hiding — `open_animation_done_cb`'s teardown reduced to what a
     * renderer without a spring animation can observe. Fires `onClosed` and returns whether it
     * did.
     *
     * The C guard is `progress < 0.5` ("settled on the closed side"); with no animation the
     * settled progress IS `open`, so an open sheet fires nothing. Call it only after a
     * {@link setOpen} that RETURNED TRUE — the replay branch has already fired both callbacks
     * for a never-opened sheet.
     */
    finishClose(): boolean {
        if (this._open) return false;
        this._onClosed?.();
        return true;
    }
}
