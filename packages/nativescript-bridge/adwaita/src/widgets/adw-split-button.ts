// AdwSplitButton — a Libadwaita-style split button for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (columns `auto, auto`): a tappable
// main action part (an `GtkImage` symbolic OR a text `Label`) linked to a tappable
// dropdown-arrow part (a REAL pan-* / open-menu `GtkImage`, not a `⌄` glyph).
// Mirrors `Adw.SplitButton`: tapping the main part emits `clicked`; tapping the
// arrow opens a native `action()` menu from {@link AdwSplitButton.menu} and emits
// `menuTapped`.
//
// The BEHAVIOUR — which content slot is filled (label/icon/child are mutually
// exclusive), whether the dropdown is live at all, the arrow direction, the dropdown
// tooltip fallback — is headless in `@gjsify/adwaita-core` (ADR 0004) as
// `SplitButtonState`; this class only renders it.
//
// FIDELITY: approximated for the menu. `Adw.SplitButton` shows an in-app popover; the
// NS subset has none, so the dropdown opens the platform `action()` sheet (the same
// substitution `AdwComboRow` makes). What that costs — and what it does with a section,
// a submenu, a disabled item and a check — is decided once in `menu-sheet.ts` for this
// widget and `GtkMenuButton` together (ADR 0042). The two-part linked shape and the
// symbolic icons are faithful.
//
// Reference: refs/libadwaita/src/adw-split-button.c (AdwSplitButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (.split-button)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { action, GridLayout, ItemSpec, Label, StackLayout, type EventData } from '@nativescript/core';
import {
    ADW_MENU_SURFACE_NATIVESCRIPT,
    SPLIT_BUTTON_DISABLED_OPACITY,
    SplitButtonState,
    assertMenuRenderable,
} from '@gjsify/adwaita-core';
import type { AdwMenuActions, AdwMenuInput, AdwMenuModel, SplitButtonDirection } from '@gjsify/adwaita-core';
import { GtkImage } from './gtk-image.js';
import { attachRowPressFeedback } from './row-press.js';
import { MENU_CANCEL_LABEL, presentMenuSheet, refuseMenuString } from './menu-sheet.js';
import { setActionIcon, splitButtonArrowSvg } from './split-button.js';
import { xmlBoolean } from './xml-values.js';

/** Event name emitted when the main action part is tapped. Mirrors `Adw.SplitButton::clicked`. */
export const CLICKED = 'clicked';

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

export class AdwSplitButton extends GridLayout {
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

    constructor() {
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

        actionPart.addEventListener('tap', () => {
            if (!this._sensitive) return;
            const data: EventData = { eventName: CLICKED, object: this };
            this.notify(data);
        });
        dropdownPart.addEventListener('tap', () => {
            void this._openMenu();
        });

        // Both halves darken on press, like Adwaita's linked `.split-button`.
        attachRowPressFeedback(actionPart);
        attachRowPressFeedback(dropdownPart);

        this._state.subscribe(() => this._render());
        this._render();
    }

    /**
     * Present the dropdown menu and dispatch the choice BY POSITION.
     *
     * Nothing happens without a menu: "if the menu model is `NULL`, the dropdown
     * is disabled" (adw-split-button.c:376-378).
     */
    private async _openMenu(): Promise<void> {
        // A sheet is already up — the platform owns the interaction until it
        // resolves, so a second tap must not present a second one.
        if (!this._sensitive || this._state.open || !this._state.dropdownEnabled) return;

        this._state.toggleMenu();
        const path = await presentMenuSheet(action, this._state.menuModel ?? [], {
            // The label of the CURRENT content only — an icon-mode button has
            // none, where the old code handed over the hidden stale label.
            title: this._state.label ?? undefined,
            actions: this._actions ?? undefined,
            cancelLabel: MENU_CANCEL_LABEL,
        });

        const item = path === null ? null : this._state.activateMenuItem(path);
        if (item === null || path === null) {
            // Dismissed, or a choice that maps to no position.
            this._state.closeMenu();
            return;
        }
        const data: MenuTappedEventData = {
            eventName: MENU_TAPPED,
            object: this,
            item: item.label,
            id: item.id ?? item.label,
            path,
            action: item.action,
        };
        this.notify(data);
    }

