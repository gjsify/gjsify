// AdwSplitButton — a Libadwaita-style split button for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (columns `auto, auto`): a tappable
// main action part (an `GtkImage` symbolic OR a text `Label`) linked to a tappable
// dropdown-arrow part (a REAL pan-* / open-menu `GtkImage`, not a `⌄` glyph).
// Mirrors `Adw.SplitButton`: tapping the main part emits `clicked`; tapping the
// arrow opens a `PopupMenu` from {@link AdwSplitButton.menu} and emits
// `menuTapped`.
//
// The BEHAVIOUR — which content slot is filled (label/icon/child are mutually
// exclusive), whether the dropdown is live at all, the arrow direction, the dropdown
// tooltip fallback — is headless in `@gjsify/adwaita-core` (ADR 0004) as
// `SplitButtonState`; this class only renders it.
//
// FIDELITY: a native menu rather than a popover. `Adw.SplitButton` shows an in-app popover;
// the dropdown opens `android.widget.PopupMenu` anchored at the arrow half (ADR 0097 § 2), for
// this widget and `GtkMenuButton` together. What it cannot draw is refused by name
// (`popup-menu.ts`). The two-part linked shape and the symbolic icons are faithful.
//
// Reference: refs/libadwaita/src/adw-split-button.c (AdwSplitButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (.split-button)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, StackLayout, type EventData } from '@nativescript/core';
import { SPLIT_BUTTON_DISABLED_OPACITY, SplitButtonState } from '@gjsify/adwaita-core';
import type { AdwMenuActions, AdwMenuInput, AdwMenuModel, SplitButtonDirection } from '@gjsify/adwaita-core';
import { GtkImage } from './gtk-image.js';
import { attachRowPressFeedback } from './row-press.js';
import { assertPopupMenuAssignable, refuseMenuString } from './popup-menu.js';
import { showMenuPopup } from './popup-menu-view.js';
import { splitButtonArrowSvg } from './split-button.js';
import { buttonContentClassName, buttonContentLabelText } from './button-content.js';
import { xmlBoolean } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { ArrowType } from './gtk-enums.js';
import { withSignals, type GObjectNotify } from './signals.js';

/** Emitted when {@link AdwSplitButton.set_direction} moves the arrow. */
export const NOTIFY_DIRECTION = 'notify::direction';

/** Event name emitted when a dropdown menu item is chosen. */
export const MENU_TAPPED = 'menuTapped';

/** Payload of the {@link MENU_TAPPED} event. */
export interface MenuTappedEventData extends EventData {
    /** The chosen menu item label. */
    item: string;
    /** The chosen item's id, falling back to its label. */
    id: string;
    /**
     * Where the item sits in {@link AdwSplitButton.menuModel} — its `GMenuModel`
     * POSITION, as a PATH since ADR 0042: a submenu is a model of its own, so `[2, 0]`
     * is the first item of the third entry and a flat index cannot name it.
     */
    path: readonly number[];
    /** The chosen item's detailed action name, when the item carried one. */
    action?: string;
}

/**
 * What the content normalizers read off the button. Structural, because `normalize` is handed a
 * bare `object` while the instance may still be constructing (the `ExpanderRowValues` precedent).
 */
interface SplitButtonContent {
    /** Set while one of the two slots clears the other, so the clear is not refused as a null write. */
    _contentGate: boolean;
    label: string | null;
    iconName: string | null;
}

/** Run `clear` with the gate open: the slot being cleared accepts the `null` it would refuse from a caller. */
const clearingSlot = (button: SplitButtonContent, clear: () => void): void => {
    button._contentGate = true;
    try {
        clear();
    } finally {
        button._contentGate = false;
    }
};

