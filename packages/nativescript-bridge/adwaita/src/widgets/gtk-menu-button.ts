// GtkMenuButton — the Adwaita-styled GTK menu button for NativeScript.
//
// NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034 clause 1), which this file's own
// FIDELITY note already stated: "libadwaita has no menu button of its own; it styles the
// GTK one".
//
// A flat icon button (extends {@link AdwImageButton}) that, when tapped, opens an Android
// `PopupMenu` anchored at it, built from {@link GtkMenuButton.menuModel}, fires the chosen item's
// action and emits `menuItemActivated` with it. Mirrors `Gtk.MenuButton` used with a
// `Gio.Menu` model — the app/primary-menu pattern in an Adwaita header bar
// (`open-menu-symbolic` → About / Preferences / Quit …). libadwaita has no menu
// button of its own; it styles the GTK one.
//
// FIDELITY: a native menu rather than a popover. `Gtk.MenuButton` shows an in-app popover; this
// opens `android.widget.PopupMenu` at the button (ADR 0097 § 2), which draws sections as groups,
// submenus as submenus and a check or radio as a checkable row, and shows an insensitive item
// disabled. What it cannot draw (`custom`, a section label, a radio run that shares a group) is
// refused by name (`popup-menu.ts`). The flat rounded-square icon-button shape + press feedback
// are inherited from {@link AdwImageButton} and are faithful.
//
// Reference: refs/gtk/gtk/gtkmenubutton.c (GtkMenuButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (menubutton)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { normalizeMenuModel } from '@gjsify/adwaita-core';
import type { AdwMenuActions, AdwMenuInput, AdwMenuModel } from '@gjsify/adwaita-core';
import type { EventData } from '@nativescript/core';
import { AdwImageButton } from './adw-image-button.js';
import { assertPopupMenuAssignable, refuseMenuString } from './popup-menu.js';
import { showMenuPopup } from './popup-menu-view.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { classNameWith, normalizeStyleClasses, withCssClass, withoutCssClass } from './style-classes.js';

/** Event name emitted when a menu item is chosen. */
export const MENU_ITEM_ACTIVATED = 'menuItemActivated';

/** Payload of the {@link MENU_ITEM_ACTIVATED} event. */
export interface MenuItemActivatedEventData extends EventData {
    /** The chosen item's id (or its label when no id was given). */
    id: string;
    /** The chosen item's label. */
    label: string;
    /**
     * Where the item sits in {@link GtkMenuButton.menuModel} — a PATH since ADR 0042,
     * because a submenu is a model of its own and a flat index cannot name one.
     */
    path: readonly number[];
    /** The chosen item's detailed action name, when the item carried one. */
    action?: string;
}

export class GtkMenuButton extends AdwImageButton {
    static readonly GTypeName: string = 'GtkMenuButton';

    private _model: AdwMenuModel = [];
    private _actions: AdwMenuActions | null = null;
    private _menuTitle = '';
    /** The image button's own classes, which every `styleClasses` write keeps. */
    private readonly _baseClassName: string;
    private _styleClasses: string[] = [];

    constructor(props?: ConstructProps<GtkMenuButton>) {
        super();
        // Keep the AdwImageButton base styling; add a marker class for any tweaks.
        this._baseClassName = `${this.className} adw-menu-button`.trim();
        this.className = this._baseClassName;
        this.addEventListener('tap', () => this._openMenu());

        applyConstructProps(this, props);
    }

    /**
     * The menu, normalised (ADR 0042) — opened as an Android `PopupMenu` on tap.
     *
     * Accepts every input form the portable model does, a bare `string[]` included —
     * but NOT a JSON string; see `AdwSplitButton.menuModel` for why the XML door stays
     * shut until a probe can prove it, and why being shut is not the same as being
     * silent.
     */
    get menuModel(): AdwMenuModel {
        return this._model;
    }

    set menuModel(value: AdwMenuInput) {
        refuseMenuString(value, 'GtkMenuButton');
        const model = normalizeMenuModel(value);
        assertPopupMenuAssignable(model);
        this._model = model;
    }

    /**
     * What the action group publishes about the actions this menu names — the portable
     * stand-in for a `GActionGroup`. Left `null`, the registry above the button answers
     * (`insertActionGroup`, ADR 0097 § 3); set, it is the application's word and wins.
     */
    get actions(): AdwMenuActions | null {
        return this._actions;
    }

    set actions(value: AdwMenuActions | null) {
        this._actions = value ?? null;
    }

    /** Carried for `menu-title`; a `PopupMenu` has no title row to put it in. */
    get menuTitle(): string {
        return this._menuTitle;
    }

    set menuTitle(value: string) {
        this._menuTitle = value ?? '';
    }

    /**
     * `GtkWidget:css-classes`, spelled `styleClasses` for the reason `style-classes.ts`
     * gives. A `.blp` header bar writes `styles ["flat"]` on its menu button, and the
     * shared-tree builder refuses a style class the widget has no door for, so without it
     * that header bar did not build here at all.
     */
    get styleClasses(): string[] {
        return [...this._styleClasses];
    }

    set styleClasses(value: string | null | undefined) {
        this._setClasses(normalizeStyleClasses(value));
    }

    /** `gtk_widget_add_css_class`. A class the button already carries is a no-op. */
    add_css_class(name: string): void {
        this._setClasses(withCssClass(this._styleClasses, name));
    }

    /** `gtk_widget_remove_css_class`. A class it does not carry is a no-op. */
    remove_css_class(name: string): void {
        this._setClasses(withoutCssClass(this._styleClasses, name));
    }

    /** `gtk_widget_has_css_class`. */
    has_css_class(name: string): boolean {
        return this._styleClasses.includes((name ?? '').trim());
    }

    /** `gtk_widget_get_css_classes` — the list, without the widget's own CSS name. */
    get_css_classes(): string[] {
        return [...this._styleClasses];
    }

    /** `gtk_widget_set_css_classes` — REPLACES the list, as in C. */
    set_css_classes(names: readonly string[]): void {
        this._setClasses(normalizeStyleClasses([...names].join(' ')));
    }

    private _setClasses(classes: string[]): void {
        this._styleClasses = classes;
        this.className = classNameWith(this._baseClassName, classes);
    }

    private _openMenu(): void {
        if (this._model.length === 0) return;
        showMenuPopup(this, {
            model: this._model,
            actions: this._actions,
            onActivated: (item, path) => {
                const data: MenuItemActivatedEventData = {
                    eventName: MENU_ITEM_ACTIVATED,
                    object: this,
                    id: item.id ?? item.label,
                    label: item.label,
                    path,
                    action: item.action,
                };
                this.notify(data);
            },
        });
    }
}
