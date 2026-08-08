// Split-button conformance vectors — the spec both renderers are held to.
//
// Every row is derived from a named function in the libadwaita C source, and the
// four content SEQUENCES are line-for-line transcriptions of the upstream suite
// (`refs/libadwaita/tests/test-split-button.c`), including its exact per-property
// `notify::*` counts. Running the same table against the core state machine, the
// Custom Element and the NativeScript widget is what turns "the two ports drifted
// apart and away from GTK" into a failing unit test that names the input.
//
// The divergences these vectors exist to catch, all of them real before the lift:
//   - `<adw-split-button label="Save" icon-name="document-save">` rendered the
//     icon AND the text, where C clears whichever slot it is not using;
//   - removing the `label` attribute was a silent no-op in the browser port, so
//     the storybook's icon-only mode showed icon + stale label;
//   - `label="  "` was trimmed away in the browser port, flipping the icon-only
//     branch, where C keys `text-button` off `label[0]` and never trims;
//   - the NativeScript port kept the stale label VALUE behind a swapped view and
//     titled its action sheet with it;
//   - `dropdown-tooltip=""` produced an EMPTY accessible name instead of the
//     translated `More Options` default;
//   - a split button with no menu opened an empty popover instead of having an
//     insensitive dropdown;
//   - a menu choice was resolved with `indexOf` on the label, so two entries
//     called `Copy` always dispatched the first.
//
// Reference: refs/libadwaita/src/adw-split-button.c
// Reference: refs/libadwaita/tests/test-split-button.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type {
    AdwMenuEntry,
    SplitButtonContentMode,
    SplitButtonDirection,
    SplitButtonHalfState,
    SplitButtonProperty,
    SplitButtonStyleClass,
} from '../split-button.js';

// --- Content machine: label / icon-name / child mutual exclusion ---

/** One mutation in a {@link SplitButtonContentVector} sequence, with its outcome. */
export interface SplitButtonContentStep {
    /** Which slot is being set. */
    op: 'label' | 'icon-name' | 'child';
    /**
     * The value passed. For `label`/`icon-name` the string itself; for `child` a
     * KEY naming one of three distinct child objects the driver supplies, or
     * `null` to clear the content.
     */
    value: string | null;
    /** Whether the setter reports a change (and therefore notifies at all). */
    changed: boolean;
    /** The `notify::*` properties C emits for this one call, in emission order. */
    notified: readonly SplitButtonProperty[];
    /** The content mode after the step. */
    mode: SplitButtonContentMode;
    /** `get_label()` after the step. */
    label: string | null;
    /** `get_icon_name()` after the step. */
    iconName: string | null;
    /** The root style classes after the step. */
    styleClasses: readonly SplitButtonStyleClass[];
    /** Why this step exists — the rule or edge case it pins down. */
    rule: string;
}

/** A scripted sequence of content mutations applied to a FRESH state. */
export interface SplitButtonContentVector {
    /** Which upstream test (or derivation) this sequence transcribes. */
    name: string;
    /** The mutations, in order. */
    steps: readonly SplitButtonContentStep[];
}

/**
 * The content machine (adw-split-button.c:661-682, :749-771, :799-824).
 *
 * Two things in here are easy to get wrong and are asserted explicitly. First,
 * the `notified` ORDER: C freezes, notifies the slots it is about to CLEAR, sets
 * the new one, notifies it, then thaws — so one `set_label()` can emit three
 * notifications. Second, `child` is notified far more often than a reader
 * expects, because `adw_split_button_get_child()` returns GtkButton's INTERNAL
 * label/image widget in label/icon mode (the upstream suite states this at
 * tests/test-split-button.c:155-157) and the C guard tests that pointer, not
 * whether the app ever set a child.
 *
 * A driver that cannot express a step — a DOM element has no `child` slot —
 * asserts the sequence up to that step and stops; every sequence is written so
 * the interesting rows come first.
 */
