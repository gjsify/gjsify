// Split-button conformance vectors — the spec both renderers are held to.
//
// Every row is derived from a named function in the libadwaita C source, and the four
// content SEQUENCES are line-for-line transcriptions of the upstream suite, including its
// exact per-property `notify::*` counts.
//
// The rows pin the derivations a renderer gets wrong by hand: which content slot C CLEARS
// when it uses the other, `text-button` keyed off `label[0]` with no trimming, the
// translated `More Options` default behind an empty `dropdown-tooltip`, an insensitive
// dropdown (not an empty popover) with no menu, and menu choices resolved by index rather
// than by label. `direction="none"` is the one that SHIPPED wrong in the vector AND in
// both renderers, because the vector was derived from the same misread of the stylesheet
// as the implementation — see `./index.ts`.
//
// Reference: refs/libadwaita/src/adw-split-button.c
// Reference: refs/libadwaita/tests/test-split-button.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
//            (`menubutton arrow`, overridden by `splitbutton > menubutton > button > arrow`)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { AdwMenuItem, AdwMenuModel, AdwMenuPath } from '../menu.js';
import type {
    AdwArrowIcon,
    SplitButtonContentMode,
    SplitButtonDirection,
    SplitButtonHalfState,
    SplitButtonProperty,
    SplitButtonStyleClass,
} from '../split-button.js';

/** One mutation in a {@link SplitButtonContentVector} sequence, with its outcome. */
export interface SplitButtonContentStep {
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
    mode: SplitButtonContentMode;
    /** `get_label()` after the step. */
    label: string | null;
    /** `get_icon_name()` after the step. */
    iconName: string | null;
    /** The root style classes after the step. */
    styleClasses: readonly SplitButtonStyleClass[];
    rule: string;
}

/** A scripted sequence of content mutations applied to a FRESH state. */
export interface SplitButtonContentVector {
    /** Which upstream test (or derivation) this sequence transcribes. */
    name: string;
    steps: readonly SplitButtonContentStep[];
}

/**
 * The content machine.
 *
 * Two things are easy to get wrong and are asserted explicitly. The `notified` ORDER: C
 * freezes, notifies the slots it is about to CLEAR, sets the new one, notifies it, then
 * thaws — so one `set_label()` can emit three notifications. And `child` is notified far
 * more often than a reader expects, because `adw_split_button_get_child()` returns
 * GtkButton's INTERNAL label/image widget in label/icon mode (the upstream suite says so)
 * and the C guard tests that pointer, not whether the app ever set a child.
 *
 * A driver that cannot express a step — a DOM element has no `child` slot — asserts the
 * sequence up to that step and stops; every sequence puts the interesting rows first.
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

/** One `update_style_classes` expectation. */
export interface SplitButtonStyleClassVector {
    /** `gtk_button_get_label()`. */
    label: string | null;
    /** `gtk_button_get_icon_name()`. */
    iconName: string | null;
    /** The classes on the `splitbutton` node. */
    classes: readonly SplitButtonStyleClass[];
    rule: string;
}

/**
 * `update_style_classes`. Both branches read the
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

/** One `set_dropdown_tooltip` expectation. */
export interface SplitButtonTooltipVector {
    /** The value passed to `adw_split_button_set_dropdown_tooltip`. */
    tooltip: string;
    text: string;
    /** Whether it is Pango MARKUP (`set_tooltip_markup`) rather than plain text. */
    markup: boolean;
    rule: string;
}

/**
 * The tooltip fallback in `adw_split_button_set_dropdown_tooltip`, plus its initial value.
 *
 * `has_dropdown_tooltip = tooltip && *tooltip`. The empty branch is the trap: `''` is not
 * nullish, so a nullish-coalescing fallback leaves `dropdown-tooltip=""` with NO accessible
 * name at all instead of the translated `More Options`.
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

/** One direction expectation. */
export interface SplitButtonDirectionVector {
    /** The `GtkArrowType`. */
    direction: SplitButtonDirection;
    arrowIcon: AdwArrowIcon;
    popupDirection: SplitButtonDirection;
    /** Why this row exists — naming the selector that WINS, not the one that loses. */
    rule: string;
}

