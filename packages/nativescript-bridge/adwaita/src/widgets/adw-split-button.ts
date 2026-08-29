// AdwSplitButton — a Libadwaita-style split button for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (columns `auto, auto`): a tappable
// main action part (an `AdwIcon` symbolic OR a text `Label`) linked to a tappable
// dropdown-arrow part (a REAL pan-* / open-menu `AdwIcon`, not a `⌄` glyph).
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
// substitution `AdwComboRow` makes). The label→position round trip that substitution
// forces is handled in `split-button.ts`. The two-part linked shape and the symbolic
// icons are faithful.
//
// Reference: refs/libadwaita/src/adw-split-button.c (AdwSplitButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (.split-button)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { action, GridLayout, ItemSpec, Label, StackLayout, type EventData } from '@nativescript/core';
import { SPLIT_BUTTON_DISABLED_OPACITY, SplitButtonState } from '@gjsify/adwaita-core';
import type { AdwMenuEntry, SplitButtonDirection } from '@gjsify/adwaita-core';
import { AdwIcon } from './adw-icon.js';
import { attachRowPressFeedback } from './row-press.js';
import {
    MENU_CANCEL_LABEL,
    menuSheetActions,
    resolveMenuChoice,
    setActionIcon,
    splitButtonArrowSvg,
    toMenuEntries,
} from './split-button.js';
import { xmlBoolean } from './xml-values.js';

/** Event name emitted when the main action part is tapped. Mirrors `Adw.SplitButton::clicked`. */
export const CLICKED = 'clicked';

/** Event name emitted when a dropdown menu item is chosen. */
export const MENU_TAPPED = 'menuTapped';

/** Payload of the {@link MENU_TAPPED} event. */
export interface MenuTappedEventData extends EventData {
    /** The chosen menu item label. */
    item: string;
    /** The chosen item's index in {@link AdwSplitButton.menu} — its GMenuModel POSITION. */
    index: number;
    /** The chosen item's detailed action name, when the entry carried one. */
    action?: string;
}

export class AdwSplitButton extends GridLayout {
    /** The main action part (column 0). */
    protected readonly _actionPart: StackLayout;
    /** The action label (shown in label mode). */
    protected readonly _actionLabel: Label;
    /** The action symbolic icon (shown in icon mode). */
    protected readonly _actionIcon: AdwIcon;
    /** The dropdown-arrow part (column 1). */
    protected readonly _dropdownPart: GridLayout;
    /** The direction arrow. */
    protected readonly _chevron: AdwIcon;
    private readonly _state = new SplitButtonState();
    /** Which of the two action views is currently parented. */
    private _showingIcon = false;
    private _disabled = false;

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

        const actionIcon = new AdwIcon();
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

        const chevron = new AdwIcon();
        chevron.className = `${chevron.className} adw-split-button-chevron`.trim();
        chevron.icon = splitButtonArrowSvg(this._state.direction);
        chevron.horizontalAlignment = 'center';
        chevron.verticalAlignment = 'middle';
        dropdownPart.addChild(chevron);

        this.addChild(dropdownPart);
        this._dropdownPart = dropdownPart;
        this._chevron = chevron;

        actionPart.addEventListener('tap', () => {
            if (this._disabled) return;
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
        if (this._disabled || this._state.open || !this._state.dropdownEnabled) return;
        const entries = this._state.menuModel ?? [];
        const actions = menuSheetActions(entries, MENU_CANCEL_LABEL);

        this._state.toggleMenu();
        const chosen = await action({
            // The label of the CURRENT content only — an icon-mode button has
            // none, where the old code handed over the hidden stale label.
            title: this._state.label || undefined,
            cancelButtonText: MENU_CANCEL_LABEL,
            actions,
        });

        const index = resolveMenuChoice(actions, chosen);
        const entry = this._state.activateMenuEntry(index);
        if (entry === null) {
            // Dismissed, or a choice that maps to no position.
            this._state.closeMenu();
            return;
        }
        const data: MenuTappedEventData = {
            eventName: MENU_TAPPED,
            object: this,
            item: entry.label,
            index,
            action: entry.action,
        };
        this.notify(data);
    }

    /** Repaint both halves from the state machine. */
    private _render(): void {
        const { mode, label, iconName, direction, dropdownEnabled } = this._state;

        const wantIcon = mode === 'icon';
        if (wantIcon) this._actionIcon.icon = iconName ?? '';
        // An empty/child action half shows an empty label — there is nothing to
        // paint, and the label view is the one that is already parented.
        else this._actionLabel.text = label ?? '';

        if (wantIcon !== this._showingIcon) {
            this._actionPart.removeChild(this._showingIcon ? this._actionIcon : this._actionLabel);
            this._actionPart.addChild(wantIcon ? this._actionIcon : this._actionLabel);
            this._showingIcon = wantIcon;
        }

        this._chevron.icon = splitButtonArrowSvg(direction);
        // `splitbutton:disabled { filter: Opacity(var(--disabled-opacity)) }`
        // (_buttons.scss:509-515). The NS CSS subset has no filter, so the dim is
        // applied inline; a dead dropdown dims on its own, like an insensitive
        // GtkMenuButton.
        this._dropdownPart.opacity = dropdownEnabled ? 1 : SPLIT_BUTTON_DISABLED_OPACITY;
        this.opacity = this._disabled ? SPLIT_BUTTON_DISABLED_OPACITY : 1;
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
    get actionIcon(): string {
        return this._state.iconName ?? '';
    }

    set actionIcon(svg: string) {
        setActionIcon(this._state, svg);
    }

    /** The dropdown menu entries (opened as a native `action()` sheet on arrow tap). */
    get menu(): readonly AdwMenuEntry[] {
        return this._state.menuModel ?? [];
    }

    set menu(value: readonly (string | AdwMenuEntry)[]) {
        this._state.setMenuModel(toMenuEntries(value));
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

    /** Whether the control is insensitive: dimmed, and emitting neither signal. */
    get disabled(): boolean {
        return this._disabled;
    }

    set disabled(raw: boolean | string) {
        const value = xmlBoolean(raw, this.disabled);
        const next = !!value;
        if (next === this._disabled) return;
        this._disabled = next;
        this._render();
    }

    /** The main action part (for composing a custom content widget). */
    get actionButton(): StackLayout {
        return this._actionPart;
    }
}