export const SPLIT_BUTTON_CONTENT_VECTORS: ReadonlyArray<SplitButtonContentVector> = [
    {
        name: 'icon-name (test_adw_split_button_icon_name, tests/test-split-button.c:17-55)',
        steps: [
            {
                op: 'icon-name',
                value: 'document-open-symbolic',
                changed: true,
                notified: ['icon-name'],
                mode: 'icon',
                label: null,
                iconName: 'document-open-symbolic',
                styleClasses: ['image-button'],
                rule: 'first icon on an empty button notifies icon-name only (:31-32)',
            },
            {
                op: 'icon-name',
                value: 'document-open-symbolic',
                changed: false,
                notified: [],
                mode: 'icon',
                label: null,
                iconName: 'document-open-symbolic',
                styleClasses: ['image-button'],
                rule: 'same icon again is a no-op — `if (!g_strcmp0 …) return` (:34-36 / c:756-757)',
            },
            {
                op: 'icon-name',
                value: 'edit-find-symbolic',
                changed: true,
                notified: ['child', 'icon-name'],
                mode: 'icon',
                label: null,
                iconName: 'edit-find-symbolic',
                styleClasses: ['image-button'],
                rule: 'icon→icon still notifies child: the internal GtkImage is non-NULL (:38-40 / c:762-763)',
            },
            {
                op: 'label',
                value: 'Open',
                changed: true,
                notified: ['icon-name', 'child', 'label'],
                mode: 'label',
                label: 'Open',
                iconName: null,
                styleClasses: ['text-button'],
                rule: 'setting the label CLEARS the icon — get_icon_name() is NULL after (:42-44)',
            },
            {
                op: 'icon-name',
                value: 'document-open-symbolic',
                changed: true,
                notified: ['label', 'child', 'icon-name'],
                mode: 'icon',
                label: null,
                iconName: 'document-open-symbolic',
                styleClasses: ['image-button'],
                rule: 'and back: setting the icon CLEARS the label (:46-48)',
            },
            {
                op: 'child',
                value: 'child1',
                changed: true,
                notified: ['icon-name', 'child'],
                mode: 'child',
                label: null,
                iconName: null,
                styleClasses: [],
                rule: 'a child clears both, and carries neither style class (:50-52)',
            },
        ],
    },
    {
        name: 'label (test_adw_split_button_label, tests/test-split-button.c:57-95)',
        steps: [
            {
                op: 'label',
                value: 'Open',
                changed: true,
                notified: ['label'],
                mode: 'label',
                label: 'Open',
                iconName: null,
                styleClasses: ['text-button'],
                rule: 'first label on an empty button notifies label only (:71-72)',
            },
            {
                op: 'label',
                value: 'Open',
                changed: false,
                notified: [],
                mode: 'label',
                label: 'Open',
                iconName: null,
                styleClasses: ['text-button'],
                rule: 'same label again is a no-op (:74-76 / c:668-669)',
            },
            {
                op: 'label',
                value: 'Find',
                changed: true,
                notified: ['child', 'label'],
                mode: 'label',
                label: 'Find',
                iconName: null,
                styleClasses: ['text-button'],
                rule: 'label→label notifies child: the internal GtkLabel is non-NULL (:78-80 / c:674-675)',
            },
            {
                op: 'icon-name',
                value: 'document-open-symbolic',
                changed: true,
                notified: ['label', 'child', 'icon-name'],
                mode: 'icon',
                label: null,
                iconName: 'document-open-symbolic',
                styleClasses: ['image-button'],
                rule: 'setting the icon CLEARS the label — get_label() is NULL after (:82-84)',
            },
            {
                op: 'label',
                value: 'Open',
                changed: true,
                notified: ['icon-name', 'child', 'label'],
                mode: 'label',
                label: 'Open',
                iconName: null,
                styleClasses: ['text-button'],
                rule: 'and back again (:86-88)',
            },
            {
                op: 'child',
                value: 'child1',
                changed: true,
                notified: ['label', 'child'],
                mode: 'child',
                label: null,
                iconName: null,
                styleClasses: [],
                rule: 'a child clears the label (:90-92)',
            },
        ],
    },
    {
        name: 'child (test_adw_split_button_child, tests/test-split-button.c:125-170)',
        steps: [
            {
                op: 'child',
                value: null,
                changed: false,
                notified: [],
                mode: 'empty',
                label: null,
                iconName: null,
                styleClasses: [],
                rule: 'clearing an already-empty button is a no-op (:143-144 / c:806-807)',
            },
            {
                op: 'child',
                value: 'child1',
                changed: true,
                notified: ['child'],
                mode: 'child',
                label: null,
                iconName: null,
                styleClasses: [],
                rule: 'first child notifies child only (:146-148)',
            },
            {
                op: 'child',
                value: 'child2',
                changed: true,
                notified: ['child'],
                mode: 'child',
                label: null,
                iconName: null,
                styleClasses: [],
                rule: 'child→child notifies once; neither label nor icon was set (:150-152)',
            },
            {
                op: 'label',
                value: 'Open',
                changed: true,
                notified: ['child', 'label'],
                mode: 'label',
                label: 'Open',
                iconName: null,
                styleClasses: ['text-button'],
                rule: 'the label replaces the app child — get_child() is no longer it (:154-159)',
            },
            {
                op: 'child',
                value: 'child3',
                changed: true,
                notified: ['label', 'child'],
                mode: 'child',
                label: null,
                iconName: null,
                styleClasses: [],
                rule: 'a child clears the label back out (:161-163)',
            },
            {
                op: 'icon-name',
                value: 'document-open-symbolic',
                changed: true,
                notified: ['child', 'icon-name'],
                mode: 'icon',
                label: null,
                iconName: 'document-open-symbolic',
                styleClasses: ['image-button'],
                rule: 'the icon replaces the app child (:165-167)',
            },
        ],
    },
    {
        name: 'empty + whitespace labels (derived from adw-split-button.c:151-159, not asserted upstream)',
        steps: [
            {
                op: 'label',
                value: '',
                changed: true,
                notified: ['label'],
                mode: 'label',
                label: '',
                iconName: null,
                styleClasses: [],
                rule: 'an empty label is SET (non-NULL) but `label[0]` is NUL — no text-button class (c:156)',
            },
            {
                op: 'icon-name',
                value: '',
                changed: true,
                notified: ['label', 'child', 'icon-name'],
                mode: 'icon',
                label: null,
                iconName: '',
                styleClasses: [],
                rule: 'the empty label is still a non-NULL pointer, so it is notified as cleared (c:760-761)',
            },
            {
                op: 'label',
                value: '  ',
                changed: true,
                notified: ['icon-name', 'child', 'label'],
                mode: 'label',
                label: '  ',
                iconName: null,
                styleClasses: ['text-button'],
                rule: 'whitespace is a valid label: nothing trims, and `label[0]` is a space (c:156-159)',
            },
            {
                op: 'label',
                value: '  ',
                changed: false,
                notified: [],
                mode: 'label',
                label: '  ',
                iconName: null,
                styleClasses: ['text-button'],
                rule: 'g_strcmp0 is a byte compare — the same two spaces are the same label',
            },
            {
                op: 'label',
                value: 'Änderungen speichern…',
                changed: true,
                notified: ['child', 'label'],
                mode: 'label',
                label: 'Änderungen speichern…',
                iconName: null,
                styleClasses: ['text-button'],
                rule: 'non-ASCII is stored verbatim — no normalisation, no escaping (c:661-682)',
            },
        ],
    },
];

