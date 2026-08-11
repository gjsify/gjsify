// Radio-group conformance vectors — the exclusivity spec both renderers are held to.
//
// WHY A TABLE FOR SOMETHING THE BROWSER DOES FOR FREE
//
// It does not do it for free at the level that matters. `<input type="radio"
// name="g">` unchecks its sibling INPUT, and stops there: the sibling
// `<adw-radio>` HOST keeps its `checked` attribute — which is the element's
// published state and the selector the stylesheet paints from — so a group left
// to the browser draws two selected radios. `@gjsify/adwaita-nativescript` has
// no exclusivity at all. Both ports therefore carry the same rule, and this is
// the reading of it.
//
// WHAT THE SOURCE DOES AND DOES NOT SETTLE
//
// `GtkCheckButton` is a GTK widget: `refs/gtk` is EMPTY in this tree and
// libadwaita vendors no `adw-checkbox.c`, so `gtk_check_button_set_group`'s
// semantics are NOT verifiable here. The rows below are therefore derived from
// what IS observable — HTML radio behaviour, which both ports must not
// contradict — and every one of them says so in its `rule`. None of them claims
// a C line it cannot cite.
//
// WHO DRIVES THIS TABLE
//
// The core (`checks.spec.ts`) against `RadioGroupState` itself, and the browser
// suite (`adw-checks.spec.ts`) against real `<adw-radio>` elements, replaying
// each step as a click and reading back the `checked` ATTRIBUTE of every member
// — which is precisely the state the browser's own exclusivity leaves stale.
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
    /** The member's value. */
    value: string;
}

/** One radio-group scenario. */
export interface RadioGroupVector {
    /** Short scenario name. */
    name: string;
    /** The members that exist, as `[group, value]` pairs — what the renderer mounts. */
    members: ReadonlyArray<readonly [string, string]>;
    /** The mutations, applied in order to a fresh state. */
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