export class AdwSplitButton extends withSignals(GridLayout, {
    GTypeName: 'AdwSplitButton',
    // No arguments, as in GJS. `activate` is the keyboard/action path and runs the action half.
    Signals: { clicked: {}, activate: {} },
    Properties: {
        // `adw_split_button_set_label` (adw-split-button.c:662-682): a null is `g_return_if_fail`,
        // so it changes nothing. A new label drops the icon FIRST — the C notifies the slot it
        // clears before its own, and the cross-write is made here so that order holds on both legs.
        label: {
            kind: 'string',
            default: null,
            blurb: 'The label to show in the button',
            normalize: (value, self) => {
                const button = self as SplitButtonContent;
                if (button._contentGate) return null;
                if (value === null || value === undefined) return button.label;
                const next = String(value);
                if (next !== button.label && button.iconName !== null)
                    clearingSlot(button, () => (button.iconName = null));
                return next;
            },
        },
        // `adw_split_button_set_icon_name` (:750-771). `''` reads back `null` and clears the label
        // (GtkButton drops the icon for an empty name); GJS then notifies on EVERY such write,
        // ours only when the held value changes — the one declared remainder.
        'icon-name': {
            kind: 'string',
            default: null,
            blurb: 'The name of the icon used to automatically populate the button',
            normalize: (value, self) => {
                const button = self as SplitButtonContent;
                if (button._contentGate) return null;
                if (value === null || value === undefined) return button.iconName;
                const next = String(value) === '' ? null : String(value);
                if (button.label !== null) clearingSlot(button, () => (button.label = null));
                return next;
            },
        },
        'use-underline': {
            kind: 'boolean',
            default: false,
            blurb: 'Whether an underline in the text indicates a mnemonic',
        },
        'can-shrink': {
            kind: 'boolean',
            default: false,
            blurb: 'Whether the button can be smaller than the natural size of its contents',
        },
        'dropdown-tooltip': { kind: 'string', default: '', blurb: 'The tooltip of the dropdown button' },
    },
}) {
    static readonly GTypeName: string = 'AdwSplitButton';
    static readonly emittedSignals: readonly string[] = [NOTIFY_DIRECTION];

    declare notify: GObjectNotify;

    /** The main button's text, or `null` while an icon fills the action half. */
    declare label: string | null;

    /**
     * The action half's icon — an icon theme NAME or a symbolic SVG source, which `GtkImage`
     * resolves alike. Setting one clears {@link label}; `''` reads back `null`.
     */
    declare iconName: string | null;

    /** Whether an underline in {@link label} marks a mnemonic. */
    declare useUnderline: boolean;

    /**
     * Whether the label can be smaller than its natural size. FIDELITY GAP: GTK ellipsizes, and the
     * NS CSS subset has no ellipsize, so it is held and reflected as a `can-shrink` class only.
     */
    declare canShrink: boolean;

    /**
     * The dropdown tooltip as set — `''` while unset. Resolve it through `resolveDropdownTooltip()`
     * for what should be shown; a PopupMenu has no tooltip surface, so this is carried for parity.
     */
    declare dropdownTooltip: string;

    /** The main action part (column 0). */
    protected readonly _actionPart: StackLayout;
    /** The action label (shown in label mode). */
    protected readonly _actionLabel: Label;
    /** The action symbolic icon (shown in icon mode). */
    protected readonly _actionIcon: GtkImage;
    /** The dropdown-arrow part (column 1). */
    protected readonly _dropdownPart: GridLayout;
    /** The direction arrow. */
    protected readonly _chevron: GtkImage;
    private readonly _state = new SplitButtonState();
    private _actions: AdwMenuActions | null = null;
    /** Which of the two action views is currently parented. */
    private _showingIcon = false;
    /**
     * `GtkWidget:sensitive`, in GTK's polarity and no other.
     *
     * The field was `_disabled` while the property was, and the rename INVERTED the
     * property. Keeping the old polarity inside would have left every reader holding
     * two of them, one negation apart, in a class where a forgotten `!` dims a live
     * button and emits nothing — silently, because NativeScript has no insensitive
     * state to contradict it. One polarity, so there is nothing to forget.
     */
    private _sensitive = true;
    /** See {@link SplitButtonContent._contentGate}. One write's argument, not state. */
    private _contentGate = false;

    constructor(props?: ConstructProps<AdwSplitButton, { direction: number | SplitButtonDirection }>) {
        super();

        this.className = 'adw-split-button';
        this.addColumn(new ItemSpec(1, 'auto'));
        this.addColumn(new ItemSpec(1, 'auto'));
        this.addRow(new ItemSpec(1, 'auto'));

        // Action part: a tappable horizontal box holding a text label OR an icon.
        const actionPart = new StackLayout();
        actionPart.orientation = 'horizontal';
        actionPart.className = 'adw-split-button-action';
        actionPart.horizontalAlignment = 'center';
        GridLayout.setColumn(actionPart, 0);

        const actionLabel = new Label();
        actionLabel.className = 'adw-split-button-label';
        actionLabel.verticalAlignment = 'middle';
        actionPart.addChild(actionLabel);

        const actionIcon = new GtkImage();
        actionIcon.className = `${actionIcon.className} adw-split-button-action-icon`.trim();
        actionIcon.verticalAlignment = 'middle';

        this.addChild(actionPart);
        this._actionPart = actionPart;
        this._actionLabel = actionLabel;
        this._actionIcon = actionIcon;

        // Dropdown part: a tappable cell with a centered arrow icon.
        const dropdownPart = new GridLayout();
        dropdownPart.className = 'adw-split-button-dropdown';
        dropdownPart.addColumn(new ItemSpec(1, 'star'));
        dropdownPart.addRow(new ItemSpec(1, 'star'));
        GridLayout.setColumn(dropdownPart, 1);

        const chevron = new GtkImage();
        chevron.className = `${chevron.className} adw-split-button-chevron`.trim();
        chevron.iconName = splitButtonArrowSvg(this._state.direction);
        chevron.horizontalAlignment = 'center';
        chevron.verticalAlignment = 'middle';
        dropdownPart.addChild(chevron);

        this.addChild(dropdownPart);
        this._dropdownPart = dropdownPart;
        this._chevron = chevron;

        // A tap IS the user's click: one GObject emission, so each handler runs once on both legs.
        actionPart.addEventListener('tap', () => this._click());
        // `activate` runs the action half, whose `clicked` the C re-emits (`activate_cb`).
        this.connect('activate', (self) => self._click());
        dropdownPart.addEventListener('tap', () => {
            this._openMenu();
        });

        // Both halves darken on press, like Adwaita's linked `.split-button`.
        attachRowPressFeedback(actionPart);
        attachRowPressFeedback(dropdownPart);

        // Each property renders from its OWN notify, so an equal write repaints nothing.
        this.connect('notify::label', (self) => self._renderContent());
        this.connect('notify::icon-name', (self) => self._renderContent());
        this.connect('notify::use-underline', (self) => self._renderContent());
        this.connect('notify::can-shrink', (self) => {
            self._actionLabel.className = buttonContentClassName(self._actionLabel.className, self.canShrink);
        });

        this._state.subscribe(() => this._render());
        this._render();

        applyConstructProps(this, props);
    }

    /**
     * Show the dropdown menu at the arrow half and dispatch the choice BY POSITION.
     *
     * Nothing happens without a menu: "if the menu model is `NULL`, the dropdown
     * is disabled" (adw-split-button.c:376-378).
     */
    private _openMenu(): void {
        // A popup is already up, so a second tap must not open a second one.
        if (!this._sensitive || this._state.open || !this._state.dropdownEnabled) return;

        this._state.toggleMenu();
        try {
            showMenuPopup(this._dropdownPart, {
                model: this._state.menuModel ?? [],
                actions: this._actions,
                onActivated: (_item, path) => {
                    const item = this._state.activateMenuItem(path);
                    if (item === null) return;
                    const data: MenuTappedEventData = {
                        eventName: MENU_TAPPED,
                        object: this,
                        item: item.label,
                        id: item.id ?? item.label,
                        path,
                        action: item.action,
                    };
                    this.notify(data);
                },
                // Dismissed with or without a choice: the state machine hears either.
                onDismiss: () => this._state.closeMenu(),
            });
        } catch (error) {
            // A refusal throws BEFORE anything is shown, and the arrow must not stay pressed.
            this._state.closeMenu();
            throw error;
        }
    }

    /** A click on the action half: nothing while insensitive, else one `clicked`. */
    private _click(): void {
        if (!this._sensitive) return;
        this.emit('clicked');
    }

    /** Repaint the action half from the declared content properties. */
    private _renderContent(): void {
        const wantIcon = this.iconName !== null;
        if (wantIcon) this._actionIcon.iconName = this.iconName ?? '';
        // An empty action half shows an empty label — there is nothing to paint, and the
        // label view is the one that is already parented.
        else this._actionLabel.text = buttonContentLabelText(this.label ?? '', this.useUnderline);

        if (wantIcon !== this._showingIcon) {
            this._actionPart.removeChild(this._showingIcon ? this._actionIcon : this._actionLabel);
            this._actionPart.addChild(wantIcon ? this._actionIcon : this._actionLabel);
            this._showingIcon = wantIcon;
        }
    }

    /** Repaint the dropdown half and the dimming from the state machine. */
    private _render(): void {
        const { direction, dropdownEnabled } = this._state;

        this._chevron.iconName = splitButtonArrowSvg(direction);
        // `splitbutton:disabled { filter: Opacity(var(--disabled-opacity)) }`
        // (_buttons.scss:509-515). The NS CSS subset has no filter, so the dim is
        // applied inline; a dead dropdown dims on its own, like an insensitive
        // GtkMenuButton.
        this._dropdownPart.opacity = dropdownEnabled ? 1 : SPLIT_BUTTON_DISABLED_OPACITY;
        this.opacity = this._sensitive ? 1 : SPLIT_BUTTON_DISABLED_OPACITY;
    }

    /**
     * The dropdown menu, normalised (ADR 0042) — opened as a `PopupMenu` on an
     * arrow tap.
     *
     * Accepts everything the portable model does, INCLUDING the bare `string[]` this
     * widget used to be alone in taking: that shorthand is now one of the model's own
     * input forms rather than a NativeScript-only shape, so the same value works on
     * every surface.
     *
     * IT DOES NOT TAKE A JSON STRING, which the browser element's `menu-model`
     * ATTRIBUTE does. Not an oversight: NativeScript's Builder writes an XML attribute
     * straight onto the property, so accepting one here would open the XML door — and
     * the gallery probe that would have to prove it compares a read-back by IDENTITY
     * (`gallery-page.ts`), which no structured value can satisfy. An input form nothing
     * can run is a claim, not a feature.
     *
     * AND IT SAYS SO. Left to `normalizeMenuModel`, a string is "not an array" and
     * becomes an EMPTY menu — so an XML author writing `menuModel="[…]"` would get a
     * button whose dropdown is dead, with nothing anywhere saying why. A shut door that
     * is silent is worse than one that is open.
     */
    get menuModel(): AdwMenuModel {
        return this._state.menuModel ?? [];
    }

    set menuModel(value: AdwMenuInput) {
        refuseMenuString(value, 'AdwSplitButton');
        this._state.setMenuModel(value);
        // LOUD, at the assignment: a `custom` item names an application widget, which a
        // PopupMenu row cannot host — a surface that ignored it would offer a blank row.
        assertPopupMenuAssignable(this._state.menuModel ?? []);
    }

    /**
     * What the action group publishes about the actions this menu names — the portable
     * stand-in for a `GActionGroup`, and the only source of a menu's enabled/checked
     * state (ADR 0042). Left `null`, the registry above the button answers; an insensitive item
     * is shown disabled and a checked one checked.
     */
    get actions(): AdwMenuActions | null {
        return this._actions;
    }

    set actions(value: AdwMenuActions | null) {
        this._actions = value ?? null;
    }

    /**
     * `adw_split_button_get_direction`: where the arrow points (and, on GTK, the popup opens), as
     * a `Gtk.ArrowType`.
     *
     * NO `direction` ACCESSOR, by rule (`shadowed-properties.ts`): `ViewCommon.direction` is
     * NativeScript's layout direction, so `button.direction` stays that. The two verbs SHADOW
     * `Gtk.Widget`'s text-direction pair here exactly as they do in GJS, where
     * `Adw.SplitButton.get_direction()` answers an `ArrowType` too.
     */
    override get_direction(): number {
        return ArrowType[this._state.direction.toUpperCase() as keyof typeof ArrowType];
    }

    /**
     * `adw_split_button_set_direction`. Takes the `Gtk.ArrowType` constant; the builder and the
     * construct-props bag hand over the nick a `.blp` or `.ui` spells (`up`), which is read too.
     * Emits `notify::direction` when the arrow moves.
     */
    override set_direction(direction: number): void {
        const raw: unknown = direction;
        const constant =
            typeof raw === 'number'
                ? raw
                : /^\d+$/.test(String(raw))
                  ? Number(raw)
                  : (ArrowType as Readonly<Record<string, number>>)[String(raw).toUpperCase()];
        const nick = Object.keys(ArrowType)
            .find((name) => ArrowType[name as keyof typeof ArrowType] === constant)
            ?.toLowerCase();
        if (nick === undefined) {
            throw new TypeError(`${String(raw)} is not a valid value for enum argument direction (Gtk.ArrowType)`);
        }
        if (!this._state.setDirection(nick as SplitButtonDirection)) return;
        this.notify({ eventName: NOTIFY_DIRECTION, object: this, value: this.get_direction() } as EventData);
    }

    /**
     * Whether the control is sensitive — `GtkWidget:sensitive`, so `false` is the
     * insensitive state: dimmed, and emitting neither signal.
     *
     * The port spelled this `disabled` until ADR 0034 clause 1. Converging the name
     * INVERTS it, which is why the ledger recorded the pair rather than renaming
     * quietly: a `sensitive` that still meant `disabled` is worse than either name.
     */
    get sensitive(): boolean {
        return this._sensitive;
    }

    set sensitive(raw: boolean | string) {
        const next = !!xmlBoolean(raw, this._sensitive);
        if (next === this._sensitive) return;
        this._sensitive = next;
        this._render();
    }

    /** The main action part (for composing a custom content widget). */
    get actionButton(): StackLayout {
        return this._actionPart;
    }
}