// --- Root style classes ---

/** One `update_style_classes` expectation. */
export interface SplitButtonStyleClassVector {
    /** `gtk_button_get_label()`. */
    label: string | null;
    /** `gtk_button_get_icon_name()`. */
    iconName: string | null;
    /** The classes on the `splitbutton` node. */
    classes: readonly SplitButtonStyleClass[];
    /** Why this row exists. */
    rule: string;
}

/**
 * `update_style_classes` (adw-split-button.c:145-165). Both branches read the
 * FIRST CHARACTER, which is why `''` and `'  '` land on opposite sides.
 */
export const SPLIT_BUTTON_STYLE_CLASS_VECTORS: ReadonlyArray<SplitButtonStyleClassVector> = [
    { label: 'Open', iconName: null, classes: ['text-button'], rule: 'a label gives text-button (c:156-159)' },
    {
        label: null,
        iconName: 'document-open-symbolic',
        classes: ['image-button'],
        rule: 'an icon gives image-button (c:151-154)',
    },
    { label: '', iconName: null, classes: [], rule: '`label[0]` is NUL — an empty label carries NO class' },
    { label: null, iconName: '', classes: [], rule: '`icon_name[0]` is NUL — an empty icon name carries NO class' },
    { label: '  ', iconName: null, classes: ['text-button'], rule: 'two spaces are a non-empty label — no trimming' },
    { label: '\t', iconName: null, classes: ['text-button'], rule: 'any non-NUL first byte counts, tab included' },
    { label: null, iconName: null, classes: [], rule: 'a child (or nothing) carries neither class (c:145-165)' },
    {
        label: 'Open',
        iconName: 'document-open-symbolic',
        classes: ['image-button', 'text-button'],
        rule: 'the two branches are independent and evaluated icon-first (c:151-159)',
    },
];

