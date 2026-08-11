// Entry-row conformance vectors — the spec both renderers are held to.
//
// `update_empty` is a five-output truth table — the kind of thing a renderer re-derives
// "obviously correctly" and gets wrong in two corners. So every row carries the WHOLE
// snapshot, not the one flag it is about: a drift anywhere in the derivation fails the row
// that was pinning something else.
//
// The step sequences are DATA rather than closures so a renderer suite can replay them
// against a real widget (focus the field, type, press apply) and compare what the user would
// actually see.
//
// The `EntryRowRenderState` / `PasswordEntryRowRenderState` types are imported TYPE-ONLY:
// sharing the field names with the implementation makes a renamed output a compile error
// here instead of a silently un-asserted column, with no runtime edge.
//
// Reference: refs/libadwaita/src/adw-entry-row.c, adw-entry-row.ui,
//   adw-password-entry-row.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { EntryRowActivation, EntryRowRenderState, PasswordEntryRowRenderState } from '../entry-row.js';

// --- text-length / max-length (the character-vs-UTF-16-unit rule) ---

/** One `entryTextLength` expectation. */
export interface EntryTextLengthVector {
    text: string;
    /** `adw_entry_row_get_text_length` — "The current number of characters". */
    length: number;
    rule: string;
}

/**
 * `adw_entry_row_get_text_length`, whose property is declared `0, G_MAXUINT16, 0`.
 *
 * The astral rows are the point: `'🔒é'.length` is 3 in JS because JS counts
 * UTF-16 units, and GTK counts characters. A port that gets this wrong also
 * truncates surrogate pairs in half at `max-length`.
 */
export const ENTRY_TEXT_LENGTH_VECTORS: ReadonlyArray<EntryTextLengthVector> = [
    { text: '', length: 0, rule: 'an empty entry has no characters' },
    { text: 'Ada', length: 3, rule: 'ASCII, one unit per character' },
    { text: 'Ada Lovelace', length: 12, rule: 'the space counts too' },
    { text: 'Grüße', length: 5, rule: 'precomposed Latin-1 letters are one character each' },
    { text: '🔒é', length: 2, rule: "'🔒é'.length is 3 in JS — the correct answer is 2 characters" },
    { text: '日本語', length: 3, rule: 'CJK is one character per code point' },
    {
        text: '👩‍💻',
        length: 3,
        rule: 'a ZWJ sequence is three code points — g_utf8_strlen counts characters, not graphemes',
    },
];

/** One `clampEntryText` / `setMaxLength` expectation. */
export interface EntryMaxLengthVector {
    /** The text handed to the entry. */
    text: string;
    /** `Adw.EntryRow:max-length` — `0` = unlimited. */
    maxLength: number;
    /** What the entry ends up holding. */
    clamped: string;
    /** {@link EntryTextLengthVector.length} of {@link clamped}. */
    length: number;
    rule: string;
}

/**
 * `adw_entry_row_set_max_length` read together with
 * the property doc "Maximum number of characters for the entry" and its
 * `0..GTK_ENTRY_BUFFER_MAX_SIZE` range with `0` as both default and floor.
 *
 */
export const ENTRY_MAX_LENGTH_VECTORS: ReadonlyArray<EntryMaxLengthVector> = [
    { text: 'Ada Lovelace', maxLength: 5, clamped: 'Ada L', length: 5, rule: 'truncate to five characters' },
    { text: 'Ada', maxLength: 5, clamped: 'Ada', length: 3, rule: 'shorter than the limit is untouched' },
    {
        text: 'Ada Lovelace',
        maxLength: 0,
        clamped: 'Ada Lovelace',
        length: 12,
        rule: '0 means UNLIMITED, never "truncate to empty"',
    },
    {
        text: '🔒é🔑',
        maxLength: 2,
        clamped: '🔒é',
        length: 2,
        rule: "characters, not units — slice(0,2) would yield the lone high surrogate '\\uD83D'",
    },
    {
        text: 'Grüße',
        maxLength: 3,
        clamped: 'Grü',
        length: 3,
        rule: 'non-ASCII truncation stays on character boundaries',
    },
    { text: 'Ada', maxLength: 3, clamped: 'Ada', length: 3, rule: 'exactly at the limit is untouched' },
];

