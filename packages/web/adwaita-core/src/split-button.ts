// Adwaita split-button behaviour — headless.
//
// `Adw.SplitButton` is a combined button + dropdown, and almost everything about
// it that is NOT pixels is a small state machine both renderers were getting
// wrong in different ways. Lifted here (ADR 0004) so there is one answer:
//
//   1. a four-slot content machine — `empty | label | icon | child` — where
//      setting one slot clears the other two, with C's idempotence guards and
//      its exact `notify::*` EMISSION ORDER (cleared properties first, then the
//      one being set, inside one freeze/thaw);
//   2. two derived root style classes keyed off the FIRST CHARACTER of the
//      string rather than truthiness: `image-button` iff `icon_name[0]`,
//      `text-button` iff `label[0]`;
//   3. the dropdown-tooltip fallback, with the markup/plain-text distinction —
//      a non-empty value is Pango markup, an empty one restores the translated
//      `More Options` default;
//   4. menu-model ⟷ popover exclusivity and the derived `dropdownEnabled`, which
//      is what makes a menu-less split button's dropdown INSENSITIVE;
//   5. the direction → arrow-glyph map, in the TWO variants the stylesheet has:
//      a plain `menubutton` draws `open-menu-symbolic` for `none`, a split button
//      draws `pan-down-symbolic`, because `splitbutton` OVERRIDES `arrow.none`;
//   6. the root-state OR-fold: the whole control reads ACTIVE if either half is
//      pressed or keyboard-activating, CHECKED if either half is checked (the
//      arrow half is checked while the menu is open).
//
// Before this module `@gjsify/adwaita-web` rendered the label AND the icon at
// once, `@gjsify/adwaita-nativescript` hid the label view but kept the stale
// label VALUE, neither implemented (3), (4), (5) or (6), and the NS port
// resolved a menu choice with `indexOf` on the label — so two entries called
// `Copy` always dispatched the first, and an entry called `Cancel` was
// indistinguishable from dismissing the sheet. The vectors in
// `conformance/split-button.ts` are what hold both renderers to this file.
//
// PLATFORM-NEUTRAL: renders nothing, imports nothing, touches no global. The
// per-instance `subscribe` seam matches `ComboState`/`SpinState` in `rows.ts`;
// every mutator returns whether it changed and notifies only on a real change.
//
// Reference: refs/libadwaita/src/adw-split-button.c (AdwSplitButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
//            (menubutton arrow :451-469 — and the splitbutton override at :621-623)
// Reference: refs/libadwaita/tests/test-split-button.c (the upstream suite)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/**
 * The four mutually exclusive content slots of the action half. `'empty'` is the
 * initial state — `label`, `icon-name` and `child` are all `NULL`
 * (adw-split-button.c:311-352).
 */
export type SplitButtonContentMode = 'empty' | 'label' | 'icon' | 'child';

/** `GtkArrowType` as a string union. Default `'down'` (adw-split-button.c:420). */
export type SplitButtonDirection = 'none' | 'up' | 'down' | 'left' | 'right';

/**
 * Every symbolic icon an `arrow` node can be given `-gtk-icon-source` for
 * (_buttons.scss:451-469 plus the `splitbutton` override at :621-623).
 *
 * A union rather than `string` so a renderer's glyph→asset table is TOTAL: an
 * `Adwaita` release that introduces a sixth glyph breaks the renderers at COMPILE
 * time instead of painting a blank arrow at runtime.
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
 * The GObject property names this widget notifies.
 *
 * Carried in {@link SplitButtonChange.notified} so a renderer can re-emit
 * `notify::*` with the same sequence the upstream suite asserts: one mutation
 * emits SEVERAL notifications inside a single freeze/thaw
 * (adw-split-button.c:671-681), and that sequence cannot be reconstructed from
 * the final state alone.
 *
 * `can-shrink` is deliberately absent — see the module note on deferred scope.
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

/**
 * One `GMenuModel` item: a label plus the detailed action it invokes, i.e. what
 * `Gio.Menu.append (label, action)` produces (adw-split-button.c:385-388).
 *
 * `id` and `icon` are the existing menu-button extras from the two renderers, so
 * all four menu call sites in the workspace can converge on ONE type. The name
 * is family-neutral on purpose: `Adw.MenuButton` needs exactly this and must be
 * able to adopt it without a rename.
 */
