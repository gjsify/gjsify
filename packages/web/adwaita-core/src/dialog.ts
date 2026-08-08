// Headless Libadwaita dialog models — the two things a dialog surface decides
// without rendering anything.
//
// 1. {@link AdwAlertResponses} mirrors the response half of `Adw.AlertDialog`: a
//    registry of response buttons (`add_response(id, label)` +
//    `set_response_appearance`/`set_response_enabled`), the default (emphasised)
//    + close (dismissal) response semantics, and the resolve-to-chosen-id
//    contract a renderer's `present()` fulfils. It also owns the pure decision
//    logic a native two/three-button dialog needs: which response is the OK /
//    cancel / neutral slot, and whether the list is too long for a plain alert
//    (so the renderer falls back to an action sheet).
//
// 2. {@link resolveBottomSheetClose} + {@link BottomSheetPresentation} are the
//    DISMISSAL gate of `Adw.BottomSheet` — which affordance may close a sheet,
//    and what happens when it may not. The four dismissal paths in the C source
//    are four DIFFERENT gates, and both renderers had flattened them into one
//    `if (!open) return; if (!canClose) { emit; return; } open = false;`. They
//    live here rather than in a bottom-sheet module of their own because that is
//    the whole of the family that is renderer-independent: the layout, the swipe
//    model and the spring animation all consume measurements only a renderer
//    produces (see the module note below).
//
// This module is PLATFORM-NEUTRAL (ADR 0004 — headless Adwaita core): it presents
// nothing. A renderer owns the platform half — mapping to NativeScript's native
// `confirm()` / `action()`, a browser `<dialog>`, or GTK's `Adw.AlertDialog` — and
// feeds the outcome back through {@link AdwAlertResponses.resolveById} /
// {@link AdwAlertResponses.resolveLabel}, which validate it against the registry
// and fall back to {@link AdwAlertResponses.closeResponse} on dismissal.
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

// --- Bottom-sheet dismissal (Adw.BottomSheet can-close gate) ---
//
// WHAT IS *NOT* HERE, AND WHY. `Adw.BottomSheet` is mostly geometry:
// `adw_bottom_sheet_size_allocate` clamps and lerps renderer-supplied
// measurements, and the `AdwSwipeable` half derives its distance / snap points /
// swipe area from the same numbers. None of that is lifted yet, because neither
// renderer produces those measurements today — the browser sheet is pinned by
// CSS `left: 0; right: 0` and the NativeScript one is a bottom-aligned
// `StackLayout`, so there is no `align`, no `progress` and no bottom bar to feed
// it. The DISMISSAL GATE below is the part that is renderer-independent *today*,
// and it is the part both ports got wrong.

/**
 * Which affordance asked a bottom sheet to close.
 *
 * These are not interchangeable: the C source runs each through a DIFFERENT
 * gate, and the differences are exactly what a renderer flattening them into one
 * `_attemptClose()` loses.
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
 * Three rows are worth reading twice, because no renderer got them right:
 *
 * - `('drag-handle', …)` is ALWAYS `'ignored'`. The handle is created with
 *   `can_focus = FALSE` + `can_target = FALSE` (adw-bottom-sheet.c:1197-1198),
 *   so it cannot be clicked at all; its only behavioural role is elsewhere
 *   (`allow_mouse_drag = show_drag_handle || bottom_bar`, adw-bottom-sheet.c:455).
 *   Both ports had turned it into a close BUTTON, which is the one behaviour it
 *   provably does not have.
 * - `('escape', { open: false })` is `'close-attempt'`, not nothing. The emit in
 *   `maybe_close_cb` (adw-bottom-sheet.c:393-399) is the fallthrough for EVERY
 *   case that is not `can_close && open`, and a closed sheet is still focusable
 *   while it shows a bottom bar.
 * - `('close-button', { open: false, canClose: true })` is `'delegate'`:
 *   `sheet_close_cb` (adw-bottom-sheet.c:377-385) activates the parent's
 *   `sheet.close` action instead of doing nothing.
 *
 * The `'dimming'`/`'swipe'` closed rows encode a REACHABILITY gate rather than a
 * branch inside the callback: `released_cb` never tests `open`, but the scrim is
 * `can_target = open` (adw-bottom-sheet.c:1148, 1692), and `prepare_cb` refuses
 * to even detect a swipe unless the direction matches the state
 * (adw-bottom-sheet.c:1050-1053). Neither can fire on a closed sheet, so neither
 * signals anything.
 */