// --- update_empty (the truth table) ---

/**
 * One mutation in an entry-row scenario. A renderer maps each `op` onto its own
 * platform gesture (focus/blur the field, type into it, toggle the property).
 */
export type EntryRowStep =
    | { op: 'setText'; value: string }
    | { op: 'setEditing'; value: boolean }
    | { op: 'setEditable'; value: boolean }
    | { op: 'setMaxLength'; value: number }
    | { op: 'setShowApplyButton'; value: boolean }
    | { op: 'setShowIndicator'; value: boolean }
    | { op: 'setActivatesDefault'; value: boolean }
    | { op: 'apply' };

/** One `update_empty` truth-table row: a scenario and the FULL snapshot it lands on. */
export interface EntryRowStateVector {
    name: string;
    steps: ReadonlyArray<EntryRowStep>;
    expected: EntryRowRenderState;
    rule: string;
}

/**
 * `update_empty` plus the `text_changed` latch and its two reset paths (the apply click, the
 * property turned off).
 *
 * Defaults of a fresh row: no text, unlimited length, not editing, EDITABLE,
 * no apply button, no indicator — plus the indicator and apply button starting
 * child-invisible (`adw_entry_row_init`).
 */
export const ENTRY_ROW_STATE_VECTORS: ReadonlyArray<EntryRowStateVector> = [
    {
        name: 'a fresh row is empty, with a visible sensitive pencil',
        steps: [],
        expected: {
            text: '',
            textLength: 0,
            empty: true,
            editing: false,
            editable: true,
            textChanged: false,
            editIconVisible: true,
            editIconSensitive: true,
            indicatorVisible: false,
            applyButtonVisible: false,
            emptyTarget: 0,
        },
        rule: 'update_empty C:147-161 over the init defaults + C:764-765 (indicator/apply start hidden)',
    },
    {
        name: 'focusing an empty row leaves the empty state and hides the pencil',
        steps: [{ op: 'setEditing', value: true }],
        expected: {
            text: '',
            textLength: 0,
            empty: false,
            editing: true,
            editable: true,
            textChanged: false,
            editIconVisible: false,
            editIconSensitive: true,
            indicatorVisible: false,
            applyButtonVisible: false,
            emptyTarget: 1,
        },
        rule: 'C:154 the `!(focused && editable)` term — the placeholder title shrinks on focus even with no text; C:149 hides the pencil',
    },
    {
        name: 'focusing a NON-editable row keeps the empty state, pencil visible but insensitive',
        steps: [
            { op: 'setEditable', value: false },
            { op: 'setEditing', value: true },
        ],
        expected: {
            text: '',
            textLength: 0,
            empty: true,
            editing: true,
            editable: false,
            textChanged: false,
            editIconVisible: true,
            editIconSensitive: false,
            indicatorVisible: false,
            applyButtonVisible: false,
            emptyTarget: 0,
        },
        rule: 'C:154 `!(focused && editable)` survives focus when editable is FALSE; C:149 `(!editing || !editable)` keeps the icon; C:150 desensitizes it',
    },
    {
        name: 'typing while unfocused fills the row',
        steps: [{ op: 'setText', value: 'Ada' }],
        expected: {
            text: 'Ada',
            textLength: 3,
            empty: false,
            editing: false,
            editable: true,
            textChanged: false,
            editIconVisible: true,
            editIconSensitive: true,
            indicatorVisible: false,
            applyButtonVisible: false,
            emptyTarget: 1,
        },
        rule: 'C:147 `empty = length == 0`; the latch at C:170 does not fire because editing is false',
    },
    {
        name: 'apply button armed + focused + edited reveals the apply button',
        steps: [
            { op: 'setShowApplyButton', value: true },
            { op: 'setEditing', value: true },
            { op: 'setText', value: 'A' },
        ],
        expected: {
            text: 'A',
            textLength: 1,
            empty: false,
            editing: true,
            editable: true,
            textChanged: true,
            editIconVisible: false,
            editIconSensitive: true,
            indicatorVisible: false,
            applyButtonVisible: true,
            emptyTarget: 1,
        },
        rule: 'text_changed_cb C:170-171 latches, C:152 shows the apply button, C:149 hides the pencil behind it',
    },
    {
        name: 'an edit while UNFOCUSED never arms the apply button',
        steps: [
            { op: 'setShowApplyButton', value: true },
            { op: 'setText', value: 'A' },
        ],
        expected: {
            text: 'A',
            textLength: 1,
            empty: false,
            editing: false,
            editable: true,
            textChanged: false,
            editIconVisible: true,
            editIconSensitive: true,
            indicatorVisible: false,
            applyButtonVisible: false,
            emptyTarget: 1,
        },
        rule: 'C:170 — the latch requires `editing`, so a programmatic set on an unfocused row reveals nothing',
    },
    {
        name: 'editing without the apply property still hides the pencil on focus',
        steps: [
            { op: 'setShowApplyButton', value: false },
            { op: 'setEditing', value: true },
            { op: 'setText', value: 'A' },
        ],
        expected: {
            text: 'A',
            textLength: 1,
            empty: false,
            editing: true,
            editable: true,
            textChanged: false,
            editIconVisible: false,
            editIconSensitive: true,
            indicatorVisible: false,
            applyButtonVisible: false,
            emptyTarget: 1,
        },
        rule: 'C:170 no latch without the property; C:149 the pencil still hides on focus, independently of the apply button',
    },
    {
        name: 'a read-only row still latches — `editable` is not a latch input',
        steps: [
            { op: 'setShowApplyButton', value: true },
            { op: 'setEditable', value: false },
            { op: 'setEditing', value: true },
            { op: 'setText', value: 'A' },
        ],
        expected: {
            text: 'A',
            textLength: 1,
            empty: false,
            editing: true,
            editable: false,
            textChanged: true,
            editIconVisible: false,
            editIconSensitive: false,
            indicatorVisible: false,
            applyButtonVisible: true,
            emptyTarget: 1,
        },
        rule: 'C:170 tests only `show_apply_button && editing`; C:149 `!text_changed` alone hides the pencil, C:150 keeps it insensitive',
    },
    {
        name: 'applying clears the latch and puts the apply button away',
        steps: [
            { op: 'setShowApplyButton', value: true },
            { op: 'setEditing', value: true },
            { op: 'setText', value: 'A' },
            { op: 'apply' },
        ],
        expected: {
            text: 'A',
            textLength: 1,
            empty: false,
            editing: true,
            editable: true,
            textChanged: false,
            editIconVisible: false,
            editIconSensitive: true,
            indicatorVisible: false,
            applyButtonVisible: false,
            emptyTarget: 1,
        },
        rule: 'apply_button_clicked_cb C:237-238 — and the pencil stays hidden because the row is still focused (C:149)',
    },
    {
        name: 'turning the apply property off RETRACTS a pending apply',
        steps: [
            { op: 'setShowApplyButton', value: true },
            { op: 'setEditing', value: true },
            { op: 'setText', value: 'A' },
            { op: 'setShowApplyButton', value: false },
        ],
        expected: {
            text: 'A',
            textLength: 1,
            empty: false,
            editing: true,
            editable: true,
            textChanged: false,
            editIconVisible: false,
            editIconSensitive: true,
            indicatorVisible: false,
            applyButtonVisible: false,
            emptyTarget: 1,
        },
        rule: 'C:989-992 `if (!show_apply_button && text_changed) { text_changed = FALSE; update_empty (self); }`',
    },
    {
        name: 'an emptied row with a pending apply is NOT in the empty state after blur',
        steps: [
            { op: 'setShowApplyButton', value: true },
            { op: 'setEditing', value: true },
            { op: 'setText', value: 'A' },
            { op: 'setText', value: '' },
            { op: 'setEditing', value: false },
        ],
        expected: {
            text: '',
            textLength: 0,
            empty: false,
            editing: false,
            editable: true,
            textChanged: true,
            editIconVisible: false,
            editIconSensitive: true,
            indicatorVisible: false,
            applyButtonVisible: true,
            emptyTarget: 1,
        },
        rule: 'C:154 the THIRD term `&& !priv->text_changed` — the corner both ports would get wrong by hand',
    },
    {
        name: 'the indicator stays hidden while the row is unfocused',
        steps: [{ op: 'setShowIndicator', value: true }],
        expected: {
            text: '',
            textLength: 0,
            empty: true,
            editing: false,
            editable: true,
            textChanged: false,
            editIconVisible: true,
            editIconSensitive: true,
            indicatorVisible: false,
            applyButtonVisible: false,
            emptyTarget: 0,
        },
        rule: 'C:151 `gtk_widget_set_child_visible (priv->indicator, priv->editing && priv->show_indicator)`',
    },
    {
        name: 'the indicator appears once the row takes focus',
        steps: [
            { op: 'setShowIndicator', value: true },
            { op: 'setEditing', value: true },
        ],
        expected: {
            text: '',
            textLength: 0,
            empty: false,
            editing: true,
            editable: true,
            textChanged: false,
            editIconVisible: false,
            editIconSensitive: true,
            indicatorVisible: true,
            applyButtonVisible: false,
            emptyTarget: 1,
        },
        rule: 'C:151 — the second half of the caps-lock suppression rule',
    },
    {
        name: 'max-length truncates the text that is set into it',
        steps: [
            { op: 'setMaxLength', value: 5 },
            { op: 'setText', value: 'Ada Lovelace' },
        ],
        expected: {
            text: 'Ada L',
            textLength: 5,
            empty: false,
            editing: false,
            editable: true,
            textChanged: false,
            editIconVisible: true,
            editIconSensitive: true,
            indicatorVisible: false,
            applyButtonVisible: false,
            emptyTarget: 1,
        },
        rule: 'C:1329-1343 + the "Maximum number of characters" property doc (C:674)',
    },
    {
        name: 'lowering max-length truncates the text already there',
        steps: [
            { op: 'setText', value: 'Ada Lovelace' },
            { op: 'setMaxLength', value: 5 },
        ],
        expected: {
            text: 'Ada L',
            textLength: 5,
            empty: false,
            editing: false,
            editable: true,
            textChanged: false,
            editIconVisible: true,
            editIconSensitive: true,
            indicatorVisible: false,
            applyButtonVisible: false,
            emptyTarget: 1,
        },
        rule: 'the buffer cannot hold more than the maximum (C:674, :678-682) — the truncation goes through the same changed→update_empty path',
    },
    {
        name: 'max-length 0 is unlimited',
        steps: [
            { op: 'setMaxLength', value: 0 },
            { op: 'setText', value: 'Ada Lovelace' },
        ],
        expected: {
            text: 'Ada Lovelace',
            textLength: 12,
            empty: false,
            editing: false,
            editable: true,
            textChanged: false,
            editIconVisible: true,
            editIconSensitive: true,
            indicatorVisible: false,
            applyButtonVisible: false,
            emptyTarget: 1,
        },
        rule: 'C:678-682 — the range floor AND the default are both 0, and adw-entry-row.ui sets `max-length 0` on the GtkText',
    },
    {
        name: 'a filled read-only row keeps the pencil, insensitive',
        steps: [
            { op: 'setEditable', value: false },
            { op: 'setText', value: 'Ada' },
            { op: 'setEditing', value: true },
        ],
        expected: {
            text: 'Ada',
            textLength: 3,
            empty: false,
            editing: true,
            editable: false,
            textChanged: false,
            editIconVisible: true,
            editIconSensitive: false,
            indicatorVisible: false,
            applyButtonVisible: false,
            emptyTarget: 1,
        },
        rule: 'C:149-150 — visibility and sensitivity are two separate outputs and disagree here',
    },
];