/**
 * Direction → glyph for the dropdown half of a SPLIT BUTTON, and → popup
 * placement.
 *
 * `none` is the row that matters, and it is the row that was WRONG here until the
 * override was found: the four shared directions come from `menubutton arrow`
 * (`_buttons.scss`), but `.none` is re-declared inside `splitbutton { … }`
 * at :621-623, and that selector wins. See the header of `./index.ts` — "cite the
 * winning selector" — for what this table cost.
 */
export const SPLIT_BUTTON_DIRECTION_VECTORS: ReadonlyArray<SplitButtonDirectionVector> = [
    {
        direction: 'down',
        arrowIcon: 'pan-down-symbolic',
        popupDirection: 'down',
        rule: 'the default (c:420); glyph from `menubutton arrow.down`, not overridden (_buttons.scss:457-459)',
    },
    {
        direction: 'up',
        arrowIcon: 'pan-up-symbolic',
        popupDirection: 'up',
        rule: '`menubutton arrow.up`, not overridden (_buttons.scss:460-462)',
    },
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
        arrowIcon: 'pan-down-symbolic',
        popupDirection: 'down',
        rule: 'WINNING selector `splitbutton > menubutton > button > arrow.none` (_buttons.scss:621-623) OVERRIDES `menubutton arrow.none` (:454-456): inside a split button `none` draws pan-down, NOT open-menu — and pops down (c:415), so it is indistinguishable from `down`',
    },
];

/**
 * The same axis for a PLAIN `menubutton`, where nothing overrides `.none`.
 *
 * This table is not decoration: it is what makes the split button's row above a
 * demonstrated OVERRIDE rather than an assertion. Holding both means a reader can
 * see the two values and the two selectors side by side, and a renderer that
 * reaches for the wrong one fails a test that names which widget it is drawing.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (SPLIT_BUTTON_DIRECTION_VECTORS)
 */
export const MENU_BUTTON_DIRECTION_VECTORS: ReadonlyArray<SplitButtonDirectionVector> = [
    {
        direction: 'none',
        arrowIcon: 'open-menu-symbolic',
        popupDirection: 'down',
        rule: '`menubutton arrow.none` (_buttons.scss:454-456) — the hamburger, unopposed here; placement still down (c:415 via the shared GtkMenuButton, c:971/:997)',
    },
    {
        direction: 'down',
        arrowIcon: 'pan-down-symbolic',
        popupDirection: 'down',
        rule: '`menubutton arrow.down` (_buttons.scss:457-459) — identical to the split button row',
    },
    {
        direction: 'up',
        arrowIcon: 'pan-up-symbolic',
        popupDirection: 'up',
        rule: '`menubutton arrow.up` (_buttons.scss:460-462)',
    },
    {
        direction: 'left',
        arrowIcon: 'pan-start-symbolic',
        popupDirection: 'left',
        rule: '`menubutton arrow.left` (_buttons.scss:463-465)',
    },
    {
        direction: 'right',
        arrowIcon: 'pan-end-symbolic',
        popupDirection: 'right',
        rule: '`menubutton arrow.right` (_buttons.scss:466-468)',
    },
];

/** One `update_state` expectation. */
export interface SplitButtonRootStateVector {
    /** State flags of the action half. */
    action: SplitButtonHalfState;
    /** State flags of the dropdown (arrow) half. */
    dropdown: SplitButtonHalfState;
    active: boolean;
    checked: boolean;
    rule: string;
}

const IDLE: SplitButtonHalfState = { active: false, checked: false, keyboardActivating: false };

/**
 * `update_state` — an OR-fold of both halves onto
 * the root, which is what `splitbutton.flat:active/:checked` styles
 * (`_buttons.scss`).
 *
 * CORE-ONLY: GAP — two of its three axes are hardcoded in the renderer, so there is nothing to vary. Tracked in #1072
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

/** One activate-by-position expectation. */
export interface SplitButtonMenuActivationVector {
    model: AdwMenuModel;
    path: AdwMenuPath;
    /** The item that must be dispatched, or `null`. */
    activated: AdwMenuItem | null;
    rule: string;
}

