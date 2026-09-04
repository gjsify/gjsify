// Adwaita split-button behaviour — headless.
//
// `Adw.SplitButton` is a combined button + dropdown; everything about it that is NOT
// pixels is a small state machine, lifted here (ADR 0004) so there is one answer:
//
// 1. a four-slot content machine — `empty | label | icon | child` — where
// setting one slot clears the other two, with C's idempotence guards and
// its exact `notify::*` EMISSION ORDER (cleared properties first, then the
// one being set, inside one freeze/thaw);
// 2. two derived root style classes keyed off the FIRST CHARACTER of the
// string rather than truthiness: `image-button` iff `icon_name[0]`,
// `text-button` iff `label[0]`;
// 3. the dropdown-tooltip fallback, with the markup/plain-text distinction —
// a non-empty value is Pango markup, an empty one restores the translated
// `More Options` default;
// 4. menu-model ⟷ popover exclusivity and the derived `dropdownEnabled`, which
// is what makes a menu-less split button's dropdown INSENSITIVE;
// 5. the direction → arrow-glyph map, in the TWO variants the stylesheet has:
// a plain `menubutton` draws `open-menu-symbolic` for `none`, a split button
// draws `pan-down-symbolic`, because `splitbutton` OVERRIDES `arrow.none`;
// 6. the root-state OR-fold: the whole control reads ACTIVE if either half is
// pressed or keyboard-activating, CHECKED if either half is checked (the
// arrow half is checked while the menu is open).
//
// The vectors in `conformance/split-button.ts` hold both renderers to this file.
//
// PLATFORM-NEUTRAL: renders nothing, imports nothing, touches no global. The
// per-instance `subscribe` seam matches `ComboState`/`SpinState` in `rows.ts`; every
// mutator returns whether it changed and notifies only on a real change.
//
// NOT LIFTED: `can-shrink` — a pixel-layout property (label ellipsizing) with no
// headless behaviour — and `GtkLabel`'s `_S` → underlined-S mnemonic rendering.
//
// Reference: refs/libadwaita/src/adw-split-button.c (AdwSplitButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
// (the `menubutton` arrow block and the `splitbutton` arrow.none override)
// Reference: refs/libadwaita/tests/test-split-button.c (the upstream suite)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { menuItemAt, normalizeMenuModel } from './menu.js';
import type { AdwMenuInput, AdwMenuItem, AdwMenuModel, AdwMenuPath } from './menu.js';

/**
 * The four mutually exclusive content slots of the action half. `'empty'` is the
 * initial state — `label`, `icon-name` and `child` are all `NULL`.
 */
export type SplitButtonContentMode = 'empty' | 'label' | 'icon' | 'child';

/** `GtkArrowType` as a string union. Default `'down'`. */
export type SplitButtonDirection = 'none' | 'up' | 'down' | 'left' | 'right';

/**
 * Every symbolic icon an `arrow` node can be given `-gtk-icon-source` for. A union rather
 * than `string` so a renderer's glyph→asset table is TOTAL: an Adwaita release that adds a
 * sixth glyph breaks the renderers at COMPILE time instead of painting a blank arrow at
 * runtime.
 */
export type AdwArrowIcon =
    | 'open-menu-symbolic'
    | 'pan-down-symbolic'
    | 'pan-up-symbolic'
    | 'pan-start-symbolic'
    | 'pan-end-symbolic';

/** A root style class `update_style_classes` puts on the `splitbutton` node. */
export type SplitButtonStyleClass = 'image-button' | 'text-button';

/**
 * The GObject property names this widget notifies, carried in
 * {@link SplitButtonChange.notified} so a renderer can re-emit `notify::*` with the same
 * sequence the upstream suite asserts: one mutation emits SEVERAL notifications inside a
 * single freeze/thaw, and that sequence cannot be reconstructed from the final state alone.
 */
export type SplitButtonProperty =
    | 'label'
    | 'icon-name'
    | 'child'
    | 'use-underline'
    | 'menu-model'
    | 'popover'
    | 'direction'
    | 'dropdown-tooltip';

