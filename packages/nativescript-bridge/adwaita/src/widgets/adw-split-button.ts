// AdwSplitButton — a Libadwaita-style split button for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (columns `*, auto`): a main action
// `Button` and a separate dropdown-arrow `Button`. Mirrors `Adw.SplitButton`:
// tapping the main part emits `clicked`; tapping the arrow opens a native
// `action()` menu from {@link AdwSplitButton.menu} and emits `menuTapped`.
//
// FIDELITY: approximated. `Adw.SplitButton` shows an in-app popover menu; the NS
// subset has no popover, so the dropdown opens the platform `action()` sheet
// instead (the same substitution `AdwComboRow` makes). The two-part button shape
// (linked main + arrow) is faithful via the two-column grid.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-split-button`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (.split-button)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { action, Button, GridLayout, ItemSpec, type EventData } from '@nativescript/core';

/** Event name emitted when the main action part is tapped. Mirrors `Adw.SplitButton::clicked`. */
export const CLICKED = 'clicked';

/** Event name emitted when a dropdown menu item is chosen. */
export const MENU_TAPPED = 'menuTapped';

/** Payload of the {@link MENU_TAPPED} event. */
export interface MenuTappedEventData extends EventData {
    /** The chosen menu item label. */
    item: string;
    /** The chosen item's index in {@link AdwSplitButton.menu}. */
    index: number;
}

export class AdwSplitButton extends GridLayout {
    /** The main action button (column 0). */
    protected readonly _actionButton: Button;
    /** The dropdown-arrow button (column 1). */
    protected readonly _dropdownButton: Button;
    private _menu: string[] = [];

    constructor() {
        super();

        this.className = 'adw-split-button';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addColumn(new ItemSpec(1, 'auto'));
        this.addRow(new ItemSpec(1, 'auto'));

        const actionButton = new Button();
        actionButton.className = 'adw-split-button-action';
        actionButton.set('androidElevation', 0);
        GridLayout.setColumn(actionButton, 0);
        this.addChild(actionButton);
        this._actionButton = actionButton;

        const dropdownButton = new Button();
        dropdownButton.className = 'adw-split-button-dropdown';
        dropdownButton.text = '⌄'; // U+2304 DOWN ARROWHEAD
        dropdownButton.set('androidElevation', 0);
        GridLayout.setColumn(dropdownButton, 1);
        this.addChild(dropdownButton);
        this._dropdownButton = dropdownButton;

        actionButton.addEventListener('tap', () => {
            const data: EventData = { eventName: CLICKED, object: this };
            this.notify(data);
        });

        dropdownButton.addEventListener('tap', () => {
            void this._openMenu();
        });
    }

    private async _openMenu(): Promise<void> {
        if (this._menu.length === 0) return;
        const chosen = await action({
            title: this.label || undefined,
            cancelButtonText: 'Cancel',
            actions: this._menu,
        });
        const index = this._menu.indexOf(chosen);
        if (index >= 0) {
            const data: MenuTappedEventData = {
                eventName: MENU_TAPPED,
                object: this,
                item: chosen,
                index,
            };
            this.notify(data);
        }
    }

    /** The main action button's label. */
    get label(): string {
        return this._actionButton.text ?? '';
    }

    set label(value: string) {
        this._actionButton.text = value ?? '';
    }

    /** The dropdown menu items (opened as a native `action()` sheet on arrow tap). */
    get menu(): string[] {
        return this._menu;
    }

    set menu(value: string[]) {
        this._menu = Array.isArray(value) ? value : [];
    }

    /** The main action button (for composing a custom content widget). */
    get actionButton(): Button {
        return this._actionButton;
    }
}
