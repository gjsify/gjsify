// GtkPopoverMenu — a menu model shown at a parent, as the one Android `PopupMenu` (ADR 0097 § 2).
//
// NOT A VIEW. GTK's popover is a widget in the tree of the thing it is set on; a `PopupMenu` is
// the platform's own window anchored at a view, so this is a value object that remembers its
// parent (`set_parent`) and shows the menu on `popup()`. `menu-model` goes through the same
// `menuModel` door `GtkMenuButton` has, and an item's action fires through the registry above the
// parent, as it does there.
//
// A TRUE SUBSET. Everything it has is GTK's, with GTK's meaning. What `PopupMenu` cannot express
// throws BY NAME — `pointing_to`, a `position` other than the default, `has_arrow = false`,
// `autohide = false`, `add_child`, `flags` beyond nested — so a component written for GTK fails at
// the line that asks for it and not by drawing something else. The defaults are readable: reading
// `position` answers `bottom`, as GTK does.
//
// Reference: refs/gtk/gtk/gtkpopovermenu.c, gtk/gtkpopover.c (gtk_popover_popup, gtk_popover_popdown)

import { Observable, type EventData } from '@nativescript/core';
import { normalizeMenuModel } from '@gjsify/adwaita-core';
import type { AdwMenuActions, AdwMenuInput, AdwMenuModel } from '@gjsify/adwaita-core';

import type { ActionHost } from './actions.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { assertPopupMenuAssignable, refuseMenuString } from './popup-menu.js';
import { showMenuPopup, type MenuPopupHandle } from './popup-menu-view.js';
import { withSignals } from './signals.js';

/** `GtkPopover::closed`, emitted when the menu goes away. */
export const CLOSED = 'closed';

const unsupported = (member: string, why: string): Error =>
    new Error(`Gtk.PopoverMenu.${member} is not supported: ${why} (ADR 0097 § 2).`);

export class GtkPopoverMenu extends withSignals(Observable) {
    private _model: AdwMenuModel = [];
    private _actions: AdwMenuActions | null = null;
    private _parent: ActionHost | null = null;
    private _open: MenuPopupHandle | null = null;

    constructor(props?: ConstructProps<GtkPopoverMenu>) {
        super();
        applyConstructProps(this, props);
    }

    /** `Gtk.PopoverMenu:menu-model`. */
    get menuModel(): AdwMenuModel {
        return this._model;
    }

    set menuModel(value: AdwMenuInput) {
        refuseMenuString(value, 'GtkPopoverMenu');
        const model = normalizeMenuModel(value);
        assertPopupMenuAssignable(model);
        this._model = model;
    }

    set_menu_model(model: AdwMenuInput | null): void {
        this.menuModel = model ?? [];
    }

    get_menu_model(): AdwMenuModel {
        return this._model;
    }

    /** What the action group publishes about the actions this menu names; see `GtkMenuButton.actions`. */
    get actions(): AdwMenuActions | null {
        return this._actions;
    }

    set actions(value: AdwMenuActions | null) {
        this._actions = value ?? null;
    }

    /** The view the menu is anchored at (`gtk_widget_set_parent` on the popover). */
    get parent(): ActionHost | null {
        return this._parent;
    }

    set parent(value: ActionHost | null) {
        if (value === this._parent) return;
        this.popdown();
        this._parent = value ?? null;
    }

    set_parent(widget: ActionHost): void {
        this.parent = widget;
    }

    unparent(): void {
        this.parent = null;
    }

    /** `gtk_popover_popup`: show the menu at the parent. */
    popup(): void {
        if (this._parent === null) {
            throw unsupported('popup()', 'a PopupMenu is anchored at a view, so call set_parent(widget) first');
        }
        if (this._open !== null || this._model.length === 0) return;
        const handle = showMenuPopup(this._parent, {
            model: this._model,
            actions: this._actions,
            onDismiss: () => {
                if (this._open === null) return;
                this._open = null;
                this.notify({ eventName: CLOSED, object: this } satisfies EventData);
            },
        });
        this._open = handle;
    }

    /** `gtk_popover_popdown`: close it; a menu that is not showing is left alone. */
    popdown(): void {
        this._open?.dismiss();
    }

    // --- What a PopupMenu cannot express: refused by name -----------------------------------

    /** `has-arrow`. A PopupMenu draws none, so only GTK's default `true` is claimed. */
    get hasArrow(): boolean {
        return true;
    }

    set hasArrow(value: boolean) {
        if (value !== true) throw unsupported('has_arrow = false', 'a PopupMenu has no arrow to hide');
    }

    /** `autohide`. A PopupMenu always dismisses on an outside tap. */
    get autohide(): boolean {
        return true;
    }

    set autohide(value: boolean) {
        if (value !== true) throw unsupported('autohide = false', 'a PopupMenu always closes on an outside tap');
    }

    /** `position`. Only the default is claimed: the platform picks the side that fits. */
    get position(): string {
        return 'bottom';
    }

    set position(value: string | number) {
        if (value !== 'bottom' && value !== 3) {
            throw unsupported(`position = ${String(value)}`, 'a PopupMenu opens where Android places it');
        }
    }

    /** `flags`. Only nested submenus exist on a PopupMenu. */
    get flags(): string {
        return 'nested';
    }

    set flags(value: string) {
        if (value !== 'nested') throw unsupported(`flags = ${String(value)}`, 'only nested submenus exist');
    }

    get pointingTo(): never {
        throw unsupported('pointing_to', 'a PopupMenu is anchored at the whole parent view');
    }

    set pointingTo(_value: unknown) {
        throw unsupported('pointing_to', 'a PopupMenu is anchored at the whole parent view');
    }

    get_pointing_to(): never {
        throw unsupported('get_pointing_to()', 'a PopupMenu is anchored at the whole parent view');
    }

    set_pointing_to(_rect: unknown): never {
        throw unsupported('set_pointing_to()', 'a PopupMenu is anchored at the whole parent view');
    }

    add_child(_child: unknown, _id: string): never {
        throw unsupported('add_child()', 'a PopupMenu row is a title, not a widget');
    }

    remove_child(_child: unknown): never {
        throw unsupported('remove_child()', 'a PopupMenu row is a title, not a widget');
    }
}