/** Payload of a {@link SplitButtonState} notification. */
export interface SplitButtonChange {
    /** Which content slot is filled. */
    mode: SplitButtonContentMode;
    /** The label, or `null` unless {@link mode} is `'label'`. */
    label: string | null;
    /** The icon name, or `null` unless {@link mode} is `'icon'`. */
    iconName: string | null;
    /** The child widget — the app's in `'child'` mode, an opaque internal node in `'label'`/`'icon'` mode. */
    child: object | null;
    /** The root style classes after this change. */
    styleClasses: readonly SplitButtonStyleClass[];
    /** Whether the dropdown half is live (a menu model or a popover is set). */
    dropdownEnabled: boolean;
    /** Whether the menu is popped up. */
    open: boolean;
    /** The `notify::*` properties C emits for this one mutation, in emission order. */
    notified: readonly SplitButtonProperty[];
    /** True for a user gesture ({@link SplitButtonState.toggleMenu} / {@link SplitButtonState.activateMenuItem}). */
    interactive: boolean;
}

/** Subscriber for {@link SplitButtonState} changes. */
export type SplitButtonListener = (change: SplitButtonChange) => void;

/** The GTK state flags of one half of the control, as booleans. */
export interface SplitButtonHalfState {
    /** `GTK_STATE_FLAG_ACTIVE` — the half is pressed. */
    active: boolean;
    /** `GTK_STATE_FLAG_CHECKED` — for the arrow half, the menu is open. */
    checked: boolean;
    /** The `keyboard-activating` CSS class GTK sets during a keyboard press. */
    keyboardActivating: boolean;
}

/** The translatable default dropdown tooltip. */
export const DEFAULT_DROPDOWN_TOOLTIP = 'More Options';

/** Adwaita's `--disabled-opacity`, for renderers that dim rather than desaturate. */
export const SPLIT_BUTTON_DISABLED_OPACITY = 0.5;

/**
 * Direction → arrow glyph for a PLAIN `menubutton`, from the `arrow` block inside the
 * top-level `menubutton { … }` rule. `none` is the "no particular direction" arrow, which
 * GTK documents as the generic app-menu glyph — a hamburger, not a caret.
 */
const MENU_BUTTON_ARROW_ICONS: Readonly<Record<SplitButtonDirection, AdwArrowIcon>> = {
    none: 'open-menu-symbolic',
    down: 'pan-down-symbolic',
    up: 'pan-up-symbolic',
    left: 'pan-start-symbolic',
    right: 'pan-end-symbolic',
};

/**
 * The same table as it applies INSIDE a split button, where `none` is NOT the hamburger.
 * The dropdown half is a real `GtkMenuButton` and inherits all five rules, but the
 * stylesheet's `splitbutton > menubutton > button > arrow.none` rule outweighs the
 * two-element `menubutton arrow.none`, so direction `none` draws the DOWN caret — the same
 * glyph as `down`, which is also how it PLACES the popup.
 *
 * The spread IS the cascade: only `.none` is overridden, so an upstream change to any
 * other direction lands in both tables at once and cannot drift between them.
 */
const SPLIT_BUTTON_ARROW_ICONS: Readonly<Record<SplitButtonDirection, AdwArrowIcon>> = {
    ...MENU_BUTTON_ARROW_ICONS,
    none: 'pan-down-symbolic',
};

/** The five `GtkArrowType` values, for validating an attribute string. */
const DIRECTIONS: readonly SplitButtonDirection[] = ['none', 'up', 'down', 'left', 'right'];

/**
 * `update_style_classes` as a pure function. Both branches test the FIRST CHARACTER, not
 * truthiness: `''` is a perfectly good label — non-`NULL`, so `get_label()` returns it and
 * `get_icon_name()` is `NULL` — yet `label[0]` is NUL, so it carries no `text-button`
 * class. `' '` does carry it and renders two spaces; nothing in the C path trims.
 */
export function splitButtonStyleClasses(
    label: string | null,
    iconName: string | null,
): readonly SplitButtonStyleClass[] {
    const classes: SplitButtonStyleClass[] = [];
    // `if (icon_name && icon_name[0])` — then the label branch, in that order.
    if (iconName !== null && iconName.length > 0) classes.push('image-button');
    if (label !== null && label.length > 0) classes.push('text-button');
    return classes;
}

