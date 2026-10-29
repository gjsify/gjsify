// Expander-row conformance vectors — the spec every `Adw.ExpanderRow` leg is held to.
//
// `expanded` and `enable-expansion` are coupled, and the coupling is directional:
//
//   - `adw_expander_row_set_expanded` coerces `expanded && priv->enable_expansion`
//     (adw-expander-row.c:264) BEFORE its equal-return, so `expanded = true` while expansion
//     is off is not a refused write but a write of `false` over a held `false`: no notify.
//   - `adw_expander_row_set_enable_expansion` (C:303-312) returns on an equal value, stores,
//     calls `set_expanded (priv->enable_expansion)` and ONLY THEN notifies itself. Enabling
//     EXPANDS and disabling COLLAPSES, and `notify::expanded` leads `notify::enable-expansion`
//     — the opposite order to `Adw.SplitButton`, whose own property leads.
//
// Every `notified` array is a runtime measurement, not a derivation: the sequences were
// replayed against a real `Adw.ExpanderRow` on GJS 1.88.1 / libadwaita 1.9.4 / GTK 4.22.5.
//
// A leg that cannot observe a notification (a DOM element publishes `notify::expanded` only
// for a user disclosure) asserts `expanded` / `enableExpansion` and skips `notified`.
//
// Reference: refs/libadwaita/src/adw-expander-row.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** The properties an `Adw.ExpanderRow` write can notify. */
export type ExpanderRowProperty = 'expanded' | 'enable-expansion';

/** One write in an {@link ExpanderRowVector} sequence, with its outcome. */
export interface ExpanderRowStep {
    /** The property written. */
    op: ExpanderRowProperty;
    value: boolean;
    /** The `notify::*` properties this one write emits, in emission order. */
    notified: readonly ExpanderRowProperty[];
    /** `get_expanded()` afterwards. */
    expanded: boolean;
    /** `get_enable_expansion()` afterwards. */
    enableExpansion: boolean;
    rule: string;
}

/** A scripted sequence of writes applied to a FRESH row (`expanded=false`, `enable-expansion=true`). */
export interface ExpanderRowVector {
    name: string;
    steps: readonly ExpanderRowStep[];
}

/** The row `adw_expander_row_init` builds: collapsed, expansion enabled. */
export const EXPANDER_ROW_INITIAL = { expanded: false, enableExpansion: true } as const;

export const EXPANDER_ROW_VECTORS: ReadonlyArray<ExpanderRowVector> = [
    {
        name: 'a full round through disabling and re-enabling (C:264, 303-312)',
        steps: [
            {
                op: 'expanded',
                value: true,
                notified: ['expanded'],
                expanded: true,
                enableExpansion: true,
                rule: 'expanding an enabled row notifies expanded only',
            },
            {
                op: 'expanded',
                value: true,
                notified: [],
                expanded: true,
                enableExpansion: true,
                rule: 'the same value again is a no-op',
            },
            {
                op: 'enable-expansion',
                value: true,
                notified: [],
                expanded: true,
                enableExpansion: true,
                rule: 'enabling an enabled row returns before the store, so it neither notifies nor re-expands',
            },
            {
                op: 'enable-expansion',
                value: false,
                notified: ['expanded', 'enable-expansion'],
                expanded: false,
                enableExpansion: false,
                rule: 'disabling COLLAPSES, and the derived property notifies FIRST',
            },
            {
                op: 'enable-expansion',
                value: false,
                notified: [],
                expanded: false,
                enableExpansion: false,
                rule: 'disabling a disabled row is a no-op',
            },
            {
                op: 'expanded',
                value: true,
                notified: [],
                expanded: false,
                enableExpansion: false,
                rule: 'expanded = true while disabled coerces to false over the held false: refused, silent',
            },
            {
                op: 'expanded',
                value: false,
                notified: [],
                expanded: false,
                enableExpansion: false,
                rule: 'expanded = false while disabled is the held value again: silent',
            },
            {
                op: 'enable-expansion',
                value: true,
                notified: ['expanded', 'enable-expansion'],
                expanded: true,
                enableExpansion: true,
                rule: 'enabling EXPANDS, even though nobody asked for it — set_expanded (enable_expansion)',
            },
            {
                op: 'enable-expansion',
                value: true,
                notified: [],
                expanded: true,
                enableExpansion: true,
                rule: 'enabling an enabled row is a no-op',
            },
            {
                op: 'expanded',
                value: false,
                notified: ['expanded'],
                expanded: false,
                enableExpansion: true,
                rule: 'collapsing an enabled row notifies expanded only',
            },
            {
                op: 'expanded',
                value: false,
                notified: [],
                expanded: false,
                enableExpansion: true,
                rule: 'collapsing a collapsed row is a no-op',
            },
        ],
    },
    {
        name: 'disabling a collapsed row',
        steps: [
            {
                op: 'enable-expansion',
                value: false,
                notified: ['enable-expansion'],
                expanded: false,
                enableExpansion: false,
                rule: 'set_expanded (FALSE) over a held FALSE is the equal-return, so expanded stays silent',
            },
        ],
    },
];

/**
 * What a row built with BOTH properties at once ends up holding — construct properties, an XML
 * attribute pair, a `new Adw.ExpanderRow({…})`. Measured in BOTH key orders on GJS: neither
 * order lets a disabled row open. A leg applies `enableExpansion` first and `expanded` second,
 * and the reverse where it can spell it, and expects the same answer.
 */
export interface ExpanderRowConstructVector {
    expanded: boolean;
    enableExpansion: boolean;
    /** `get_expanded()` afterwards. */
    resultExpanded: boolean;
    rule: string;
}

export const EXPANDER_ROW_CONSTRUCT_VECTORS: ReadonlyArray<ExpanderRowConstructVector> = [
    {
        expanded: true,
        enableExpansion: false,
        resultExpanded: false,
        rule: 'a disabled row cannot be constructed open',
    },
    {
        expanded: true,
        enableExpansion: true,
        resultExpanded: true,
        rule: 'an enabled row can',
    },
    {
        expanded: false,
        enableExpansion: false,
        resultExpanded: false,
        rule: 'disabled and collapsed is just disabled',
    },
];
