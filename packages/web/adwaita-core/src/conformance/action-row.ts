// Action-row family conformance vectors — the spec both renderers are held to.
//
// Covers `Adw.ActionRow`, `Adw.SwitchRow`, `Adw.ButtonRow` and
// `Adw.WindowTitle`. Every row cites the C line it is derived from; the
// `LABEL_VISIBILITY_VECTORS` table is shared by all four, because in libadwaita
// it is literally one closure declared four times.
//
// Reference: refs/libadwaita/src/adw-action-row.c, adw-action-row.ui
// Reference: refs/libadwaita/src/adw-switch-row.c
// Reference: refs/libadwaita/src/adw-button-row.c, adw-button-row.ui
// Reference: refs/libadwaita/src/adw-window-title.c, adw-window-title.ui
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

// ---------------------------------------------------------------------------
// The shared label rule
// ---------------------------------------------------------------------------

/** One `string_is_not_empty` expectation. */
export interface LabelVisibilityVector {
    /** The label's text — `null` stands for "property unset / attribute absent". */
    text: string | null;
    /** Whether the bound label is visible. */
    visible: boolean;
    rule: string;
}

/**
 * `string_is_not_empty` (adw-action-row.c:112-117 ≡ adw-button-row.c:92-97,
 * inlined at adw-window-title.c:208 and :249).
 *
 * Applies to the TITLE and to the subtitle alike — the bindings are two copies
 * of the same closure (adw-action-row.ui:49-53 and :71-75). The title half is
 * what every port dropped: a row with `title=""` kept a zero-height but
 * line-height-consuming label, and `<adw-window-title>` reserved a title line in
 * every header bar that only had a subtitle.
 *
 * `' '` is the canary row. The C never trims — `string && string[0]` reads ONE
 * byte — so a single space is a VISIBLE label. A port reaching for
 * `value.trim().length` passes every other row here and fails this one.
 */
export const LABEL_VISIBILITY_VECTORS: ReadonlyArray<LabelVisibilityVector> = [
    { text: 'Wi-Fi', visible: true, rule: 'an ordinary label shows' },
    { text: '', visible: false, rule: 'the EMPTY string hides the label — the half both ports dropped for titles' },
    { text: null, visible: false, rule: 'an unset property hides it too (`string &&` guards the NULL)' },
    { text: ' ', visible: true, rule: 'ONE SPACE IS VISIBLE — `string[0]` reads a byte, it never trims' },
    { text: '\t', visible: true, rule: 'any non-NUL first byte counts, tabs included' },
    { text: '0', visible: true, rule: 'a falsy-looking string is still a string' },
    { text: 'Ελληνικά', visible: true, rule: 'non-ASCII is not special — the check is on the first byte' },
];

// ---------------------------------------------------------------------------
// Adw.ActionRow — the activatable-widget coupling
// ---------------------------------------------------------------------------

/** One step of an {@link ActionRowActivationVector}. */
export type ActionRowStep =
    /** `adw_action_row_set_activatable_widget` — `widget` is an opaque id, `null` clears. */
    | { op: 'set-activatable-widget'; widget: string | null; sensitive?: boolean }
    /**
     * The bound widget's `GtkWidget:sensitive` was WRITTEN with this value —
     * not necessarily changed. A write of the value it already holds is a
     * deliberate case: `gtk_widget_set_sensitive` early-returns on it, so
     * `notify::sensitive` never fires and the GBinding propagates nothing.
     */
    | { op: 'set-widget-sensitive'; sensitive: boolean }
    /** A direct write to `GtkListBoxRow:activatable`. */
    | { op: 'set-activatable'; activatable: boolean };

/** One `activatable-widget` ↔ `activatable` expectation. */
export interface ActionRowActivationVector {
    /** What the scenario is called. */
    name: string;
    /** The steps to run against a fresh row, in order. */
    steps: readonly ActionRowStep[];
    /** `GtkListBoxRow:activatable` afterwards. */
    activatable: boolean;
    /** `AdwActionRow:activatable-widget` afterwards, by id. */
    activatableWidget: string | null;
    rule: string;
}

/**
 * `adw_action_row_set_activatable_widget` (adw-action-row.c:696-741).
 *
 * The two rows that decide whether a port read the C or guessed it:
 * `insensitive-widget-does-not-activate` (the binding is `sensitive` →
 * `activatable` with `G_BINDING_SYNC_CREATE`, C:729-732 — NOT a constant TRUE),
 * and `unsetting-keeps-activatable` (clearing only unbinds, C:709, so the flag
 * stays where the binding last left it — stated outright at C:28-30).
 */