export interface AdwMenuEntry {
    /** Display label. */
    label: string;
    /** Detailed action name, e.g. `app.save-as`. */
    action?: string;
    /** Stable identifier, defaulting to {@link label} on activation. */
    id?: string;
    /** Symbolic icon name for the item. */
    icon?: string;
}

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
    /** True for a user gesture ({@link SplitButtonState.toggleMenu} / {@link SplitButtonState.activateMenuEntry}). */
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

/** The translatable default dropdown tooltip (adw-split-button.c:531-532, :1049-1050). */
export const DEFAULT_DROPDOWN_TOOLTIP = 'More Options';

/** Adwaita's `--disabled-opacity`, for renderers that dim rather than desaturate. */
export const SPLIT_BUTTON_DISABLED_OPACITY = 0.5;

/**
 * Direction → arrow glyph for a PLAIN `menubutton`, from the `arrow` block inside
 * the top-level `menubutton { … }` rule: `.none` at _buttons.scss:454-456,
 * `.down` :457-459, `.up` :460-462, `.left` :463-465, `.right` :466-468.
 *
 * `none` is the "no particular direction" arrow, and GTK documents it as the
 * generic app-menu glyph — a hamburger, not a caret.
 */
const MENU_BUTTON_ARROW_ICONS: Readonly<Record<SplitButtonDirection, AdwArrowIcon>> = {
    none: 'open-menu-symbolic',
    down: 'pan-down-symbolic',
    up: 'pan-up-symbolic',
    left: 'pan-start-symbolic',
    right: 'pan-end-symbolic',
};

/**
 * The same table as it applies INSIDE a split button, where `none` is NOT the
 * hamburger.
 *
 * The dropdown half is a real `GtkMenuButton`, so it inherits all five rules
 * above — but the stylesheet overrides one of them 167 lines further down, inside
 * the `splitbutton { … }` block (_buttons.scss:621-623):
 *
 *     splitbutton > menubutton > button > arrow.none {
 *       -gtk-icon-source: -gtk-icontheme('pan-down-symbolic');
 *     }
 *
 * Four element selectors plus a class beat the two-element `menubutton arrow.none`
 * at :454-456, so a split button with direction `none` draws the DOWN caret — the
 * same glyph as `down`, which is also how it PLACES the popup.
 *
 * The spread IS the cascade: only `.none` is overridden, so an upstream change to
 * any other direction lands in both tables at once and cannot drift between them.
 */
const SPLIT_BUTTON_ARROW_ICONS: Readonly<Record<SplitButtonDirection, AdwArrowIcon>> = {
    ...MENU_BUTTON_ARROW_ICONS,
    none: 'pan-down-symbolic',
};

/** The five `GtkArrowType` values, for validating an attribute string. */
const DIRECTIONS: readonly SplitButtonDirection[] = ['none', 'up', 'down', 'left', 'right'];

/**
 * `update_style_classes` as a pure function (adw-split-button.c:145-165).
 *
 * Both branches test the FIRST CHARACTER, not truthiness of the value: `''` is a
 * perfectly good label — non-`NULL`, so `get_label()` returns it and
 * `get_icon_name()` is `NULL` — yet `label[0]` is NUL, so it carries no
 * `text-button` class. `'  '` does carry it, and renders two spaces: nothing in
 * the C path trims.
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
 * The dropdown tooltip to actually show, and whether it is markup
 * (adw-split-button.c:1044-1051).
 *
 * `has_dropdown_tooltip = tooltip && *tooltip` — a non-empty value goes through
 * `gtk_widget_set_tooltip_markup` (Pango markup), an empty one restores the
 * translated default as plain TEXT. The distinction is not cosmetic: a renderer
 * that escapes the markup branch, or that leaves the accessible name empty on
 * the default branch, is a different widget.
 */
export function resolveDropdownTooltip(tooltip: string): { text: string; markup: boolean } {
    return typeof tooltip === 'string' && tooltip.length > 0
        ? { text: tooltip, markup: true }
        : { text: DEFAULT_DROPDOWN_TOOLTIP, markup: false };
}

