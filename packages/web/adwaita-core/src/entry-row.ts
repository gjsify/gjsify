// Adwaita entry-row behaviour — headless (ADR 0004 — headless Adwaita core).
//
// `Adw.EntryRow` looks like a text field with a floating label, but almost none of it is
// layout: `update_empty` is a FIVE-output truth table over four inputs (text length ·
// editing · editable · a `text_changed` latch, plus the private `show_indicator` hook),
// deciding whether the pencil shows, whether the pencil is sensitive, whether the caps-lock
// indicator shows, whether the apply button shows, and whether the title renders as a large
// placeholder or a small label. The latch has two distinct reset paths, and
// <kbd>Enter</kbd> dispatches to exactly one of two signals depending on it. The corners
// that get written wrong by hand are `!(focused && editable)` and
// `editing && show_indicator`; `conformance/entry-row.ts` is the table both renderers are
// held to.
//
// NO `interactive` FLAG HERE, DELIBERATELY. `SpinState`/`ComboState` (rows.ts) tag their
// changes with `interactive` because those widgets notify only on a user-driven change.
// Entry rows do not make that distinction: `text_changed_cb` keys the latch off
// `show_apply_button && editing` and never off the change's ORIGIN — a programmatic set
// while the entry is focused latches exactly like a keystroke. So this family follows the
// `ExpanderState`/`ToggleGroupState` shape (change carries no flag).
//
// Reference: refs/libadwaita/src/adw-entry-row.c, adw-entry-row.ui,
//   adw-entry-row-private.h, adw-password-entry-row.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** How long the empty↔filled title transition runs — adw-entry-row.c. */
export const EMPTY_ANIMATION_DURATION_MS = 150;

/**
 * Gap between the shrunken title and the text baseline, in px — `TITLE_SPACING`, used in
 * the vertical measure and in both the title offset and the baseline shift. Exported as
 * DATA rather than applied here, so the renderers' stylesheets stop hardcoding a private
 * number each.
 */
export const ENTRY_ROW_TITLE_SPACING = 3;

/**
 * Upper bound of `Adw.EntryRow:max-length` / `:text-length`. `text-length` is declared
 * `0, G_MAXUINT16, 0` and `max-length` runs `0..GTK_ENTRY_BUFFER_MAX_SIZE` — the same
 * 16-bit ceiling. `0` means unlimited, so this is only the clamp for an absurd input.
 */
export const ENTRY_ROW_MAX_LENGTH_LIMIT = 0xffff;

/** Icon name of the trailing pencil — adw-entry-row.ui (`edit_icon`). */
export const ENTRY_ROW_EDIT_ICON_NAME = 'adw-entry-edit-symbolic';

/** Icon name of the apply button — adw-entry-row.ui (`apply_button`). */
export const ENTRY_ROW_APPLY_ICON_NAME = 'adw-entry-apply-symbolic';

/** Tooltip of the apply button — adw-entry-row.ui. */
export const ENTRY_ROW_APPLY_TOOLTIP = 'Apply';

/** Peek-button icon while the password is masked — adw-password-entry-row.c. */
export const PASSWORD_REVEAL_ICON_NAME = 'view-reveal-symbolic';

/** Peek-button icon while the password is revealed — adw-password-entry-row.c. */
export const PASSWORD_CONCEAL_ICON_NAME = 'view-conceal-symbolic';

/** Peek-button tooltip while the password is masked — adw-password-entry-row.c. */
export const PASSWORD_REVEAL_LABEL = 'Show Password';

/** Peek-button tooltip while the password is revealed — adw-password-entry-row.c. */
export const PASSWORD_CONCEAL_LABEL = 'Hide Password';

/** Caps-lock indicator icon — adw-password-entry-row.c. */
export const CAPS_LOCK_ICON_NAME = 'caps-lock-symbolic';

/** Caps-lock indicator tooltip — adw-password-entry-row.c. */
export const CAPS_LOCK_TOOLTIP = 'Caps Lock is on';

/**
 * The number of CHARACTERS in `text`, i.e. what `adw_entry_row_get_text_length` reports.
 *
 * Code points, never UTF-16 units: `.length` reports 3 for `'🔒é'` where GTK reports 2, and
 * then truncates a surrogate pair in half. This is why `max-length` and `text-length`
 * cannot be left to the renderers.
 */