// --- Dropdown tooltip ---

/** One `set_dropdown_tooltip` expectation. */
export interface SplitButtonTooltipVector {
    /** The value passed to `adw_split_button_set_dropdown_tooltip`. */
    tooltip: string;
    /** What the dropdown actually shows. */
    text: string;
    /** Whether it is Pango MARKUP (`set_tooltip_markup`) rather than plain text. */
    markup: boolean;
    /** Why this row exists. */
    rule: string;
}

/**
 * The tooltip fallback (adw-split-button.c:1044-1051, initial value :531-532).
 *
 * `has_dropdown_tooltip = tooltip && *tooltip`. The empty branch is the one both
 * renderers got wrong: the browser port hardcoded `Menu` and, because `''` is not
 * nullish, `dropdown-tooltip=""` left the button with NO accessible name at all;
 * the NativeScript port had neither tooltip nor accessible name.
 */
export const SPLIT_BUTTON_TOOLTIP_VECTORS: ReadonlyArray<SplitButtonTooltipVector> = [
    { tooltip: '', text: 'More Options', markup: false, rule: 'unset/cleared restores the translated default as TEXT' },
    { tooltip: 'Some tooltip', text: 'Some tooltip', markup: true, rule: 'a set tooltip is markup (c:1046-1047)' },
    {
        tooltip: 'Some <b>tooltip</b>',
        text: 'Some <b>tooltip</b>',
        markup: true,
        rule: 'Pango markup passes through unescaped (c:428)',
    },
    { tooltip: ' ', text: ' ', markup: true, rule: '`*tooltip` is a space — non-NUL, so it is a real tooltip' },
];

// --- Direction ---

/** One direction expectation. */
export interface SplitButtonDirectionVector {
    /** The `GtkArrowType`. */
    direction: SplitButtonDirection;
    /** The symbolic icon the arrow node draws. */
    arrowIcon: string;
    /** Where the popup is placed. */
    popupDirection: SplitButtonDirection;
    /** Why this row exists. */
    rule: string;
}

/**
 * Direction → glyph (_buttons.scss:451-469) and → popup placement
 * (adw-split-button.c:415). `none` is the row that matters: it places the popup
 * like `down` but draws a completely different icon.
 */
export const SPLIT_BUTTON_DIRECTION_VECTORS: ReadonlyArray<SplitButtonDirectionVector> = [
    {
        direction: 'down',
        arrowIcon: 'pan-down-symbolic',
        popupDirection: 'down',
        rule: 'the default (c:420)',
    },
    { direction: 'up', arrowIcon: 'pan-up-symbolic', popupDirection: 'up', rule: 'arrow.up (_buttons.scss:460-462)' },
    {
        direction: 'left',
        arrowIcon: 'pan-start-symbolic',
        popupDirection: 'left',
        rule: 'left uses pan-START, not pan-left (_buttons.scss:463-465)',
    },
    {
        direction: 'right',
        arrowIcon: 'pan-end-symbolic',
        popupDirection: 'right',
        rule: 'right uses pan-END (_buttons.scss:466-468)',
    },
    {
        direction: 'none',
        arrowIcon: 'open-menu-symbolic',
        popupDirection: 'down',
        rule: 'none draws open-menu but pops DOWN (_buttons.scss:451-453 + c:415)',
    },
];