/**
 * The arrow glyph a PLAIN `menubutton` draws for a direction — `none` is the
 * `open-menu-symbolic` hamburger (_buttons.scss:454-456).
 *
 * Use {@link splitButtonArrowIcon} for the dropdown half of a split button, which
 * the stylesheet gives a different `none`.
 */
export function menuButtonArrowIcon(direction: SplitButtonDirection): AdwArrowIcon {
    return MENU_BUTTON_ARROW_ICONS[direction] ?? MENU_BUTTON_ARROW_ICONS.down;
}

/**
 * The arrow glyph a SPLIT BUTTON's dropdown half draws for a direction — `none`
 * is `pan-down-symbolic`, per the `splitbutton` override at _buttons.scss:621-623.
 */
export function splitButtonArrowIcon(direction: SplitButtonDirection): AdwArrowIcon {
    return SPLIT_BUTTON_ARROW_ICONS[direction] ?? SPLIT_BUTTON_ARROW_ICONS.down;
}

/**
 * Where the popup is placed: `'none'` behaves the same as `'down'`
 * (adw-split-button.c:415).
 *
 * PLACEMENT IS NOT A SPLIT-BUTTON RULE, unlike the glyph. `adw_split_button_set_direction`
 * is a pass-through to `gtk_menu_button_set_direction` (:997) and the getter reads
 * it straight back off the same `GtkMenuButton` (:971) — the split button stores
 * nothing and overrides nothing here, so `none → down` is `GtkMenuButton`'s own
 * behaviour. {@link menuButtonPopupDirection} is therefore this very function
 * rather than a second copy of it.
 */
export function splitButtonPopupDirection(direction: SplitButtonDirection): Exclude<SplitButtonDirection, 'none'> {
    return direction === 'none' || !DIRECTIONS.includes(direction) ? 'down' : direction;
}

/**
 * Where a plain `menubutton` places its popup — deliberately an ALIAS of
 * {@link splitButtonPopupDirection}, not a copy.
 *
 * The two arrow-glyph functions differ because the stylesheet overrides the glyph
 * per widget; placement has no such override, and pinning that as reference
 * equality (`menuButtonPopupDirection === splitButtonPopupDirection`) is a claim a
 * test can hold, where a duplicated body would only be a claim a comment makes.
 */
export const menuButtonPopupDirection = splitButtonPopupDirection;

/** Whether `value` names a `GtkArrowType`, for parsing a renderer attribute. */
export function isSplitButtonDirection(value: unknown): value is SplitButtonDirection {
    return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value);
}

/**
 * `update_state` as a pure fold (adw-split-button.c:118-143).
 *
 * The two halves are separate widgets, but the state the STYLESHEET keys off
 * sits on the root: `splitbutton.flat:checked` shades the whole control and
 * hides the separator while the menu is open (_buttons.scss:542-549). Neither
 * renderer folded it, so both showed a per-half highlight only.
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
 * Parse a JSON menu attribute into entries.
 *
 * Total by construction — malformed JSON, a non-array root and entries without a
 * `label` key all yield `[]` / are dropped — because the input is author-written
 * markup and a typo must not take the widget down with it. Replaces the two
 * byte-identical copies in `adw-split-button.ts` and `adw-menu-button.ts`.
 */
export function parseMenuEntries(json: string | null | undefined): AdwMenuEntry[] {
    if (!json) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        // JSON.parse genuinely throws on malformed author input; the widget must
        // degrade to "no menu" rather than fail to upgrade.
        return [];
    }
    if (!Array.isArray(parsed)) return [];

    const entries: AdwMenuEntry[] = [];
    for (const raw of parsed) {
        if (typeof raw !== 'object' || raw === null || !('label' in raw)) continue;
        const record = raw as Record<string, unknown>;
        const entry: AdwMenuEntry = { label: String(record.label) };
        // Only string-typed extras survive: a numeric `action` in the JSON would
        // otherwise leak a non-string into a field typed as one.
        if (typeof record.action === 'string') entry.action = record.action;
        if (typeof record.id === 'string') entry.id = record.id;
        if (typeof record.icon === 'string') entry.icon = record.icon;
        entries.push(entry);
    }
    return entries;
}