// --- the Enter key (the two-way dispatch) ---

/** One `text_activated_cb` expectation. */
export interface EntryRowActivationVector {
    name: string;
    /** Applied in order to a freshly-constructed entry row before pressing Enter. */
    steps: ReadonlyArray<EntryRowStep>;
    /** What Enter resolves to — exactly ONE signal. */
    activation: EntryRowActivation;
    /** The latch afterwards (`apply` clears it; `entry-activated` leaves state alone). */
    textChangedAfter: boolean;
    rule: string;
}

/**
 * `text_activated_cb`: the apply path when the apply
 * button is child-visible, otherwise activate-the-default followed
 * by `entry-activated` — in that order.
 */
export const ENTRY_ROW_ACTIVATION_VECTORS: ReadonlyArray<EntryRowActivationVector> = [
    {
        name: 'Enter applies when the apply button is showing',
        steps: [
            { op: 'setShowApplyButton', value: true },
            { op: 'setEditing', value: true },
            { op: 'setText', value: 'A' },
        ],
        activation: { signal: 'apply' },
        textChangedAfter: false,
        rule: 'C:248-249 — `apply` is emitted, `entry-activated` is NOT',
    },
    {
        name: 'Enter emits entry-activated when there is nothing to apply',
        steps: [{ op: 'setText', value: 'A' }],
        activation: { signal: 'entry-activated', activateDefault: false },
        textChangedAfter: false,
        rule: 'C:250-256 — `apply` is NOT emitted; activates-default defaults to FALSE (C:654-657)',
    },
    {
        name: 'Enter activates the default widget FIRST when activates-default is set',
        steps: [
            { op: 'setActivatesDefault', value: true },
            { op: 'setText', value: 'A' },
        ],
        activation: { signal: 'entry-activated', activateDefault: true },
        textChangedAfter: false,
        rule: 'C:253-256 — gtk_widget_activate_default on line 254, g_signal_emit on line 256: the default runs BEFORE the signal',
    },
    {
        name: 'Enter on an untouched empty row still emits entry-activated',
        steps: [],
        activation: { signal: 'entry-activated', activateDefault: false },
        textChangedAfter: false,
        rule: 'C:243-266 has no content guard — Enter always resolves to exactly one of the two signals',
    },
    {
        name: 'Enter with the apply property armed but nothing typed emits entry-activated',
        steps: [
            { op: 'setShowApplyButton', value: true },
            { op: 'setEditing', value: true },
        ],
        activation: { signal: 'entry-activated', activateDefault: false },
        textChangedAfter: false,
        rule: 'C:248 branches on the apply button being CHILD-VISIBLE (i.e. the latch), not on the property',
    },
];