// --- Root state fold ---

/** One `update_state` expectation. */
export interface SplitButtonRootStateVector {
    /** State flags of the action half. */
    action: SplitButtonHalfState;
    /** State flags of the dropdown (arrow) half. */
    dropdown: SplitButtonHalfState;
    /** Whether the root reads ACTIVE. */
    active: boolean;
    /** Whether the root reads CHECKED. */
    checked: boolean;
    /** Why this row exists. */
    rule: string;
}

const IDLE: SplitButtonHalfState = { active: false, checked: false, keyboardActivating: false };

/**
 * `update_state` (adw-split-button.c:118-143) — an OR-fold of both halves onto
 * the root, which is what `splitbutton.flat:active/:checked` styles
 * (_buttons.scss:542-549).
 */
export const SPLIT_BUTTON_ROOT_STATE_VECTORS: ReadonlyArray<SplitButtonRootStateVector> = [
    { action: IDLE, dropdown: IDLE, active: false, checked: false, rule: 'idle folds to idle' },
    {
        action: { ...IDLE, active: true },
        dropdown: IDLE,
        active: true,
        checked: false,
        rule: 'a pressed action half makes the WHOLE control active (c:134-137)',
    },
    {
        action: IDLE,
        dropdown: { ...IDLE, active: true },
        active: true,
        checked: false,
        rule: 'so does a pressed dropdown half — the flags are OR-ed (c:127-128)',
    },
    {
        action: IDLE,
        dropdown: { ...IDLE, checked: true },
        active: false,
        checked: true,
        rule: 'an open menu checks the arrow half, and the root with it (c:139-142)',
    },
    {
        action: { ...IDLE, keyboardActivating: true },
        dropdown: IDLE,
        active: true,
        checked: false,
        rule: 'the keyboard-activating CSS class counts as ACTIVE (c:130-135)',
    },
    {
        action: { ...IDLE, active: true },
        dropdown: { ...IDLE, checked: true },
        active: true,
        checked: true,
        rule: 'active and checked are independent folds',
    },
];

// --- Menu model ---

/** One `parseMenuEntries` expectation. */
export interface SplitButtonMenuParseVector {
    /** The raw `menu` attribute (or `null` when absent). */
    json: string | null;
    /** The entries it yields. */
    entries: readonly AdwMenuEntry[];
    /** Why this row exists. */
    rule: string;
}

/**
 * Menu-attribute parsing — the byte-identical helper both browser elements
 * carried. Total: nothing an author can type may prevent the widget upgrading.
 */
export const SPLIT_BUTTON_MENU_PARSE_VECTORS: ReadonlyArray<SplitButtonMenuParseVector> = [
    {
        json: '[{"label":"Save as…","action":"app.save-as"}]',
        entries: [{ label: 'Save as…', action: 'app.save-as' }],
        rule: 'the GTK shape: (label, detailed action) pairs (c:385-388)',
    },
    {
        json: '[{"label":"Copy","action":"app.copy"},{"label":"Copy","action":"app.copy-special"}]',
        entries: [
            { label: 'Copy', action: 'app.copy' },
            { label: 'Copy', action: 'app.copy-special' },
        ],
        rule: 'duplicate labels are legal and must NOT collapse',
    },
    {
        json: '[{"label":"About","id":"about","icon":"help-about-symbolic"}]',
        entries: [{ label: 'About', id: 'about', icon: 'help-about-symbolic' }],
        rule: 'the menu-button extras (id/icon) share the same entry type',
    },
    { json: null, entries: [], rule: 'no attribute → no menu' },
    { json: '', entries: [], rule: 'an empty attribute → no menu' },
    { json: 'not json at all', entries: [], rule: 'malformed JSON degrades to no menu, it does not throw' },
    { json: '{"label":"Save"}', entries: [], rule: 'a non-array root is rejected wholesale' },
    { json: '[]', entries: [], rule: 'an empty array is an empty menu' },
    { json: '[{"action":"app.x"},null,42,["label"]]', entries: [], rule: 'entries without a `label` key are dropped' },
    {
        json: '[{"label":42,"action":7}]',
        entries: [{ label: '42' }],
        rule: 'the label is String()-coerced; a non-string action is dropped rather than leaked',
    },
];