/**
 * Stand-in for the content widget `GtkButton` builds for a label or an icon.
 *
 * `adw_split_button_get_child()` is `gtk_button_get_child()`, which returns that
 * INTERNAL widget in label/icon mode — the upstream suite says so in as many
 * words (tests/test-split-button.c:155-157) and relies on it: `set_label` after
 * `set_child` notifies `child` precisely because the getter is non-`NULL`. A
 * fresh node per mode entry mirrors GTK reusing its `GtkLabel`/`GtkImage` while
 * the child TYPE does not change.
 */
function internalContent(kind: 'label' | 'icon'): object {
    return Object.freeze({ adwInternalContent: kind });
}

/**
 * Stand-in for the popover `gtk_menu_button_set_menu_model` builds from a model
 * with `gtk_popover_menu_new_from_model` (adw-split-button.c:378-381). The
 * upstream suite asserts only that it is NOT the popover the caller last set
 * (tests/test-split-button.c:236-238) — its identity is an implementation detail.
 */
function derivedPopover(): object {
    return Object.freeze({ adwDerivedPopover: true });
}

/**
 * The whole `Adw.SplitButton` state machine: content mode, use-underline,
 * menu-model/popover exclusivity, direction, dropdown tooltip and the popup flag.
 *
 * Every mutator returns whether it changed anything and notifies only on a real
 * change, like `ComboState`/`SpinState`. What this class adds over those is
 * {@link SplitButtonChange.notified}: an ORDERED property list, because a single
 * `set_label()` can emit `notify::icon-name`, `notify::child` and `notify::label`
 * in that order and the upstream suite counts them.
 */