// --- setter guards (which ones early-out, and which deliberately do not) ---

/** One setter-guard expectation: what each step returns, and how many re-derivations the sequence causes. */
export interface EntryRowGuardVector {
    name: string;
    steps: ReadonlyArray<EntryRowStep>;
    /** Per step: the setter's return value, or `null` for the `void` `setShowIndicator`. */
    returns: ReadonlyArray<boolean | null>;
    /** How many times subscribers are notified across the whole sequence. */
    notifications: number;
    rule: string;
}

/**
 * The guards are NOT uniform, and the asymmetry is the point: every public
 * setter early-outs on an unchanged value, while
 * the private `adw_entry_row_set_show_indicator` deliberately has
 * NO equality check and re-derives unconditionally.
 *
 * CORE-ONLY: GAP — the browser element exposes these as attributes and void methods, so a setter's boolean return is not observable through the DOM surface. Tracked in #1072
 */
export const ENTRY_ROW_GUARD_VECTORS: ReadonlyArray<EntryRowGuardVector> = [
    {
        name: 'setShowApplyButton early-outs on an unchanged value',
        steps: [
            { op: 'setShowApplyButton', value: true },
            { op: 'setShowApplyButton', value: true },
        ],
        returns: [true, false],
        notifications: 0,
        rule: 'C:982-985 — and arming the button re-derives NOTHING, so the C only calls update_empty in the retract branch (C:989-992)',
    },
    {
        name: 'setShowIndicator does NOT early-out — it always re-derives',
        steps: [{ op: 'setShowIndicator', value: false }],
        returns: [null],
        notifications: 1,
        rule: 'C:1281-1296 assigns and calls update_empty unconditionally, with no equality guard — deliberately unlike setShowApplyButton',
    },
    {
        name: 'setShowIndicator re-derives on every call, redundant or not',
        steps: [
            { op: 'setShowIndicator', value: false },
            { op: 'setShowIndicator', value: false },
        ],
        returns: [null, null],
        notifications: 2,
        rule: 'C:1281-1296 — two calls, two update_empty runs',
    },
    {
        name: 'setText early-outs on an identical value',
        steps: [
            { op: 'setText', value: 'Ada' },
            { op: 'setText', value: 'Ada' },
        ],
        returns: [true, false],
        notifications: 1,
        rule: 'text_changed_cb C:166-174 runs off the buffer CHANGE; neither renderer fires an edit event without a real edit',
    },
    {
        name: 'setEditing early-outs on an unchanged focus state',
        steps: [
            { op: 'setEditing', value: true },
            { op: 'setEditing', value: true },
        ],
        returns: [true, false],
        notifications: 1,
        rule: 'text_state_flags_changed_cb C:176-189 — `priv->editing` only moves when focus actually crosses the widget',
    },
    {
        name: 'setEditable early-outs when already editable',
        steps: [{ op: 'setEditable', value: true }],
        returns: [false],
        notifications: 0,
        rule: 'the `notify::editable` → update_empty binding in adw-entry-row.ui only fires on a real property change',
    },
    {
        name: 'setMaxLength early-outs on an unchanged limit and notifies nothing',
        steps: [
            { op: 'setMaxLength', value: 5 },
            { op: 'setMaxLength', value: 5 },
        ],
        returns: [true, false],
        notifications: 0,
        rule: 'C:1339-1340 is the equality early-out; C:1329-1343 contains NO g_object_notify_by_pspec for PROP_MAX_LENGTH — pinned so a port does not "helpfully" add one',
    },
];