export const ACTION_ROW_ACTIVATION_VECTORS: ReadonlyArray<ActionRowActivationVector> = [
    {
        name: 'default',
        steps: [],
        activatable: false,
        activatableWidget: null,
        rule: 'the template starts unactivatable (adw-action-row.ui:5)',
    },
    {
        name: 'sensitive-widget-activates',
        steps: [{ op: 'set-activatable-widget', widget: 'switch' }],
        activatable: true,
        activatableWidget: 'switch',
        rule: 'SYNC_CREATE copies the widget’s sensitive (TRUE) into activatable',
    },
    {
        name: 'insensitive-widget-does-not-activate',
        steps: [{ op: 'set-activatable-widget', widget: 'switch', sensitive: false }],
        activatable: false,
        activatableWidget: 'switch',
        rule: 'the bind reads sensitive — an insensitive widget leaves the row unactivatable',
    },
    {
        name: 'sensitive-flip-follows',
        steps: [
            { op: 'set-activatable-widget', widget: 'switch' },
            { op: 'set-widget-sensitive', sensitive: false },
        ],
        activatable: false,
        activatableWidget: 'switch',
        rule: 'the binding is LIVE — desensitising the widget deactivates the row',
    },
    {
        name: 'unsetting-keeps-activatable',
        steps: [
            { op: 'set-activatable-widget', widget: 'switch' },
            { op: 'set-activatable-widget', widget: null },
        ],
        activatable: true,
        activatableWidget: null,
        rule: 'clearing only unbinds (C:709) — “unsetting it won’t change the row’s activatability”',
    },
    {
        name: 'unbound-sensitivity-is-inert',
        steps: [
            { op: 'set-activatable-widget', widget: 'switch' },
            { op: 'set-activatable-widget', widget: null },
            { op: 'set-widget-sensitive', sensitive: false },
        ],
        activatable: true,
        activatableWidget: null,
        rule: 'with no widget there is no binding left to carry a sensitive change',
    },
    {
        name: 'rebinding-resyncs',
        steps: [
            { op: 'set-activatable-widget', widget: 'switch' },
            { op: 'set-activatable-widget', widget: null },
            { op: 'set-activatable-widget', widget: 'button', sensitive: false },
        ],
        activatable: false,
        activatableWidget: 'button',
        rule: 'a new binding re-syncs from the NEW widget, sticky value and all',
    },
    {
        name: 'direct-write-lands',
        steps: [
            { op: 'set-activatable-widget', widget: 'switch' },
            { op: 'set-activatable', activatable: false },
        ],
        activatable: false,
        activatableWidget: 'switch',
        rule: 'the binding is one-way, so a direct write is not refused',
    },
    {
        name: 'direct-write-is-overwritten',
        steps: [
            { op: 'set-activatable-widget', widget: 'switch' },
            { op: 'set-activatable', activatable: false },
            { op: 'set-widget-sensitive', sensitive: false },
            { op: 'set-widget-sensitive', sensitive: true },
        ],
        activatable: true,
        activatableWidget: 'switch',
        rule: '…and the next sensitive CHANGE overwrites it, because the source wins',
    },
    {
        name: 'unchanged-sensitive-does-not-re-assert',
        steps: [
            { op: 'set-activatable-widget', widget: 'switch' },
            { op: 'set-activatable', activatable: false },
            { op: 'set-widget-sensitive', sensitive: true },
        ],
        activatable: false,
        activatableWidget: 'switch',
        rule: 'a re-write of the sensitive it already had emits no notify, so the binding carries nothing',
    },
];

// ---------------------------------------------------------------------------
// Adw.SwitchRow — the notify rule
// ---------------------------------------------------------------------------

/** One step of a {@link SwitchRowNotifyVector}. */
export type SwitchRowStep =
    /** `adw_switch_row_set_active` — a PROGRAMMATIC set. */
    | { op: 'set-active'; active: boolean }
    /** The row itself was activated (clicked / <kbd>Enter</kbd>). */
    | { op: 'activate-row' };

/** One `notify::active` expectation. */
export interface SwitchRowNotifyVector {
    /** What the scenario is called. */
    name: string;
    /** The steps to run against a fresh row, in order. */
    steps: readonly SwitchRowStep[];
    /** `Adw.SwitchRow:active` afterwards. */
    active: boolean;
    /** The `active` value carried by each `notify::active`, in emission order. */
    emitted: readonly boolean[];
    rule: string;
}

/**
 * `adw_switch_row_set_active` (C:216-228) → `slider_notify_active_cb` (C:66-77).
 *
 * `programmatic-set-notifies` is the row the two renderers answered differently:
 * the notify is emitted by the SLIDER's own `notify::active`, which fires
 * whatever wrote it, so there is no programmatic-vs-interactive split to model.
 * `activate-row-toggles` is the row NEITHER had: `adw_switch_row_init` points
 * the activatable-widget at the slider (C:160-162) and the class docs spell out
 * the result (C:23-27).
 */