/**
 * The dropdown tooltip to actually show, and whether it is markup.
 * `has_dropdown_tooltip = tooltip && *tooltip` — a non-empty value goes through
 * `gtk_widget_set_tooltip_markup` (Pango markup), an empty one restores the translated
 * default as plain TEXT. Not cosmetic: a renderer that escapes the markup branch, or
 * leaves the accessible name empty on the default branch, is a different widget.
 */
export function resolveDropdownTooltip(tooltip: string): { text: string; markup: boolean } {
    return typeof tooltip === 'string' && tooltip.length > 0
        ? { text: tooltip, markup: true }
        : { text: DEFAULT_DROPDOWN_TOOLTIP, markup: false };
}

/**
 * The arrow glyph a PLAIN `menubutton` draws for a direction — `none` is the
 * `open-menu-symbolic` hamburger. Use {@link splitButtonArrowIcon} for the dropdown half
 * of a split button, which the stylesheet gives a different `none`.
 */
export function menuButtonArrowIcon(direction: SplitButtonDirection): AdwArrowIcon {
    return MENU_BUTTON_ARROW_ICONS[direction] ?? MENU_BUTTON_ARROW_ICONS.down;
}

/**
 * The arrow glyph a SPLIT BUTTON's dropdown half draws — `none` is `pan-down-symbolic`,
 * per the stylesheet's `splitbutton` override.
 */
export function splitButtonArrowIcon(direction: SplitButtonDirection): AdwArrowIcon {
    return SPLIT_BUTTON_ARROW_ICONS[direction] ?? SPLIT_BUTTON_ARROW_ICONS.down;
}

/**
 * Where the popup is placed: `'none'` behaves the same as `'down'`. Placement is NOT a
 * split-button rule, unlike the glyph: `adw_split_button_set_direction` is a pass-through
 * to `gtk_menu_button_set_direction` and the getter reads it straight back off the same
 * `GtkMenuButton`, so `none → down` is `GtkMenuButton`'s own behaviour and
 * {@link menuButtonPopupDirection} is this very function rather than a copy.
 */
export function splitButtonPopupDirection(direction: SplitButtonDirection): Exclude<SplitButtonDirection, 'none'> {
    return direction === 'none' || !DIRECTIONS.includes(direction) ? 'down' : direction;
}

/**
 * Where a plain `menubutton` places its popup — deliberately an ALIAS of
 * {@link splitButtonPopupDirection}, so that the "placement has no per-widget override"
 * claim is reference equality a test can hold rather than a comment.
 */
export const menuButtonPopupDirection = splitButtonPopupDirection;

/** Whether `value` names a `GtkArrowType`, for parsing a renderer attribute. */
export function isSplitButtonDirection(value: unknown): value is SplitButtonDirection {
    return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value);
}

/**
 * `update_state` as a pure fold. The two halves are separate widgets, but the state the
 * STYLESHEET keys off sits on the root: `splitbutton.flat:checked` shades the whole control
 * and hides the separator while the menu is open.
 */
export function splitButtonRootState(
    action: SplitButtonHalfState,
    dropdown: SplitButtonHalfState,
): { active: boolean; checked: boolean } {
    return {
        active: action.active || dropdown.active || action.keyboardActivating || dropdown.keyboardActivating,
        checked: action.checked || dropdown.checked,
    };
}

/**
 * A normalised model's canonical text, for the value-equality guard in
 * {@link SplitButtonState.setMenuModel}.
 *
 * `JSON.stringify` is canonical HERE and would not be on arbitrary input:
 * `normalizeMenuModel` writes every node's keys in one fixed order, so two models that
 * are equal produce the same bytes. That is a property of the normaliser, which is why
 * this function takes a normalised model and nothing else.
 */
const menuKey = (model: AdwMenuModel | null): string => (model === null ? '' : JSON.stringify(model));