/** One mutation in a password-entry-row scenario. */
export type PasswordEntryRowStep =
    | { op: 'setRevealed'; value: boolean }
    | { op: 'togglePeek' }
    | { op: 'setCapsLockOn'; value: boolean }
    /** A step applied to the COMPOSED entry row (e.g. focusing the field). */
    | { op: 'entry'; step: EntryRowStep };

/** One password-entry-row expectation: the peek/caps-lock snapshot plus what it did to the parent row. */
export interface PasswordEntryRowVector {
    name: string;
    /** Applied in order to a freshly-constructed password entry row. */
    steps: ReadonlyArray<PasswordEntryRowStep>;
    /** Every output of the password derivation afterwards. */
    expected: PasswordEntryRowRenderState;
    /** `indicatorVisible` on the composed entry row — the caps-lock warning the user actually sees. */
    entryIndicatorVisible: boolean;
    rule: string;
}

/**
 * `notify_visibility_cb` + `update_caps_lock`,
 * and the two rules that make the caps-lock warning more than a
 * boolean: it is suppressed while PEEKING (`!gtk_text_get_visibility`) and while UNFOCUSED
 * (`editing && show_indicator`).
 */
export const PASSWORD_ENTRY_ROW_VECTORS: ReadonlyArray<PasswordEntryRowVector> = [
    {
        name: 'a fresh password row is masked and offers to show the password',
        steps: [],
        expected: {
            revealed: false,
            capsLockOn: false,
            peekIconName: 'view-reveal-symbolic',
            peekLabel: 'Show Password',
            indicatorIconName: 'caps-lock-symbolic',
            indicatorTooltip: 'Caps Lock is on',
        },
        entryIndicatorVisible: false,
        rule: 'adw_password_entry_row_init C:158 (visibility FALSE), :169-171 (indicator icon + tooltip), :175 → :73-76',
    },
    {
        name: 'peeking swaps the eye to conceal and offers to hide',
        steps: [{ op: 'togglePeek' }],
        expected: {
            revealed: true,
            capsLockOn: false,
            peekIconName: 'view-conceal-symbolic',
            peekLabel: 'Hide Password',
            indicatorIconName: 'caps-lock-symbolic',
            indicatorTooltip: 'Caps Lock is on',
        },
        entryIndicatorVisible: false,
        rule: 'show_text_clicked_cb C:94-96 flips visibility → notify_visibility_cb C:67-71',
    },
    {
        name: 'caps lock while focused and masked shows the warning',
        steps: [
            { op: 'entry', step: { op: 'setEditing', value: true } },
            { op: 'setCapsLockOn', value: true },
        ],
        expected: {
            revealed: false,
            capsLockOn: true,
            peekIconName: 'view-reveal-symbolic',
            peekLabel: 'Show Password',
            indicatorIconName: 'caps-lock-symbolic',
            indicatorTooltip: 'Caps Lock is on',
        },
        entryIndicatorVisible: true,
        rule: 'update_caps_lock C:57-59 `!visibility && caps_lock_state` → adw-entry-row.c:151 `editing && show_indicator`',
    },
    {
        name: 'peeking suppresses the caps-lock warning without clearing caps lock',
        steps: [
            { op: 'entry', step: { op: 'setEditing', value: true } },
            { op: 'setCapsLockOn', value: true },
            { op: 'togglePeek' },
        ],
        expected: {
            revealed: true,
            capsLockOn: true,
            peekIconName: 'view-conceal-symbolic',
            peekLabel: 'Hide Password',
            indicatorIconName: 'caps-lock-symbolic',
            indicatorTooltip: 'Caps Lock is on',
        },
        entryIndicatorVisible: false,
        rule: 'C:58 the `!gtk_text_get_visibility(...)` term, re-evaluated by the visibility notify at C:79-80',
    },
    {
        name: 'caps lock while UNFOCUSED shows nothing',
        steps: [{ op: 'setCapsLockOn', value: true }],
        expected: {
            revealed: false,
            capsLockOn: true,
            peekIconName: 'view-reveal-symbolic',
            peekLabel: 'Show Password',
            indicatorIconName: 'caps-lock-symbolic',
            indicatorTooltip: 'Caps Lock is on',
        },
        entryIndicatorVisible: false,
        rule: 'adw-entry-row.c:151, with adw-password-entry-row.c:83-88 re-evaluating caps lock on the focus notify',
    },
    {
        name: 'concealing again brings the caps-lock warning back',
        steps: [
            { op: 'entry', step: { op: 'setEditing', value: true } },
            { op: 'setCapsLockOn', value: true },
            { op: 'togglePeek' },
            { op: 'togglePeek' },
        ],
        expected: {
            revealed: false,
            capsLockOn: true,
            peekIconName: 'view-reveal-symbolic',
            peekLabel: 'Show Password',
            indicatorIconName: 'caps-lock-symbolic',
            indicatorTooltip: 'Caps Lock is on',
        },
        entryIndicatorVisible: true,
        rule: 'C:79-80 re-runs update_caps_lock on EVERY visibility change, in both directions',
    },
    {
        name: 'releasing caps lock while peeking leaves the warning off',
        steps: [
            { op: 'entry', step: { op: 'setEditing', value: true } },
            { op: 'setCapsLockOn', value: true },
            { op: 'togglePeek' },
            { op: 'setCapsLockOn', value: false },
        ],
        expected: {
            revealed: true,
            capsLockOn: false,
            peekIconName: 'view-conceal-symbolic',
            peekLabel: 'Hide Password',
            indicatorIconName: 'caps-lock-symbolic',
            indicatorTooltip: 'Caps Lock is on',
        },
        entryIndicatorVisible: false,
        rule: 'C:57-59 — both terms must hold; neither one alone shows the warning',
    },
];