export function entryTextLength(text: string): number {
    // Spreading iterates whole CODE POINTS; `.length` would count UTF-16 units.
    return [...(text ?? '')].length;
}

/**
 * Truncate `text` to `maxLength` CHARACTERS, with `0` meaning unlimited —
 * `Adw.EntryRow:max-length` is "Maximum number of characters for the entry" and both its
 * default and its range floor are `0`. Split out of {@link EntryRowState} so a renderer can
 * also apply it on an IME/paste path before the state sees the value.
 */
export function clampEntryText(text: string, maxLength: number): string {
    const source = text ?? '';
    if (!Number.isFinite(maxLength) || maxLength <= 0) return source;
    let out = '';
    let count = 0;
    for (const ch of source) {
        if (count >= maxLength) break;
        out += ch;
        count++;
    }
    return out;
}

/**
 * Clamp a `max-length` into `[0, ENTRY_ROW_MAX_LENGTH_LIMIT]`, with a non-finite input settling
 * to `0` (unlimited) — the range `Adw.EntryRow:max-length` declares. Split out of
 * {@link EntryRowState} for the same reason {@link clampEntryText} is: a renderer that holds the
 * limit itself still has to land on the same number.
 */
export function clampEntryMaxLength(maxLength: number): number {
    if (!Number.isFinite(maxLength)) return 0;
    return Math.min(ENTRY_ROW_MAX_LENGTH_LIMIT, Math.max(0, Math.trunc(maxLength)));
}

/**
 * The complete render snapshot of an entry row: the five outputs of
 * `update_empty`, the animation endpoint it drives
 *, and the inputs a renderer echoes into CSS classes.
 *
 * ONE object rather than per-flag notifications so a renderer applies the whole
 * derivation in a single pass and can never apply half of it.
 */
export interface EntryRowRenderState {
    /** The entry contents (already truncated to `maxLength`). */
    text: string;
    /** {@link entryTextLength} of {@link text} — `Adw.EntryRow:text-length`. */
    textLength: number;
    /** `empty && !(focused && editable) && !text_changed`. Drives the placeholder title. */
    empty: boolean;
    /** Whether the embedded entry has focus. Renderers mirror it as the `focused` state class. */
    editing: boolean;
    /** Whether the embedded entry accepts edits (`GtkEditable:editable`). */
    editable: boolean;
    /** The pending-apply latch. */
    textChanged: boolean;
    /** `!text_changed && (!editing || !editable)`. */
    editIconVisible: boolean;
    /** `editable`. The pencil stays VISIBLE but goes insensitive on a read-only row. */
    editIconSensitive: boolean;
    /** `editing && show_indicator`. */
    indicatorVisible: boolean;
    /** `text_changed`. */
    applyButtonVisible: boolean;
    /**
     * Where the empty↔filled transition is headed: `0` while {@link empty}, `1` otherwise.
     * The renderer animates its OWN progress toward this over
     * {@link EMPTY_ANIMATION_DURATION_MS}, starting from wherever the progress currently is
     * — the C sets `value_from` to the live value — so an interrupted transition resumes
     * instead of restarting.
     */
    emptyTarget: 0 | 1;
}

/**
 * Per-instance subscriber for {@link EntryRowState}. Matches the
 * `ExpanderState`/`ToggleGroupState` shape in rows.ts — the change carries no
 * `interactive` flag, see the module header for why.
 */
export type EntryRowStateListener = (state: EntryRowRenderState) => void;

/**
 * What <kbd>Enter</kbd> resolves to. A discriminated union because `text_activated_cb`
 * emits exactly ONE of the two signals, never both; `activateDefault` carries the ordering
 * requirement that the default widget is activated BEFORE `entry-activated` is emitted.
 */
export type EntryRowActivation = { signal: 'apply' } | { signal: 'entry-activated'; activateDefault: boolean };

/**
 * What `update_empty` READS. Not every input of the widget: `max_length` reaches the table only
 * through `text`, and `show_apply_button` / `activates_default` only through the latch and the
 * <kbd>Enter</kbd> dispatch, so neither belongs in a function that derives the five outputs.
 */
