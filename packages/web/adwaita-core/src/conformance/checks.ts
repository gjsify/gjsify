// Radio-group conformance vectors — the exclusivity spec both renderers are held to.
//
// The browser does NOT do this for free at the level that matters: `<input type="radio"
// name="g">` unchecks its sibling INPUT and stops there, so the sibling `<adw-radio>` HOST
// keeps its `checked` attribute — the element's published state and the selector the
// stylesheet paints from — and a group left to the browser draws two selected radios.
// `@gjsify/adwaita-nativescript` has no exclusivity at all, so both ports carry the rule.
//
// WHAT THE SOURCE DOES NOT SETTLE: `GtkCheckButton` is a GTK widget and libadwaita vendors
// no `adw-checkbox.c`, so `gtk_check_button_set_group`'s semantics cannot be cited from
// `refs/libadwaita`. Every row is instead derived from observable HTML radio behaviour,
// which both ports must not contradict, and says so in its `rule` — none claims a C line
// it cannot cite.
//
// The browser suite drives these against real `<adw-radio>` elements by reading back the
// `checked` ATTRIBUTE of every member, which is precisely the state the browser's own
// exclusivity leaves stale.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_checks.scss (the styling that renders the state)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { RadioGroupChange } from '../checks.js';

/**
 * One mutation in a radio scenario. DATA, not a closure: the browser suite
 * replays these as clicks on real elements rather than as method calls.
 */
export interface RadioGroupStep {
    op: 'select';
    /** The group name — what `name` scopes in HTML, and what the state keys on. */
    name: string;
    value: string;
}

/** One radio-group scenario. */
export interface RadioGroupVector {
    name: string;
    /** The members that exist, as `[group, value]` pairs — what the renderer mounts. */
    members: ReadonlyArray<readonly [string, string]>;
    steps: readonly RadioGroupStep[];
    /** `selected(group)` afterwards, one entry per group in {@link members}. */
    selected: ReadonlyArray<readonly [string, string | null]>;
    /** Every change the state emits, in order. This IS the renderer's repaint feed. */
    emitted: ReadonlyArray<RadioGroupChange>;
    rule: string;
}

/** `RadioGroupState.select` and the exclusivity it publishes. */
export const RADIO_GROUP_VECTORS: ReadonlyArray<RadioGroupVector> = [
    {
        name: 'a group nobody has picked in',
        members: [
            ['colour', 'red'],
            ['colour', 'green'],
        ],
        steps: [],
        selected: [['colour', null]],
        emitted: [],
        rule: 'reports nothing selected rather than defaulting to the first member — whether GTK activates one is not verifiable in this tree (refs/gtk is empty)',
    },
    {
        name: 'the first pick',
        members: [
            ['colour', 'red'],
            ['colour', 'green'],
        ],
        steps: [{ op: 'select', name: 'colour', value: 'red' }],
        selected: [['colour', 'red']],
        emitted: [{ name: 'colour', selected: 'red', deselected: null }],
        rule: 'nothing held the selection, so `deselected` is null — the renderer has no second member to repaint',
    },
    {
        name: 'a second pick deselects the first',
        members: [
            ['colour', 'red'],
            ['colour', 'green'],
        ],
        steps: [
            { op: 'select', name: 'colour', value: 'red' },
            { op: 'select', name: 'colour', value: 'green' },
        ],
        selected: [['colour', 'green']],
        emitted: [
            { name: 'colour', selected: 'red', deselected: null },
            { name: 'colour', selected: 'green', deselected: 'red' },
        ],
        rule: 'ONE notification carries both halves — this is the event the browser does not give the host element, which keeps a stale `checked` attribute otherwise',
    },
    {
        name: 'picking the member already selected',
        members: [
            ['colour', 'red'],
            ['colour', 'green'],
        ],
        steps: [
            { op: 'select', name: 'colour', value: 'red' },
            { op: 'select', name: 'colour', value: 'red' },
        ],
        selected: [['colour', 'red']],
        emitted: [{ name: 'colour', selected: 'red', deselected: null }],
        rule: 'idempotent: a user clicking a checked radio twice notifies once and stays checked — an HTML radio cannot be unchecked by clicking it either',
    },
    {
        name: 'switching back',
        members: [
            ['colour', 'red'],
            ['colour', 'green'],
        ],
        steps: [
            { op: 'select', name: 'colour', value: 'red' },
            { op: 'select', name: 'colour', value: 'green' },
            { op: 'select', name: 'colour', value: 'red' },
        ],
        selected: [['colour', 'red']],
        emitted: [
            { name: 'colour', selected: 'red', deselected: null },
            { name: 'colour', selected: 'green', deselected: 'red' },
            { name: 'colour', selected: 'red', deselected: 'green' },
        ],
        rule: 'the deselected half is always the value that was held, never the first-ever one — a renderer that remembers the original loses the middle repaint',
    },
    {
        name: 'two groups are independent',
        members: [
            ['colour', 'red'],
            ['size', 'red'],
        ],
        steps: [
            { op: 'select', name: 'colour', value: 'red' },
            { op: 'select', name: 'size', value: 'red' },
        ],
        selected: [
            ['colour', 'red'],
            ['size', 'red'],
        ],
        emitted: [
            { name: 'colour', selected: 'red', deselected: null },
            { name: 'size', selected: 'red', deselected: null },
        ],
        rule: 'the group NAME scopes exclusivity exactly as `name` does in HTML; the same VALUE in two groups is not a conflict, and neither deselects the other',
    },
];