/** One peek-notification expectation — how often a reveal change is observable. */
export interface PasswordRevealGuardVector {
    name: string;
    /** Reveal-only steps applied to a freshly-constructed password entry row. */
    steps: ReadonlyArray<{ op: 'setRevealed'; value: boolean } | { op: 'togglePeek' }>;
    /** How many reveal notifications the sequence produces. */
    notifications: number;
    rule: string;
}

/**
 * The peek guard. Every settable property in this family early-outs on an unchanged value,
 * so a redundant set is silent — an unguarded `notify::revealed` on a same-value
 * `setAttribute` is a defect.
 */
export const PASSWORD_REVEAL_GUARD_VECTORS: ReadonlyArray<PasswordRevealGuardVector> = [
    {
        name: 'a redundant reveal is silent',
        steps: [
            { op: 'setRevealed', value: true },
            { op: 'setRevealed', value: true },
        ],
        notifications: 1,
        rule: 'adw-entry-row.c:984/:1198/:1247 — the family early-outs on an unchanged value',
    },
    {
        name: 'concealing an already-masked row is silent',
        steps: [{ op: 'setRevealed', value: false }],
        notifications: 0,
        rule: 'the same guard, from the other side — a fresh row is already masked (adw-password-entry-row.c:158)',
    },
    {
        name: 'each peek toggle notifies exactly once',
        steps: [{ op: 'togglePeek' }, { op: 'togglePeek' }],
        notifications: 2,
        rule: 'show_text_clicked_cb C:94-96 flips the value, so every tap is a real change',
    },
];