export const SWITCH_ROW_NOTIFY_VECTORS: ReadonlyArray<SwitchRowNotifyVector> = [
    {
        name: 'default',
        steps: [],
        active: false,
        emitted: [],
        rule: 'the pspec default is FALSE (C:141-143)',
    },
    {
        name: 'programmatic-set-notifies',
        steps: [{ op: 'set-active', active: true }],
        active: true,
        emitted: [true],
        rule: 'a programmatic set reaches the slider, whose notify is the row’s notify',
    },
    {
        name: 'unchanged-set-is-silent',
        steps: [{ op: 'set-active', active: false }],
        active: false,
        emitted: [],
        rule: 'the equality early-return at C:224-225 fires before anything is written',
    },
    {
        name: 'repeat-set-is-silent',
        steps: [
            { op: 'set-active', active: true },
            { op: 'set-active', active: true },
        ],
        active: true,
        emitted: [true],
        rule: 'only the first of two identical sets changes anything',
    },
    {
        name: 'activate-row-toggles',
        steps: [{ op: 'activate-row' }],
        active: true,
        emitted: [true],
        rule: 'activating the row inverts the state — the row IS the switch’s label',
    },
    {
        name: 'activate-row-toggles-back',
        steps: [{ op: 'activate-row' }, { op: 'activate-row' }],
        active: false,
        emitted: [true, false],
        rule: 'and it inverts again, notifying each time',
    },
    {
        name: 'mixed-paths-notify-alike',
        steps: [{ op: 'set-active', active: true }, { op: 'activate-row' }, { op: 'set-active', active: true }],
        active: true,
        emitted: [true, false, true],
        rule: 'one notify path for both origins — no `interactive` flag exists here',
    },
];

// ---------------------------------------------------------------------------
// Adw.ButtonRow
// ---------------------------------------------------------------------------

/** One `Adw.ButtonRow` icon expectation. */
export interface ButtonRowIconVector {
    /** `AdwButtonRow:start-icon-name`. */
    startIconName: string | null;
    /** `AdwButtonRow:end-icon-name`. */
    endIconName: string | null;
    /** Whether the leading `image.icon.start` shows (adw-button-row.ui:20-24). */
    startIconVisible: boolean;
    /** Whether the trailing `image.icon.end` shows (adw-button-row.ui:55-59). */
    endIconVisible: boolean;
    rule: string;
}

/**
 * The two icons of `Adw.ButtonRow` (C:201-223), each bound through the same
 * `string_is_not_empty` closure as the title.
 *
 * `end-icon-name` has existed since 1.6 and was missing from BOTH renderers, so
 * every row with a trailing chevron had to be faked with a suffix widget the
 * widget does not have.
 */
export const BUTTON_ROW_ICON_VECTORS: ReadonlyArray<ButtonRowIconVector> = [
    {
        startIconName: null,
        endIconName: null,
        startIconVisible: false,
        endIconVisible: false,
        rule: 'both default to "" (C:255-256) and both images stay hidden',
    },
    {
        startIconName: 'list-add-symbolic',
        endIconName: null,
        startIconVisible: true,
        endIconVisible: false,
        rule: 'a leading icon alone',
    },
    {
        startIconName: null,
        endIconName: 'go-next-symbolic',
        startIconVisible: false,
        endIconVisible: true,
        rule: 'a TRAILING icon alone — the property neither renderer had',
    },
    {
        startIconName: 'document-open-symbolic',
        endIconName: 'external-link-symbolic',
        startIconVisible: true,
        endIconVisible: true,
        rule: 'both at once, the "Open in Files ›" shape the property exists for',
    },
    {
        startIconName: '',
        endIconName: '',
        startIconVisible: false,
        endIconVisible: false,
        rule: 'the empty string hides an icon exactly like an unset one',
    },
];

/** One "is this row activatable" expectation. */
export interface ButtonRowActivatableVector {
    /** The `activatable` markup/property a caller supplies, if any. */
    declared: string | null;
    /** Whether the row activates. Always `true`. */
    activatable: boolean;
    rule: string;
}

/**
 * `Adw.ButtonRow` is always activatable — `adw-button-row.ui:5` sets it TRUE in
 * the template, `adw-button-row.c:31` documents it in one line, and the class
 * exposes no property, no setter and no getter for it (the whole public surface
 * is C:270-352: `new`, and the two icon-name pairs).
 *
 * The vector exists because the browser renderer had invented an
 * `activatable="false"` opt-out — and `adw-button-row.spec.ts` PINNED the
 * invention with a passing test, which is worse than not testing it: it made the
 * divergence look like a decision. A row that reads its own attribute is a row
 * that has to be told to ignore it.
 */