    /** Repaint both halves from the state machine. */
    private _render(): void {
        const { mode, label, iconName, direction, dropdownEnabled } = this._state;

        const wantIcon = mode === 'icon';
        if (wantIcon) this._actionIcon.iconName = iconName ?? '';
        // An empty/child action half shows an empty label — there is nothing to
        // paint, and the label view is the one that is already parented.
        else this._actionLabel.text = label ?? '';

        if (wantIcon !== this._showingIcon) {
            this._actionPart.removeChild(this._showingIcon ? this._actionIcon : this._actionLabel);
            this._actionPart.addChild(wantIcon ? this._actionIcon : this._actionLabel);
            this._showingIcon = wantIcon;
        }

        this._chevron.iconName = splitButtonArrowSvg(direction);
        // `splitbutton:disabled { filter: Opacity(var(--disabled-opacity)) }`
        // (_buttons.scss:509-515). The NS CSS subset has no filter, so the dim is
        // applied inline; a dead dropdown dims on its own, like an insensitive
        // GtkMenuButton.
        this._dropdownPart.opacity = dropdownEnabled ? 1 : SPLIT_BUTTON_DISABLED_OPACITY;
        this.opacity = this._sensitive ? 1 : SPLIT_BUTTON_DISABLED_OPACITY;
    }

    /**
     * The main action button's text label, or `''` when the action half shows an
     * icon or nothing — never the stale value behind a swapped-out view.
     */
    get label(): string {
        return this._state.label ?? '';
    }

    set label(value: string) {
        this._state.setLabel(value ?? '');
    }

    /**
     * A symbolic SVG for the action part (e.g. `documentSaveSymbolic`). Setting
     * one replaces the label, clearing it returns the action half to its label —
     * the mutual exclusion `Adw.SplitButton` enforces (adw-split-button.c:749-771).
     *
     * The SVG string IS the icon identity here, so it is what the state machine
     * stores as the icon name; NS resolves no icon theme.
     */
    get iconName(): string {
        return this._state.iconName ?? '';
    }

    set iconName(svg: string) {
        setActionIcon(this._state, svg);
    }

    /**
     * The dropdown menu, normalised (ADR 0042) — opened as a native `action()` sheet on
     * an arrow tap.
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
        // LOUD, at the assignment: a `custom` item names an application widget, and a
        // sheet row is a string — a surface that ignored it would offer a blank row.
        assertMenuRenderable(this._state.menuModel ?? [], ADW_MENU_SURFACE_NATIVESCRIPT);
    }

    /**
     * What the action group publishes about the actions this menu names — the portable
     * stand-in for a `GActionGroup`, and the only source of a menu's enabled/checked
     * state (ADR 0042). A sheet has no disabled row, so an insensitive item is not
     * offered; a checked one wears a tick.
     */
    get actions(): AdwMenuActions | null {
        return this._actions;
    }

    set actions(value: AdwMenuActions | null) {
        this._actions = value ?? null;
    }

    /** The direction the arrow points (and, on GTK, the popup opens). */
    get direction(): SplitButtonDirection {
        return this._state.direction;
    }

    set direction(value: SplitButtonDirection) {
        this._state.setDirection(value);
    }

    /**
     * The dropdown tooltip as set — `''` while unset. Resolve it through
     * `resolveDropdownTooltip()` for what should be shown; the NS sheet has no
     * tooltip surface, so this is carried for parity and for host bindings.
     */
    get dropdownTooltip(): string {
        return this._state.dropdownTooltip;
    }

    set dropdownTooltip(value: string) {
        this._state.setDropdownTooltip(value ?? '');
    }

    /** Whether an underline in the label marks a mnemonic. */
    get useUnderline(): boolean {
        return this._state.useUnderline;
    }

    set useUnderline(raw: boolean | string) {
        const value = xmlBoolean(raw, this.useUnderline);
        this._state.setUseUnderline(!!value);
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
