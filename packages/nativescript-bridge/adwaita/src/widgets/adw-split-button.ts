// AdwSplitButton — a Libadwaita-style split button for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (columns `auto, auto`): a tappable
// main action part (an `AdwIcon` symbolic OR a text `Label`) linked to a tappable
// dropdown-arrow part (a REAL pan-down `AdwIcon`, not a `⌄` glyph). Mirrors
// `Adw.SplitButton`: tapping the main part emits `clicked`; tapping the arrow
// opens a native `action()` menu from {@link AdwSplitButton.menu} and emits
// `menuTapped`.
//
// FIDELITY: approximated for the menu. `Adw.SplitButton` shows an in-app popover;
// the NS subset has no popover, so the dropdown opens the platform `action()`
// sheet (the same substitution `AdwComboRow` makes). The two-part linked shape +
// symbolic icons are faithful.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-split-button`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (.split-button)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { action, GridLayout, ItemSpec, Label, StackLayout, type EventData } from '@nativescript/core';
import { panDownSymbolic } from '@gjsify/adwaita-icons/ui';
import { AdwIcon } from './adw-icon.js';
import { attachRowPressFeedback } from './row-press.js';

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
    /** The main action part (column 0). */
    protected readonly _actionPart: StackLayout;
    /** The action label (shown when no `actionIcon` is set). */
    protected readonly _actionLabel: Label;
    /** The action symbolic icon (shown when an `actionIcon` is set). */
    protected readonly _actionIcon: AdwIcon;
    /** The dropdown-arrow part (column 1). */
    protected readonly _dropdownPart: GridLayout;
    /** The pan-down chevron. */
    protected readonly _chevron: AdwIcon;
    private _menu: string[] = [];
    private _hasActionIcon = false;
    private _actionIconSvg = '';

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

        // Dropdown part: a tappable cell with a centered pan-down chevron icon.
        const dropdownPart = new GridLayout();
        dropdownPart.className = 'adw-split-button-dropdown';
        dropdownPart.addColumn(new ItemSpec(1, 'star'));
        dropdownPart.addRow(new ItemSpec(1, 'star'));
        GridLayout.setColumn(dropdownPart, 1);

        const chevron = new AdwIcon();
        chevron.className = `${chevron.className} adw-split-button-chevron`.trim();
        chevron.icon = panDownSymbolic;
        chevron.horizontalAlignment = 'center';
        chevron.verticalAlignment = 'middle';
        dropdownPart.addChild(chevron);

        this.addChild(dropdownPart);
        this._dropdownPart = dropdownPart;
        this._chevron = chevron;

        actionPart.addEventListener('tap', () => {
            const data: EventData = { eventName: CLICKED, object: this };
            this.notify(data);
        });
        dropdownPart.addEventListener('tap', () => {
            void this._openMenu();
        });

        // Both halves darken on press, like Adwaita's linked `.split-button`.
        attachRowPressFeedback(actionPart);
        attachRowPressFeedback(dropdownPart);
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

    /** The main action button's text label (used when no `actionIcon` is set). */
    get label(): string {
        return this._actionLabel.text ?? '';
    }

    set label(value: string) {
        this._actionLabel.text = value ?? '';
    }

    /**
     * A symbolic SVG for the action part (e.g. `documentSaveSymbolic`). When set,
     * the icon replaces the text label — matching `Adw.SplitButton`'s icon mode.
     */
    get actionIcon(): string {
        return this._actionIconSvg;
    }

    set actionIcon(svg: string) {
        this._actionIconSvg = svg ?? '';
        this._actionIcon.icon = this._actionIconSvg;
        const want = this._actionIconSvg.length > 0;
        if (want && !this._hasActionIcon) {
            this._actionPart.removeChild(this._actionLabel);
            this._actionPart.addChild(this._actionIcon);
            this._hasActionIcon = true;
        } else if (!want && this._hasActionIcon) {
            this._actionPart.removeChild(this._actionIcon);
            this._actionPart.addChild(this._actionLabel);
            this._hasActionIcon = false;
        }
    }

    /** The dropdown menu items (opened as a native `action()` sheet on arrow tap). */
    get menu(): string[] {
        return this._menu;
    }

    set menu(value: string[]) {
        this._menu = Array.isArray(value) ? value : [];
    }

    /** The main action part (for composing a custom content widget). */
    get actionButton(): StackLayout {
        return this._actionPart;
    }
}