export interface EntryRowInputs {
    /** The entry contents, already truncated to the row's `max-length`. */
    readonly text: string;
    /** Whether the embedded entry has focus — `priv->editing`. */
    readonly editing: boolean;
    /** Whether the embedded entry accepts edits (`GtkEditable:editable`). */
    readonly editable: boolean;
    /** The private `adw_entry_row_set_show_indicator` hook's state. */
    readonly showIndicator: boolean;
    /** The pending-apply latch — `priv->text_changed`. */
    readonly textChanged: boolean;
}

// THE RULES AS FUNCTIONS, BESIDE THE STATE OBJECT THAT USES THEM. `EntryRowState` is the shape a
// renderer wants when the renderer owns the storage — `@gjsify/adwaita-web` holds its values in
// one, and the conformance vectors drive it. `@gjsify/adwaita-nativescript` cannot: since ADR
// 0105 § 2 its `AdwEntryRow` is a REAL GObject on Android, and a GObject property lives in the
// GObject's own store, which `NodeGiGetProperty` reads and a JS field is not. Keeping an
// `EntryRowState` beside it would be the defect `adw-switch-row.ts` names — two stores and one of
// them stale — so that port holds the six properties itself and asks these functions for the
// rules. They are the SAME functions `EntryRowState` delegates to below, which is the point:
// the alternative was a second copy of `update_empty` in the widget, against ADR 0004.

/** `update_empty` (adw-entry-row.c:147-161) — the five outputs, as data. */
export function deriveEntryRowState(inputs: EntryRowInputs): EntryRowRenderState {
    const { text, editing, editable, showIndicator, textChanged } = inputs;
    const textLength = entryTextLength(text);
    // The C's `focused` term is `is_text_focused()`, the same source `priv->editing` is
    // assigned from, so the two are one input here.
    const empty = textLength === 0 && !(editing && editable) && !textChanged;
    return {
        text,
        textLength,
        empty,
        editing,
        editable,
        textChanged,
        editIconVisible: !textChanged && (!editing || !editable),
        editIconSensitive: editable,
        indicatorVisible: editing && showIndicator,
        applyButtonVisible: textChanged,
        emptyTarget: empty ? 0 : 1,
    };
}

/**
 * Whether a text change ARMS the pending-apply latch — `text_changed_cb` (C:166-174).
 *
 * Keyed off `show_apply_button && editing` and never off the change's ORIGIN, which is why a
 * programmatic set while the entry is focused latches exactly like a keystroke (module header).
 */
export function entryRowLatches(showApplyButton: boolean, editing: boolean): boolean {
    return showApplyButton && editing;
}

/**
 * What <kbd>Enter</kbd> resolves to — `text_activated_cb`. Pure: clearing the latch on the apply
 * path is the CALLER's, because that half is a state change and this is the decision.
 */
export function resolveEntryRowActivation(textChanged: boolean, activatesDefault: boolean): EntryRowActivation {
    // The C branches on the apply button's child-visibility, i.e. `text_changed`.
    if (textChanged) return { signal: 'apply' };
    return { signal: 'entry-activated', activateDefault: activatesDefault };
}

/**
 * `Adw.EntryRow`'s derivation, headless: the `update_empty` truth table, the
 * `text_changed` latch with both of its reset paths, character-counted
 * max-length truncation, and the two-way <kbd>Enter</kbd> dispatch.
 *
 * The setter guards are NOT uniform, and that is faithful rather than sloppy:
 * {@link setShowApplyButton} early-outs on an unchanged value and retracts a pending latch
 * when turned off, while {@link setShowIndicator} deliberately has NO equality guard and
 * always re-derives — it is the private `adw-entry-row-private.h` hook the password row
 * drives, not a public property, which is why it returns `void`.
 */
export class EntryRowState {
    private _text = '';
    private _maxLength = 0;
    private _editing = false;
    // GtkText starts editable; a read-only row is the opt-out.
    private _editable = true;
    private _showApplyButton = false;
    private _showIndicator = false;
    private _textChanged = false;
    private _activatesDefault = false;
    private readonly _listeners = new Set<EntryRowStateListener>();