const DUPLICATE_MENU: AdwMenuModel = [
    { kind: 'item', label: 'Copy', action: 'app.copy' },
    { kind: 'item', label: 'Copy', action: 'app.copy-special' },
    { kind: 'submenu', label: 'More', items: [{ kind: 'item', label: 'Copy', action: 'app.copy-as' }] },
];

/**
 * Activation is BY POSITION, never by label lookup: a `GMenuModel` addresses its
 * items by index and each carries its own detailed action. A PATH since ADR 0042,
 * because a link is a model of its own and a flat index cannot name a nested item.
 */
export const SPLIT_BUTTON_MENU_ACTIVATION_VECTORS: ReadonlyArray<SplitButtonMenuActivationVector> = [
    {
        model: DUPLICATE_MENU,
        path: [1],
        activated: { kind: 'item', label: 'Copy', action: 'app.copy-special' },
        rule: 'the SECOND of two identically labelled entries — the indexOf bug',
    },
    {
        model: DUPLICATE_MENU,
        path: [0],
        activated: { kind: 'item', label: 'Copy', action: 'app.copy' },
        rule: 'position 0',
    },
    {
        model: DUPLICATE_MENU,
        path: [2, 0],
        activated: { kind: 'item', label: 'Copy', action: 'app.copy-as' },
        rule: 'a THIRD entry with the same label, inside a submenu: only a path tells it from the other two',
    },
    {
        model: DUPLICATE_MENU,
        path: [2],
        activated: null,
        rule: 'a submenu is not an item — opening it activates nothing',
    },
    { model: DUPLICATE_MENU, path: [3], activated: null, rule: 'a position past n_items has no item' },
    { model: DUPLICATE_MENU, path: [-1], activated: null, rule: 'a negative position has no item' },
    { model: DUPLICATE_MENU, path: [0.5], activated: null, rule: 'a fractional position is not a position' },
    { model: DUPLICATE_MENU, path: [], activated: null, rule: 'the empty path names the model, not an item' },
    { model: DUPLICATE_MENU, path: [0, 0], activated: null, rule: 'an item has no children to descend into' },
    { model: [], path: [0], activated: null, rule: 'no menu model → nothing to activate' },
];

/**
 * One dropdown-sensitivity expectation. A driver installs the popover FIRST (when
 * {@link SplitButtonDropdownVector.popover} is set) and the menu model second, so
 * a row with both also exercises the dissociation.
 */
export interface SplitButtonDropdownVector {
    /** The menu model to install (empty = none). */
    model: AdwMenuModel;
    /** Whether a popover is installed before it. */
    popover: boolean;
    /** Whether the dropdown half is live. */
    enabled: boolean;
    /** Whether the menu can be popped up at all. */
    canOpen: boolean;
    rule: string;
}

/**
 * "If the menu model is `NULL`, the dropdown is disabled",
 * and the same for the popover. An empty entry list is the renderers'
 * only spelling of "no menu", so it collapses onto the `NULL` case.
 */
export const SPLIT_BUTTON_DROPDOWN_VECTORS: ReadonlyArray<SplitButtonDropdownVector> = [
    {
        model: [],
        popover: false,
        enabled: false,
        canOpen: false,
        rule: 'neither → insensitive dropdown; an empty entry list is the renderers’ spelling of "no menu", so a menu-less button must not open an empty popover',
    },
    {
        model: [{ kind: 'item', label: 'Save as…', action: 'app.save-as' }],
        popover: false,
        enabled: true,
        canOpen: true,
        rule: 'a menu model makes the dropdown live',
    },
    { model: [], popover: true, enabled: true, canOpen: true, rule: 'so does a popover on its own' },
    {
        model: [{ kind: 'item', label: 'Save as…' }],
        popover: true,
        enabled: true,
        canOpen: true,
        rule: 'setting one dissociates the other, but the dropdown stays live (c:390-403)',
    },
    {
        model: [{ kind: 'section', items: [] }],
        popover: false,
        enabled: true,
        canOpen: true,
        rule: 'a model with a node but nothing to DRAW is still a menu — the answer GTK gives for the same empty GMenu section',
    },
];