/**
 * Stand-in for the content widget `GtkButton` builds for a label or an icon.
 * `adw_split_button_get_child()` is `gtk_button_get_child()`, which returns that INTERNAL
 * widget in label/icon mode, and the upstream suite relies on it: `set_label()` after
 * `set_child` notifies `child` precisely because the getter is non-`NULL`.
 */
function internalContent(kind: 'label' | 'icon'): object {
    return Object.freeze({ adwInternalContent: kind });
}

/**
 * Stand-in for the popover `gtk_menu_button_set_menu_model` builds from a model with
 * `gtk_popover_menu_new_from_model`. The upstream suite asserts only that it is NOT the
 * popover the caller last set — its identity is an implementation detail.
 */
function derivedPopover(): object {
    return Object.freeze({ adwDerivedPopover: true });
}

/**
 * The whole `Adw.SplitButton` state machine: content mode, use-underline,
 * menu-model/popover exclusivity, direction, dropdown tooltip and the popup flag. Every
 * mutator returns whether it changed anything and notifies only on a real change, like
 * `ComboState`/`SpinState`, plus {@link SplitButtonChange.notified}: an ORDERED property
 * list, because a single `set_label()` can emit `notify::icon-name`, `notify::child` and
 * `notify::label` in that order and the upstream suite counts them.
 */
export class SplitButtonState {
    private _mode: SplitButtonContentMode = 'empty';
    private _label: string | null = null;
    private _iconName: string | null = null;
    private _child: object | null = null;
    private _useUnderline = false;
    private _menuModel: AdwMenuModel | null = null;
    private _popover: object | null = null;
    private _direction: SplitButtonDirection = 'down';
    private _dropdownTooltip = '';
    private _open = false;
    private readonly _listeners = new Set<SplitButtonListener>();