    /** Subscribe to render-state changes. Returns an unsubscribe function. */
    subscribe(listener: EntryRowStateListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /** Re-run `update_empty` and push the fresh snapshot to every subscriber. */
    private _update(): void {
        const snapshot = this.state;
        // Snapshot the listener set so one unsubscribing mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._listeners]) listener(snapshot);
    }

    /** The current render snapshot — `update_empty`'s outputs, freshly derived. */
    get state(): EntryRowRenderState {
        return deriveEntryRowState({
            text: this._text,
            editing: this._editing,
            editable: this._editable,
            showIndicator: this._showIndicator,
            textChanged: this._textChanged,
        });
    }

    /** The entry contents. */
    get text(): string {
        return this._text;
    }

    /**
     * Set the contents (truncated to {@link maxLength}) and run the latch + derivation,
     * exactly as the buffer's `changed` signal does. Returns whether the text changed.
     *
     * Idempotent on an identical value. GTK routes this through GtkEntryBuffer, whose
     * emission for a same-value set is a GtkText internal this checkout has no source for
     * (`refs/gtk` is empty), so the headless contract is the house convention — and it is
     * what a renderer's `input`/`textChange` event produces anyway, since neither platform
     * fires one without a real edit.
     */
    setText(text: string): boolean {
        const next = clampEntryText(text ?? '', this._maxLength);
        if (next === this._text) return false;
        this._text = next;
        this._latchAndUpdate();
        return true;
    }

    /** `text_changed_cb` — latch iff the apply button is armed AND we are editing, then re-derive. */
    private _latchAndUpdate(): void {
        if (entryRowLatches(this._showApplyButton, this._editing)) this._textChanged = true;
        this._update();
    }

    /** {@link entryTextLength} of the contents — `Adw.EntryRow:text-length`. */
    get textLength(): number {
        return entryTextLength(this._text);
    }

    /** Maximum number of CHARACTERS, `0` = unlimited. */
    get maxLength(): number {
        return this._maxLength;
    }

    /**
     * Set the maximum length, clamped into `[0, ENTRY_ROW_MAX_LENGTH_LIMIT]`. Over-long
     * contents are truncated immediately, which runs the same latch + derivation a buffer
     * edit does.
     *
     * Returns whether the property changed. Upstream emits NO `notify` here — its setter has
     * no `g_object_notify_by_pspec` at all — and a vector pins that so a port does not
     * "helpfully" add one.
     */
    setMaxLength(maxLength: number): boolean {
        const next = clampEntryMaxLength(maxLength);
        if (next === this._maxLength) return false;
        this._maxLength = next;
        const clamped = clampEntryText(this._text, next);
        if (clamped !== this._text) {
            this._text = clamped;
            this._latchAndUpdate();
        }
        return true;
    }

    /** Whether the embedded entry has focus — `priv->editing`. */
    get editing(): boolean {
        return this._editing;
    }

    /** Feed the focus state in and re-derive — `text_state_flags_changed_cb`. Returns whether it changed. */
    setEditing(editing: boolean): boolean {
        const next = !!editing;
        if (next === this._editing) return false;
        this._editing = next;
        this._update();
        return true;
    }

    /** Whether the embedded entry accepts edits (`GtkEditable:editable`). */
    get editable(): boolean {
        return this._editable;
    }

    /** Set editability and re-derive — the `notify::editable` → `update_empty` binding in adw-entry-row.ui. Returns whether it changed. */
    setEditable(editable: boolean): boolean {
        const next = !!editable;
        if (next === this._editable) return false;
        this._editable = next;
        this._update();
        return true;
    }

    /** Whether typing reveals an apply button — `Adw.EntryRow:show-apply-button`. */
    get showApplyButton(): boolean {
        return this._showApplyButton;
    }

    /**
     * Arm/disarm the apply button. Turning it OFF retracts a pending apply; turning it ON
     * changes no derived output, which is why the C re-derives only in the retract branch.
     *
     * Returns whether the property changed — the caller's cue to re-emit
     * `notify::show-apply-button`.
     */
    setShowApplyButton(show: boolean): boolean {
        // The C normalises `show_apply_button = !!show_apply_button;` BEFORE its guard, so a
        // truthy non-boolean settles to `true` instead of sticking around as itself.
        const next = !!show;
        if (next === this._showApplyButton) return false;
        this._showApplyButton = next;
        if (!next && this._textChanged) {
            this._textChanged = false;
            this._update();
        }
        return true;
    }

    /**
     * The private indicator hook — `adw_entry_row_set_show_indicator`
     * (adw-entry-row-private.h). `void` and UNGUARDED on purpose: the C assigns and calls
     * `update_empty` unconditionally, with no equality check, so a redundant call still
     * re-derives and still notifies. `Adw.PasswordEntryRow` is the only caller upstream; a
     * renderer reaches it through {@link PasswordEntryRowState}.
     */
    setShowIndicator(show: boolean): void {
        this._showIndicator = !!show;
        this._update();
    }

    /** Whether <kbd>Enter</kbd> may activate the default widget — `Adw.EntryRow:activates-default`. */
    get activatesDefault(): boolean {
        return this._activatesDefault;
    }

    /**
     * Set `activates-default`. Returns whether it changed — the caller's cue to re-emit
     * `notify::activates-default`. The C compares the raw `gboolean` because GValue already
     * normalised it; a JS caller has no such guarantee, so coerce first.
     */
    setActivatesDefault(value: boolean): boolean {
        const next = !!value;
        if (next === this._activatesDefault) return false;
        this._activatesDefault = next;
        return true;
    }

    /** The pending-apply latch — `true` while the apply button is showing. */
    get textChanged(): boolean {
        return this._textChanged;
    }

    /**
     * Clear the latch and re-derive — `apply_button_clicked_cb`. The
     * renderer emits `apply` right after; focus handling is
     * a platform concern and stays there.
     */
    apply(): void {
        this._textChanged = false;
        this._update();
    }

    /**
     * <kbd>Enter</kbd> — `text_activated_cb`. Dispatches to the apply path when the apply
     * button is showing, otherwise reports `entry-activated` plus whether the default widget
     * must be activated FIRST. The `GtkActionable` action fired afterwards has no headless
     * equivalent and stays with the renderer.
     */
    activate(): EntryRowActivation {
        const activation = resolveEntryRowActivation(this._textChanged, this._activatesDefault);
        if (activation.signal === 'apply') this.apply();
        return activation;
    }
}

/**
 * The render snapshot of a password entry row: `notify_visibility_cb`'s icon +
 * tooltip pair plus the caps-lock inputs, as
 * data.
 *
 * The icon names and English strings are the literals from the C source, so a renderer maps
 * ONE canonical name onto whatever asset it actually ships instead of inventing a spelling.
 */
export interface PasswordEntryRowRenderState {
    /** Whether the contents are shown in clear text (`GtkText:visibility`). */
    revealed: boolean;
    /** Whether the keyboard reports Caps Lock engaged (`gdk_device_get_caps_lock_state`). */
    capsLockOn: boolean;
    /** Icon the peek button shows. */
    peekIconName: typeof PASSWORD_REVEAL_ICON_NAME | typeof PASSWORD_CONCEAL_ICON_NAME;
    /** Tooltip/accessible label of the peek button. */
    peekLabel: typeof PASSWORD_REVEAL_LABEL | typeof PASSWORD_CONCEAL_LABEL;
    /** Icon of the caps-lock indicator. Constant, exposed so a renderer reads one object. */
    indicatorIconName: typeof CAPS_LOCK_ICON_NAME;
    /** Tooltip of the caps-lock indicator. */
    indicatorTooltip: typeof CAPS_LOCK_TOOLTIP;
}

/** Per-instance subscriber for {@link PasswordEntryRowState}. */
export type PasswordEntryRowStateListener = (state: PasswordEntryRowRenderState) => void;

/**
 * All {@link PasswordEntryRowState} needs of the row beneath it: the private
 * `adw_entry_row_set_show_indicator` hook, which is the only thing the C subclass reaches its
 * parent through. STRUCTURAL rather than `EntryRowState`, because a renderer that holds the
 * entry row's values itself — `@gjsify/adwaita-nativescript`'s `AdwEntryRow`, which holds them
 * as real GObject properties — has the hook as a method on the widget and no state object to
 * hand over. `EntryRowState` satisfies it unchanged.
 */
export interface EntryRowIndicatorSink {
    setShowIndicator(show: boolean): void;
}

/**
 * `Adw.PasswordEntryRow`'s extra behaviour, headless: the reveal/conceal pair
 * and the caps-lock warning with BOTH of its suppression rules.
 *
 * COMPOSES an {@link EntryRowIndicatorSink} rather than extending the entry row, mirroring the C:
 * `AdwPasswordEntryRow` is a subclass but reaches its parent through the private
 * `adw_entry_row_set_show_indicator` hook, not a protected field. Composition
 * also keeps `EntryRowState` usable on its own for a plain entry row — and the hook being the
 * WHOLE dependency is what lets a renderer hand over the row itself instead of a state object.
 *
 * Every reveal/caps-lock change recomputes `!revealed && capsLockOn` and pushes it into the
 * entry — which is why peeking makes the caps-lock warning disappear. The second suppression
 * is the entry's own (`editing && show_indicator`): the warning only shows while the entry
 * has focus, so focus changes need no push from here — they re-derive on the entry side,
 * which is what `notify_has_focus_cb` achieves by re-running `update_caps_lock`.
 */
export class PasswordEntryRowState {
    private readonly _entry: EntryRowIndicatorSink;
    private _revealed = false;
    private _capsLockOn = false;
    private readonly _listeners = new Set<PasswordEntryRowStateListener>();

