// <gtk-application-window> — a `Gtk.Window` that knows about a `GtkApplication`.
//
// The subclass has exactly ONE property of its own, `show-menubar` (gtkapplicationwindow.c:
// `PROP_SHOWMENUBAR`, :693), and everything else it brings is the ACTION groups and the
// menubar: `init` inserts a `win` action group into the window (:435) and creates the private
// `menubar_section` menu the bar is assembled from (:436-437).
//
// THE MENUBAR, AND WHY IT IS A SLOT HERE. `update_menubar` (:392-431) shows the bar only when
// `show_menubar` is set AND the section has at least one item, and it BUILDS the bar with
// `gtk_popover_menu_bar_new_from_model` over a combined `GMenu` — a `GMenuModel` read from the
// `GtkApplication`, which no attribute can carry and no markup can spell. So the bar is a
// `menubar` SLOT here: the application's own menubar view, placed where `update_menubar`
// parents it — above the content and below the titlebar, because `gtk_window_set_titlebar`
// puts the titlebar above the window's child. The visibility rule is the C's, both halves of
// it: no children, or `show-menubar="false"`, and the strip is hidden.
//
// THE `win.` / `app.` PREFIXES. `GtkApplicationWindow` exports window actions under `win.` and
// application-wide ones under `app.` (:48-56), and any `GtkActionable` inside the window can
// activate either. A page has no `GActionMap`, so nothing is exported here; what this element
// adds over `<gtk-window>` is the strip and the property that shows it.
//
// Reference: refs/gtk/gtk/gtkapplicationwindow.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_window.scss (GtkWindow)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import type { AdwSlot } from '../slotted-children.js';
import { GtkWindow } from './gtk-window.js';
import { defineWindowApplication } from '../application.js';

export class GtkApplicationWindow extends GtkWindow {
    /** `Gtk.Window:application`: setting it is `add_window` (ADR 0098), set by `defineWindowApplication`. */
    declare application: object | null;
    private _menubar: HTMLDivElement | null = null;
    private _menubarObserver: MutationObserver | null = null;

    static get observedAttributes(): string[] {
        return [...GtkWindow.observedAttributes, 'show-menubar'];
    }

    /** `Gtk.ApplicationWindow:show-menubar` — whether the window shows a menubar of its own. */
    get showMenubar(): boolean {
        return this.getAttribute('show-menubar') === 'true';
    }

    set showMenubar(value: boolean) {
        this._write('show-menubar', String(value));
    }

    /**
     * The menubar strip, created once and reused: `strips()` and `extraSlots()` both ask for
     * it, so whichever runs first builds it and the other finds it.
     */
    private menubarSection(): HTMLDivElement {
        if (this._menubar === null) {
            const section = document.createElement('div');
            section.className = 'adw-gtk-application-window-menubar';
            this._menubar = section;
        }
        return this._menubar;
    }

    /**
     * Titlebar, then menubar, then content — the order `update_menubar` parents the bar at
     * (:418) inside a window whose titlebar sits above its own child.
     */
    protected override strips(): Node[] {
        return [this._titlebar, this.menubarSection(), this._content];
    }

    /** The `menubar` slot, which is where a `GtkPopoverMenuBar` goes. */
    protected override extraSlots(): AdwSlot[] {
        return [{ name: 'menubar', into: this.menubarSection() }];
    }

    connectedCallback() {
        super.connectedCallback();
        this._followMenubar();
    }

    disconnectedCallback() {
        this._menubarObserver?.disconnect();
        this._menubarObserver = null;
    }

    attributeChangedCallback(name: string) {
        super.attributeChangedCallback(name);
        if (name === 'show-menubar') this._renderMenubar();
    }

    /**
     * `update_menubar`'s visibility rule (gtkapplicationwindow.c:400-402), BOTH halves: the
     * property AND at least one item in the section. This element has no `GMenuModel` to ask,
     * so the second half is the SLOT — an empty `menubar` slot is an empty `menubar_section`.
     * The observer is what makes the second half live: `bindSlottedChildren` adopts a
     * `slot="menubar"` child after connect, and a bar that appeared then must appear.
     */
    private _followMenubar(): void {
        this._menubarObserver?.disconnect();
        this._menubarObserver = new MutationObserver(() => this._renderMenubar());
        this._menubarObserver.observe(this.menubarSection(), { childList: true });
        this._renderMenubar();
    }

    private _renderMenubar(): void {
        const menubar = this.menubarSection();
        menubar.hidden = !this.showMenubar || menubar.childElementCount === 0;
    }
}

customElements.define('gtk-application-window', GtkApplicationWindow);

defineWindowApplication(GtkApplicationWindow.prototype);