export const BUTTON_ROW_ACTIVATABLE_VECTORS: ReadonlyArray<ButtonRowActivatableVector> = [
    { declared: null, activatable: true, rule: 'nothing declared — the template value stands' },
    { declared: '', activatable: true, rule: 'a bare attribute changes nothing, there is nothing to change' },
    { declared: 'false', activatable: true, rule: 'THE INVENTED OPT-OUT: libadwaita has no such switch' },
    { declared: 'true', activatable: true, rule: 'and no such switch in the other direction either' },
];

// ---------------------------------------------------------------------------
// Adw.WindowTitle
// ---------------------------------------------------------------------------

/** One step of a {@link WindowTitleVector}. */
export type WindowTitleStep = { op: 'set-title'; value: string | null } | { op: 'set-subtitle'; value: string | null };

/** One `Adw.WindowTitle` expectation. */
export interface WindowTitleVector {
    /** What the scenario is called. */
    name: string;
    /** The steps to run against a fresh window title, in order. */
    steps: readonly WindowTitleStep[];
    /** The title text afterwards. */
    title: string;
    /** Whether the title label is visible (C:207-208). */
    titleVisible: boolean;
    /** The subtitle text afterwards. */
    subtitle: string;
    /** Whether the subtitle label is visible (C:248-249). */
    subtitleVisible: boolean;
    /** Which property each `notify::*` named, in emission order. */
    notified: readonly ('title' | 'subtitle')[];
    rule: string;
}

/**
 * `adw_window_title_set_title` / `_set_subtitle` (C:197-211, C:238-252).
 *
 * `null-over-empty-is-silent` is the one DIVERGENCE in this file, and it is
 * deliberate: libadwaita would notify there, because its guard compares a
 * never-NULL `gtk_label_get_label` against a possibly-NULL argument and
 * `g_strcmp0 ("", NULL)` is 1. `WindowTitleState` (`../action-row.ts`) carries
 * the reasoning for why the port normalises before comparing.
 */
export const WINDOW_TITLE_VECTORS: ReadonlyArray<WindowTitleVector> = [
    {
        name: 'default',
        steps: [],
        title: '',
        titleVisible: false,
        subtitle: '',
        subtitleVisible: false,
        notified: [],
        rule: 'both labels start `visible=False` (adw-window-title.ui:15, :26)',
    },
    {
        name: 'title-only',
        steps: [{ op: 'set-title', value: 'Documents' }],
        title: 'Documents',
        titleVisible: true,
        subtitle: '',
        subtitleVisible: false,
        notified: ['title'],
        rule: 'a header bar with no subtitle must not reserve a subtitle line',
    },
    {
        name: 'subtitle-only',
        steps: [{ op: 'set-subtitle', value: '3 selected' }],
        title: '',
        titleVisible: false,
        subtitle: '3 selected',
        subtitleVisible: true,
        notified: ['subtitle'],
        rule: 'THE TITLE HIDES TOO — the rule neither renderer applied to the title',
    },
    {
        name: 'both',
        steps: [
            { op: 'set-title', value: 'Documents' },
            { op: 'set-subtitle', value: '3 selected' },
        ],
        title: 'Documents',
        titleVisible: true,
        subtitle: '3 selected',
        subtitleVisible: true,
        notified: ['title', 'subtitle'],
        rule: 'the ordinary two-line case',
    },
    {
        name: 'cleared-title-hides-again',
        steps: [
            { op: 'set-title', value: 'Documents' },
            { op: 'set-title', value: '' },
        ],
        title: '',
        titleVisible: false,
        subtitle: '',
        subtitleVisible: false,
        notified: ['title', 'title'],
        rule: 'clearing is a change, so it hides AND notifies',
    },
    {
        name: 'unchanged-set-is-silent',
        steps: [
            { op: 'set-title', value: 'Documents' },
            { op: 'set-title', value: 'Documents' },
        ],
        title: 'Documents',
        titleVisible: true,
        subtitle: '',
        subtitleVisible: false,
        notified: ['title'],
        rule: 'the `g_strcmp0` early-return at C:203-204 drops the second set',
    },
    {
        name: 'space-title-stays-visible',
        steps: [{ op: 'set-title', value: ' ' }],
        title: ' ',
        titleVisible: true,
        subtitle: '',
        subtitleVisible: false,
        notified: ['title'],
        rule: '`title && title[0]` reads one byte — a space is a visible title',
    },
    {
        name: 'null-over-empty-is-silent',
        steps: [{ op: 'set-title', value: null }],
        title: '',
        titleVisible: false,
        subtitle: '',
        subtitleVisible: false,
        notified: [],
        rule: 'DIVERGENCE: libadwaita notifies here, via `g_strcmp0 ("", NULL) == 1`',
    },
];