/** One activate-by-position expectation. */
export interface SplitButtonMenuActivationVector {
    /** The menu model. */
    entries: readonly AdwMenuEntry[];
    /** The position activated. */
    index: number;
    /** The entry that must be dispatched, or `null`. */
    activated: AdwMenuEntry | null;
    /** Why this row exists. */
    rule: string;
}

const DUPLICATE_MENU: readonly AdwMenuEntry[] = [
    { label: 'Copy', action: 'app.copy' },
    { label: 'Copy', action: 'app.copy-special' },
];

/**
 * Activation is BY POSITION, never by label lookup: a `GMenuModel` addresses its
 * items by index and each carries its own detailed action (adw-split-button.c:385-388).
 */
export const SPLIT_BUTTON_MENU_ACTIVATION_VECTORS: ReadonlyArray<SplitButtonMenuActivationVector> = [
    {
        entries: DUPLICATE_MENU,
        index: 1,
        activated: { label: 'Copy', action: 'app.copy-special' },
        rule: 'the SECOND of two identically labelled entries — the indexOf bug',
    },
    { entries: DUPLICATE_MENU, index: 0, activated: { label: 'Copy', action: 'app.copy' }, rule: 'position 0' },
    { entries: DUPLICATE_MENU, index: 2, activated: null, rule: 'a position past n_items has no item' },
    { entries: DUPLICATE_MENU, index: -1, activated: null, rule: 'a negative position has no item' },
    { entries: DUPLICATE_MENU, index: 0.5, activated: null, rule: 'a fractional position is not a position' },
    { entries: [], index: 0, activated: null, rule: 'no menu model → nothing to activate' },
];

/**
 * One dropdown-sensitivity expectation. A driver installs the popover FIRST (when
 * {@link SplitButtonDropdownVector.popover} is set) and the menu model second, so
 * a row with both also exercises the dissociation.
 */
export interface SplitButtonDropdownVector {
    /** The menu model to install (empty = none). */
    entries: readonly AdwMenuEntry[];
    /** Whether a popover is installed before it. */
    popover: boolean;
    /** Whether the dropdown half is live. */
    enabled: boolean;
    /** Whether the menu can be popped up at all. */
    canOpen: boolean;
    /** Why this row exists. */
    rule: string;
}

/**
 * "If the menu model is `NULL`, the dropdown is disabled" (adw-split-button.c:376-378),
 * and the same for the popover (:394-396). An empty entry list is the renderers'
 * only spelling of "no menu", so it collapses onto the `NULL` case.
 */
export const SPLIT_BUTTON_DROPDOWN_VECTORS: ReadonlyArray<SplitButtonDropdownVector> = [
    {
        entries: [],
        popover: false,
        enabled: false,
        canOpen: false,
        rule: 'neither → insensitive dropdown; an empty entry list is the renderers’ spelling of "no menu", so a menu-less button must not open an empty popover',
    },
    {
        entries: [{ label: 'Save as…', action: 'app.save-as' }],
        popover: false,
        enabled: true,
        canOpen: true,
        rule: 'a menu model makes the dropdown live',
    },
    { entries: [], popover: true, enabled: true, canOpen: true, rule: 'so does a popover on its own' },
    {
        entries: [{ label: 'Save as…' }],
        popover: true,
        enabled: true,
        canOpen: true,
        rule: 'setting one dissociates the other, but the dropdown stays live (c:390-403)',
    },
];