export function resolveBottomSheetClose(
    source: BottomSheetCloseSource,
    state: BottomSheetCloseState,
): BottomSheetCloseOutcome {
    const open = !!state.open;
    const canClose = !!state.canClose;

    switch (source) {
        // adw-bottom-sheet.c:1197-1198 — not an event target, ever.
        case 'drag-handle':
            return 'ignored';

        // prepare_cb, adw-bottom-sheet.c:1046-1053. A locked sheet does not
        // suppress the swipe *result*, it suppresses swipe DETECTION — hence
        // silence rather than a close-attempt. A closed sheet's downward swipe
        // is an OPEN gesture and is gated by can-open instead.
        case 'swipe':
            return open && canClose ? 'close' : 'ignored';

        // released_cb, adw-bottom-sheet.c:236-240 (+ the can_target reachability
        // gate at :1692).
        case 'dimming':
            if (!open) return 'ignored';
            return canClose ? 'close' : 'close-attempt';

        // sheet_close_cb, adw-bottom-sheet.c:368-386 — can_close is tested
        // FIRST, so a locked sheet signals even when it is already closed.
        case 'close-button':
            if (!canClose) return 'close-attempt';
            return open ? 'close' : 'delegate';

        // maybe_close_cb, adw-bottom-sheet.c:389-400 — closes only when BOTH
        // hold; everything else falls through to the signal.
        case 'escape':
            return canClose && open ? 'close' : 'close-attempt';
    }
}

/** One entry in a {@link BottomSheetPresentation}'s teardown callback pair. */
export type BottomSheetTeardownCallback = 'closing' | 'closed';

/** Subscriber for {@link BottomSheetPresentation} `open` changes. */
export type BottomSheetPresentationListener = (open: boolean) => void;

/**
 * The two callbacks `AdwDialog` installs on its bottom sheet
 * (`adw_bottom_sheet_set_callbacks`, adw-bottom-sheet.c:2227-2238). They are
 * NOT the same event twice:
 *
 * - `onClosing` fires when the close STARTS — adw-dialog.c:231-240 turns it into
 *   the public `AdwDialog::closed` signal.
 * - `onClosed` fires when the sheet has finished hiding — adw-dialog.c:243-249
 *   turns it into the dialog's removal from the widget tree.
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
 * `setOpen` is the PROGRAMMATIC path and deliberately ignores `can-close`
 * ("Bottom sheet can still be closed using [property@BottomSheet:open]",
 * adw-bottom-sheet.c:2071); {@link requestClose} is the INTERACTIVE path that
 * runs the gate. Keeping them apart is what lets a locked sheet still be closed
 * by its owner — the distinction NativeScript lacked entirely (every dismissal
 * went through one unconditional `close()`).
 */
export class BottomSheetPresentation {
    private _open = false;
    private _canClose = true;
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
     * {@link setOpen}; `has_been_open` in the C source (adw-bottom-sheet.c:153).
     */
    get hasBeenOpen(): boolean {
        return this._hasBeenOpen;
    }

    /** Set `can-close`. Returns whether it changed (adw-bottom-sheet.c:2076-2091). */
    setCanClose(canClose: boolean): boolean {
        const next = !!canClose;
        if (next === this._canClose) return false;
        this._canClose = next;
        return true;
    }

    /**
     * The programmatic open/close — `adw_bottom_sheet_set_open`
     * (adw-bottom-sheet.c:1661-1778). Returns whether `open` changed, i.e.
     * whether a `notify::open` was emitted.
     *
     * `can-close` is NOT consulted: this is the owner's path, and it is how
     * `adw_dialog_force_close` closes a locked dialog (adw-dialog.c:1979-1997).
     */
    setOpen(open: boolean): boolean {
        const next = !!open;

        // adw-bottom-sheet.c:1672-1682 — idempotent, with ONE exception: closing
        // a sheet that has NEVER been open replays closing+closed, so a dialog
        // dismissed before it ever animated in is still torn down. Even then it
        // does not notify, because nothing changed.
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
            // adw-bottom-sheet.c:1697-1698 — a closing handler may re-open the
            // sheet; that re-entrant call already notified, so this one must not.
            if (this._open !== next) return false;
        }

        this._emit();
        return true;
    }

    /**
     * Route a dismissal affordance through {@link resolveBottomSheetClose} and
     * APPLY the outcome — `'close'` closes the sheet, everything else leaves it
     * untouched. The returned outcome tells the renderer what to emit: a
     * `close-attempt` signal, a `sheet.close` forwarded to the parent, or
     * nothing at all.
     */
    requestClose(source: BottomSheetCloseSource): BottomSheetCloseOutcome {
        const outcome = resolveBottomSheetClose(source, this);
        if (outcome === 'close') this.setOpen(false);
        return outcome;
    }

    /**
     * The sheet has finished hiding — `open_animation_done_cb`'s teardown
     * (adw-bottom-sheet.c:335-349) reduced to what a renderer without a spring
     * animation can observe. Fires `onClosed` and returns whether it did.
     *
     * The C guard is `progress < 0.5` ("settled on the closed side"); with no
     * animation the settled progress IS `open`, so an open sheet fires nothing.
     * Call it only after a {@link setOpen} that RETURNED TRUE — the replay branch
     * has already fired both callbacks for a never-opened sheet.
     */
    finishClose(): boolean {
        if (this._open) return false;
        this._onClosed?.();
        return true;
    }
}