    /** Subscribe to state changes. Returns an unsubscribe function. */
    subscribe(listener: SplitButtonListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private _emit(notified: readonly SplitButtonProperty[], interactive: boolean): void {
        const change: SplitButtonChange = {
            mode: this._mode,
            label: this._label,
            iconName: this._iconName,
            child: this._child,
            styleClasses: this.styleClasses,
            dropdownEnabled: this.dropdownEnabled,
            open: this._open,
            notified,
            interactive,
        };
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._listeners]) listener(change);
    }

    // --- Content: label / icon-name / child are mutually exclusive ---

    /** Which content slot is filled. */
    get mode(): SplitButtonContentMode {
        return this._mode;
    }

    /** The label, or `null` unless {@link mode} is `'label'`. */
    get label(): string | null {
        return this._label;
    }

    /**
     * Set the label, clearing `icon-name` and `child`. A non-string is rejected outright,
     * mirroring `g_return_if_fail (label != NULL)` — there is no "unset the label" path in
     * C, clearing it is a side effect of setting another slot.
     */
    setLabel(label: string): boolean {
        if (typeof label !== 'string') return false;
        // `g_strcmp0 (label, get_label)` — never equal while a NULL label is stored.
        if (label === this._label) return false;

        const notified: SplitButtonProperty[] = [];
        // C tests the PRE-state pointers, so a label→label change still notifies
        // `child`: the internal GtkLabel is non-NULL even though it is reused.
        if (this._iconName !== null) notified.push('icon-name');
        if (this._child !== null) notified.push('child');

        this._child = this._mode === 'label' ? this._child : internalContent('label');
        this._mode = 'label';
        this._label = label;
        this._iconName = null;
        notified.push('label');
        this._emit(notified, false);
        return true;
    }

    /** The icon name, or `null` unless {@link mode} is `'icon'`. */
    get iconName(): string | null {
        return this._iconName;
    }

    /**
     * Set the icon name, clearing `label` and `child`. A non-string is rejected —
     * `g_return_if_fail (icon_name != NULL)`.
     */
    setIconName(iconName: string): boolean {
        if (typeof iconName !== 'string') return false;
        if (iconName === this._iconName) return false;

        const notified: SplitButtonProperty[] = [];
        if (this._label !== null) notified.push('label');
        if (this._child !== null) notified.push('child');

        this._child = this._mode === 'icon' ? this._child : internalContent('icon');
        this._mode = 'icon';
        this._iconName = iconName;
        this._label = null;
        notified.push('icon-name');
        this._emit(notified, false);
        return true;
    }

    /**
     * The child widget: the app's own in `'child'` mode, the opaque internal
     * content node in `'label'`/`'icon'` mode, `null` when empty.
     */
    get child(): object | null {
        return this._child;
    }

    /**
     * Set (or clear, with `null`) the child, clearing `label` and `icon-name`. The only way
     * back to `'empty'` from a filled slot, and how a renderer expresses "no content" —
     * `setChild(null)` on a fresh state is correctly a no-op.
     */
    setChild(child: object | null | undefined): boolean {
        const next = child ?? null;
        // `if (child == adw_split_button_get_child (self)) return;` — pointer equality.
        if (next === this._child) return false;

        const notified: SplitButtonProperty[] = [];
        if (this._label !== null) notified.push('label');
        if (this._iconName !== null) notified.push('icon-name');

        this._mode = next === null ? 'empty' : 'child';
        this._child = next;
        this._label = null;
        this._iconName = null;
        notified.push('child');
        this._emit(notified, false);
        return true;
    }

    /** The root style classes for the current content. */
    get styleClasses(): readonly SplitButtonStyleClass[] {
        return splitButtonStyleClasses(this._label, this._iconName);
    }

    /** Whether an underline in the label marks a mnemonic. */
    get useUnderline(): boolean {
        return this._useUnderline;
    }

    /**
     * Set the mnemonic flag, `!!`-normalised as C does, so a truthy non-boolean stores
     * `true` and a following `setUseUnderline(true)` is correctly a no-op. Only the
     * PROPERTY lives here; the `_S` → underlined-S derivation belongs to `GtkLabel`.
     */
    setUseUnderline(value: boolean): boolean {
        const next = !!value;
        if (next === this._useUnderline) return false;
        this._useUnderline = next;
        this._emit(['use-underline'], false);
        return true;
    }

    // --- Menu model ⟷ popover (each clears the other) ---

    /** The menu model, or `null` when none is set. Always normalised (ADR 0042). */
    get menuModel(): AdwMenuModel | null {
        return this._menuModel;
    }

    /**
     * Set the menu model, dissociating any popover and replacing it with the model-derived
     * one.
     *
     * NORMALISES AT THE DOOR, so every surface stores the same shape whatever it was
     * handed — a JSON attribute, a bare `string[]`, a JSX array of descriptors. It is
     * {@link normalizeMenuModel}'s idempotence that makes `setMenuModel(state.menuModel)`
     * a no-op rather than a quiet flattening.
     *
     * DELIBERATE NORMALISATION: an EMPTY list is stored as "no menu model". C can hold a
     * non-`NULL` but empty `GMenu`, which leaves the dropdown live and pops up an empty
     * popover; collapsing the two is what makes "no menu ⇒ insensitive dropdown" hold
     * from a renderer's point of view. A model that is non-empty but draws nothing — one
     * empty section — is NOT collapsed: it has a node, so it is a menu, which is the
     * answer GTK gives for the same `GMenu`.
     */
    setMenuModel(input: AdwMenuInput | null | undefined): boolean {
        const normalized = normalizeMenuModel(input);
        const next = normalized.length > 0 ? normalized : null;
        // C's guard is `menu_model == get_menu_model` — POINTER equality, which a value
        // has no analogue for: every call here arrives with a fresh array (a JSON parse,
        // an array literal in a template, a `.map()`), so a reference guard would never
        // fire and the widget would notify `menu-model` on every render pass. VALUE
        // equality is the analogue, and it keeps this class's own invariant that a
        // mutator notifies only on a real change.
        if (menuKey(next) === menuKey(this._menuModel)) return false;

        const popover = next === null ? null : derivedPopover();
        const notified: SplitButtonProperty[] = [];
        if (popover !== this._popover) notified.push('popover');
        notified.push('menu-model');

        this._menuModel = next;
        this._popover = popover;
        if (!this.dropdownEnabled) this._open = false;
        this._emit(notified, false);
        return true;
    }

    /** The popover: the one the app set, or the model-derived stand-in, or `null`. */
    get popover(): object | null {
        return this._popover;
    }

    /**
     * Set the popover, dissociating any menu model. The cleared property is notified before
     * the set one, the order `set_label()`/`set_icon_name`/`set_child` use throughout this
     * widget; GtkMenuButton's own internal ordering is not observable from the upstream
     * suite, which only counts per-property notifications.
     */
    setPopover(popover: object | null | undefined): boolean {
        const next = popover ?? null;
        if (next === this._popover) return false;

        const notified: SplitButtonProperty[] = [];
        if (this._menuModel !== null) notified.push('menu-model');
        notified.push('popover');

        this._menuModel = null;
        this._popover = next;
        if (!this.dropdownEnabled) this._open = false;
        this._emit(notified, false);
        return true;
    }

    /**
     * Whether the dropdown half is live: with neither a menu model nor a popover,
     * GtkMenuButton is insensitive.
     */
    get dropdownEnabled(): boolean {
        return this._menuModel !== null || this._popover !== null;
    }

    /** The direction the popup opens in, and the arrow points. */
    get direction(): SplitButtonDirection {
        return this._direction;
    }

    /** Set the direction. An unknown value is rejected. */
    setDirection(direction: SplitButtonDirection): boolean {
        if (!isSplitButtonDirection(direction)) return false;
        if (direction === this._direction) return false;
        this._direction = direction;
        this._emit(['direction'], false);
        return true;
    }

    /** The arrow glyph for the current direction, with the split button's `none`. */
    get arrowIcon(): AdwArrowIcon {
        return splitButtonArrowIcon(this._direction);
    }

    /**
     * The dropdown tooltip as SET — `''` while unset, never `null`. Pass it through
     * {@link resolveDropdownTooltip} to get what should actually be shown.
     */
    get dropdownTooltip(): string {
        return this._dropdownTooltip;
    }

    /**
     * Set the dropdown tooltip. C's guard compares against the GETTER, which already reports
     * `''` when unset, so clearing an unset tooltip notifies nothing while clearing a set
     * one notifies and RESTORES the default rather than blanking the tooltip.
     */
    setDropdownTooltip(tooltip: string): boolean {
        // `g_return_if_fail (tooltip != NULL)`.
        if (typeof tooltip !== 'string') return false;
        if (tooltip === this._dropdownTooltip) return false;
        this._dropdownTooltip = tooltip;
        this._emit(['dropdown-tooltip'], false);
        return true;
    }

    /** Whether the menu is popped up. */
    get open(): boolean {
        return this._open;
    }

    private _setOpen(open: boolean, interactive: boolean): boolean {
        // An insensitive dropdown has nothing to pop up.
        if (open && !this.dropdownEnabled) return false;
        if (open === this._open) return false;
        this._open = open;
        this._emit([], interactive);
        return true;
    }

    /** Pop the menu up programmatically — `adw_split_button_popup`. */
    openMenu(): boolean {
        return this._setOpen(true, false);
    }

    /** Dismiss the menu programmatically — `adw_split_button_popdown`. */
    closeMenu(): boolean {
        return this._setOpen(false, false);
    }

    /** The dropdown half was activated by the user; flips the menu open/closed. */
    toggleMenu(): boolean {
        return this._setOpen(!this._open, true);
    }

    /**
     * Activate a menu item BY POSITION and dismiss the menu, returning the item
     * (or `null` for a path that names no item).
     *
     * Position is the addressing a `GMenuModel` actually uses — each item carries its own
     * detailed action. Resolving a choice by LABEL instead silently dispatches the first of
     * two identically named entries and cannot tell an entry called `Cancel` from a
     * dismissed sheet.
     *
     * A PATH rather than a single index (ADR 0042), because a link is a model of its own:
     * `[1, 0]` is the first item of the submenu at position 1, and a flat index cannot
     * name it. A top-level choice is `[2]`.
     */
    activateMenuItem(path: AdwMenuPath): AdwMenuItem | null {
        if (this._menuModel === null) return null;
        const item = menuItemAt(this._menuModel, path);
        if (item === null) return null;
        this._setOpen(false, true);
        return item;
    }
}