export class SplitButtonState {
    private _mode: SplitButtonContentMode = 'empty';
    private _label: string | null = null;
    private _iconName: string | null = null;
    private _child: object | null = null;
    private _useUnderline = false;
    private _menuModel: readonly AdwMenuEntry[] | null = null;
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
     * Set the label, clearing `icon-name` and `child`
     * (adw-split-button.c:661-682).
     *
     * A non-string is rejected outright and changes nothing, mirroring
     * `g_return_if_fail (label != NULL)` at :666 — there is no "unset the label"
     * path in C, clearing it is a side effect of setting another slot.
     */
    setLabel(label: string): boolean {
        if (typeof label !== 'string') return false;
        // `g_strcmp0 (label, get_label ())` — never equal while a NULL label is stored.
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
     * Set the icon name, clearing `label` and `child`
     * (adw-split-button.c:749-771). A non-string is rejected — `g_return_if_fail
     * (icon_name != NULL)` at :754.
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
     * Set (or clear, with `null`) the child, clearing `label` and `icon-name`
     * (adw-split-button.c:799-824).
     *
     * This is also the only way to reach `'empty'` again from a filled slot, and
     * it is how a renderer expresses "no content" — `setChild(null)` on a fresh
     * state is correctly a no-op (:806-807).
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

    // --- Mnemonics ---

    /** Whether an underline in the label marks a mnemonic. */
    get useUnderline(): boolean {
        return this._useUnderline;
    }

    /**
     * Set the mnemonic flag (adw-split-button.c:709-721). `!!`-normalised at :715,
     * so a truthy non-boolean stores `true` and a following `setUseUnderline(true)`
     * is correctly a no-op.
     *
     * Only the PROPERTY lives here. The `_S` → underlined-S derivation belongs to
     * `GtkLabel`, not to this widget or its test — see the module note on
     * deferred scope.
     */
    setUseUnderline(value: boolean): boolean {
        const next = !!value;
        if (next === this._useUnderline) return false;
        this._useUnderline = next;
        this._emit(['use-underline'], false);
        return true;
    }

    // --- Menu model ⟷ popover (each clears the other) ---

    /** The menu entries, or `null` when no menu model is set. */
    get menuModel(): readonly AdwMenuEntry[] | null {
        return this._menuModel;
    }

    /**
     * Set the menu model, dissociating any popover (adw-split-button.c:906-916,
     * :397-398) and replacing it with the model-derived one.
     *
     * DELIBERATE NORMALISATION: an EMPTY list is stored as "no menu model". C can
     * hold a non-`NULL` but empty `GMenu`, which leaves the dropdown live and
     * pops up an empty popover — but neither renderer can construct that state
     * (one parses a JSON array, the other takes a label list), so the two cases
     * are the same input here, and collapsing them is what makes "no menu ⇒
     * insensitive dropdown" (:376-378) hold from a renderer's point of view. The
     * `@gjsify/adwaita-web` bug this kills was a click on a menu-less split
     * button opening an empty, fully styled popover.
     */
    setMenuModel(entries: readonly AdwMenuEntry[] | null | undefined): boolean {
        const next = entries && entries.length > 0 ? entries : null;
        // Reference equality, like the `menu_model == get_menu_model ()` guard at :912.
        if (next === this._menuModel) return false;

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
     * Set the popover, dissociating any menu model (adw-split-button.c:946-956,
     * :390-398).
     *
     * The cleared property is notified before the set one, the order
     * `set_label`/`set_icon_name`/`set_child` use throughout this widget
     * (:671-681). GtkMenuButton's own internal ordering is not observable from
     * the upstream suite, which only counts per-property notifications.
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
     * Whether the dropdown half is live. "If the menu model is `NULL`, the
     * dropdown is disabled" (adw-split-button.c:376-378) and the same for the
     * popover (:394-396) — with neither, GtkMenuButton is insensitive.
     */
    get dropdownEnabled(): boolean {
        return this._menuModel !== null || this._popover !== null;
    }

    // --- Direction ---

    /** The direction the popup opens in, and the arrow points. */
    get direction(): SplitButtonDirection {
        return this._direction;
    }

    /** Set the direction (adw-split-button.c:988-1000). An unknown value is rejected. */
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

    // --- Dropdown tooltip ---

    /**
     * The dropdown tooltip as SET — `''` while unset, never `null`
     * (adw-split-button.c:1017-1018). Pass it through
     * {@link resolveDropdownTooltip} to get what should actually be shown.
     */
    get dropdownTooltip(): string {
        return this._dropdownTooltip;
    }

    /**
     * Set the dropdown tooltip (adw-split-button.c:1034-1054). The guard compares
     * against the GETTER (:1041-1042), which already reports `''` when unset — so
     * clearing an unset tooltip notifies nothing, while clearing a set one does
     * notify and RESTORES the default rather than blanking the tooltip.
     */
    setDropdownTooltip(tooltip: string): boolean {
        // `g_return_if_fail (tooltip != NULL)` at :1039.
        if (typeof tooltip !== 'string') return false;
        if (tooltip === this._dropdownTooltip) return false;
        this._dropdownTooltip = tooltip;
        this._emit(['dropdown-tooltip'], false);
        return true;
    }

    // --- Popup ---

    /** Whether the menu is popped up. */
    get open(): boolean {
        return this._open;
    }

    private _setOpen(open: boolean, interactive: boolean): boolean {
        // An insensitive dropdown has nothing to pop up (:376-378).
        if (open && !this.dropdownEnabled) return false;
        if (open === this._open) return false;
        this._open = open;
        this._emit([], interactive);
        return true;
    }

    /** Pop the menu up programmatically — `adw_split_button_popup` (:1062-1068). */
    openMenu(): boolean {
        return this._setOpen(true, false);
    }

    /** Dismiss the menu programmatically — `adw_split_button_popdown` (:1076-1082). */
    closeMenu(): boolean {
        return this._setOpen(false, false);
    }

    /** The dropdown half was activated by the user; flips the menu open/closed. */
    toggleMenu(): boolean {
        return this._setOpen(!this._open, true);
    }

    /**
     * Activate a menu entry BY POSITION and dismiss the menu, returning the entry
     * (or `null` for an out-of-range index).
     *
     * Position is the addressing a `GMenuModel` actually uses — each item carries
     * its own detailed action (adw-split-button.c:385-388). Resolving a choice by
     * LABEL, as the NativeScript port did, silently dispatches the first of two
     * identically named entries and cannot tell an entry called `Cancel` from a
     * dismissed sheet.
     */
    activateMenuEntry(index: number): AdwMenuEntry | null {
        const entries = this._menuModel;
        if (entries === null) return null;
        if (!Number.isInteger(index) || index < 0 || index >= entries.length) return null;
        const entry = entries[index]!;
        this._setOpen(false, true);
        return entry;
    }
}