    constructor(entry: EntryRowIndicatorSink) {
        this._entry = entry;
        // `adw_password_entry_row_init` starts masked and calls `notify_visibility_cb` once to
        // seed the icon — but that callback only touches caps lock `if (self->keyboard)`, and
        // there is no keyboard before realize. So nothing is pushed into the entry here:
        // `show_indicator` is already false on both sides.
    }

    /** Subscribe to peek/caps-lock changes. Returns an unsubscribe function. */
    subscribe(listener: PasswordEntryRowStateListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private _emit(): void {
        const snapshot = this.state;
        // Snapshot the listener set so one unsubscribing mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._listeners]) listener(snapshot);
    }

    /** The current render snapshot — `notify_visibility_cb`'s derivation. */
    get state(): PasswordEntryRowRenderState {
        return {
            revealed: this._revealed,
            capsLockOn: this._capsLockOn,
            peekIconName: this._revealed ? PASSWORD_CONCEAL_ICON_NAME : PASSWORD_REVEAL_ICON_NAME,
            peekLabel: this._revealed ? PASSWORD_CONCEAL_LABEL : PASSWORD_REVEAL_LABEL,
            indicatorIconName: CAPS_LOCK_ICON_NAME,
            indicatorTooltip: CAPS_LOCK_TOOLTIP,
        };
    }

    /** Whether the contents are shown in clear text. */
    get revealed(): boolean {
        return this._revealed;
    }

    /**
     * Set the peek state. Early-outs on an unchanged value — every settable property in this
     * family does, so an unguarded `notify::revealed` on a redundant `setAttribute` is a
     * defect, not a style choice. Returns whether it changed.
     */
    setRevealed(revealed: boolean): boolean {
        const next = !!revealed;
        if (next === this._revealed) return false;
        this._revealed = next;
        // The visibility notify re-runs update_caps_lock, so peeking retracts the warning in
        // the same turn.
        this._pushIndicator();
        this._emit();
        return true;
    }

    /** Flip masked↔revealed — `show_text_clicked_cb`. Returns whether it changed. */
    togglePeek(): boolean {
        return this.setRevealed(!this._revealed);
    }

    /** Whether Caps Lock is engaged. */
    get capsLockOn(): boolean {
        return this._capsLockOn;
    }

    /**
     * Feed the keyboard's caps-lock state in — the `notify::caps-lock-state`
     * handler. Returns whether it changed.
     */
    setCapsLockOn(on: boolean): boolean {
        const next = !!on;
        if (next === this._capsLockOn) return false;
        this._capsLockOn = next;
        this._pushIndicator();
        this._emit();
        return true;
    }

    /** `update_caps_lock`. */
    private _pushIndicator(): void {
        this._entry.setShowIndicator(!this._revealed && this._capsLockOn);
    }
}
