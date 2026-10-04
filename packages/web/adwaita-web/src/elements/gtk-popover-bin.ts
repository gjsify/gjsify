// <gtk-popover-bin> — one child, and a popover to present from it. GTK 4.22's answer to
// "anywhere in my window should be able to offer a menu": wrap the widget, and the
// container owns the `Gtk.Popover`, the gestures and the `menu.popup` action.
//
// Its four behaviours are all short, and all are in gtkpopoverbin.c:
//
//   · `menu-model` BUILDS the popover: `gtk_popover_bin_set_menu_model` creates a
//     `gtk_popover_menu_new_from_model (model)`, pins it to `GTK_POS_BOTTOM` and adopts it
//     (gtkpopoverbin.c:474-500). `popover` and `menu-model` are the SAME slot from two
//     directions and each one CLEARS the other (`set_popover` clears the model,
//     gtkpopoverbin.c:543-551) — so they are one field here too, not two that can disagree.
//   · `handle-input` is the gesture pair: a `GtkGestureClick` on button 0 that pops the
//     popover up only when the event `gdk_event_triggers_context_menu` (right click on
//     Linux, ctrl-click on macOS) and DENIES the sequence otherwise, plus a touch-only
//     long press that always pops (:156-189, :624-655). A plain left click therefore
//     reaches the child untouched, which is the whole reason the gesture is separate.
//   · The popover is presented AT THE POINTER: `popup_at_position` sets `pointing-to` to
//     `(x, y)` when there is one and to the bottom-start (or bottom-end under RTL) corner
//     of the bin when the call carries none (:129-154) — the shape GTK's
//     `gtk_popover_menu_new_from_model` gets on a secondary click.
//   · The child wears `.has-open-popup` WHILE the popover is mapped, and loses it on unmap
//     (:117-126) — libadwaita's signal to the child that it is the row that generated the
//     open popup (`_lists.scss:57`, `_sidebars.scss:132`), which is what a list row or a
//     sidebar row needs to stay highlighted.
//
// `menu.popup` is an ACTION, not a method (gtkpopoverbin.c:381), so the element exposes it
// as an event the keyboard can dispatch and as `popup()` for a call — the action itself is
// GTK plumbing with no browser counterpart.
//
// Attributes:
//   menu-model    — the portable menu model as JSON (ADR 0042); builds the popover.
//   handle-input  — boolean, default FALSE — GTK's default. When set, a right click and a
//                   long press open the popover at the pointer.
// Properties:
//   menuModel     — the model, normalised (get/set). Setting it REPLACES any popover.
//   popoverElement — the `<gtk-popover>` this bin presents (get/set; setting it drops
//                   the model, as GTK does). `GtkPopoverBin`'s own name for it is `popover`,
//                   which `HTMLElement` already spells as a string attribute for the DOM
//                   Popover API — so the element adds the suffix instead of shadowing it.
//   handleInput   — whether input opens the popover (get/set).
//   actions       — what the action group publishes about the actions the menu names.
// Methods:
//   popup()   — the `menu.popup` action.  popdown() — dismiss it.
// Events:
//   `notify::menu-model` (CustomEvent, bubbles, detail = { menuModel }) — the model changed,
//     which in GTK is ALSO the notify for `:popover` (gtkpopoverbin.c:586-587): one slot,
//     one notification pair.
//   `menu.popup` (CustomEvent, bubbles) — the action's activation, dispatched so a keyboard
//     binding or a test can fire it the way `gtk_widget_activate_action` would.
//
// KNOWN_GAPS — none of the scalar properties: `handle-input` is observed, and `child`,
// `popover` and `menu-model` are widget-typed, which `check-adwaita-element-properties.mjs`
// excludes from the scalar surface.
//
// Reference: refs/gtk/gtk/gtkpopoverbin.c (the class docs :30-42, `popup_at_position`
//   :129-154, the gestures :156-189, `set_menu_model` :474-500, `set_popover` :543-587,
//   `set_handle_input` :624-655, the `.has-open-popup` handlers :117-126)
// Reference: refs/libadwaita/src/stylesheet/widgets/_lists.scss:57 (`row.has-open-popup`)
// Reference: refs/libadwaita/src/stylesheet/widgets/_sidebars.scss:132 (the sidebar row)
// Copyright (c) GNOME contributors (GTK, libadwaita). LGPLv2.1+
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    ADW_MENU_SURFACE_WEB,
    assertMenuRenderable,
    menuRefusals,
    normalizeMenuModel,
    parseMenuModel,
} from '@gjsify/adwaita-core';
import type { AdwMenuActions, AdwMenuInput, AdwMenuModel } from '@gjsify/adwaita-core';

// Both definitions have to be there before this module's own can build them in
// `connectedCallback`; a combined `import { GtkPopoverMenu }` would be elided, because the
// bindings are only used in type position.
import './gtk-popover-menu.js';

import type { GtkPopoverMenu } from './gtk-popover-menu.js';

/** How long a press must last to count as a long press — GTK's own default. */
const LONG_PRESS_MS = 500;

export class GtkPopoverBin extends HTMLElement {
    private _model: AdwMenuModel = [];
    private _popover: GtkPopoverMenu | null = null;
    private _actions: AdwMenuActions | null = null;
    private _initialized = false;
    private _longPressTimer: ReturnType<typeof setTimeout> | null = null;

    static get observedAttributes() {
        return ['menu-model', 'handle-input'];
    }

    /** The menu model, normalised (ADR 0042). */
    get menuModel(): AdwMenuModel {
        return this._model;
    }

    /**
     * The model the popover is built from — ONE slot with `popover`, because GTK's two
     * setters clear each other (gtkpopoverbin.c:474-500, :543-551). A model REPLACES the
     * popover; a popover DROPS the model, and both notify for both properties.
     */
    set menuModel(value: AdwMenuInput | AdwMenuModel) {
        this._model = normalizeMenuModel(value as AdwMenuInput);
        assertMenuRenderable(this._model, ADW_MENU_SURFACE_WEB);
        this._adoptPopover(this._buildPopover());
        this._notifyModel();
    }

    /**
     * The popover this bin presents, or `null`.
     *
     * NOT `popover`, which is `GtkPopoverBin`'s GObject name and also `HTMLElement`'s: the
     * DOM's Popover API spells a string attribute `popover`, and shadowing it with a widget
     * would make the element disagree with the platform it sits on. The `Element` suffix is
     * what this package already uses where a GIR name is taken (`childElement` below, and
     * `Adw.NavigationPage`'s own `navigationPage`).
     */
    get popoverElement(): GtkPopoverMenu | null {
        return this._popover;
    }

    set popoverElement(value: GtkPopoverMenu | null) {
        this._model = [];
        this._adoptPopover(value);
        this._notifyModel();
    }

    /** Whether a right click or a long press opens the popover. GTK's default is FALSE. */
    get handleInput(): boolean {
        return this.hasAttribute('handle-input');
    }

    set handleInput(value: boolean) {
        this.toggleAttribute('handle-input', !!value);
    }

    /** What the action group publishes about the actions the menu names (ADR 0042). */
    get actions(): AdwMenuActions | null {
        return this._actions;
    }

    set actions(value: AdwMenuActions | null) {
        this._actions = value ?? null;
        if (this._popover !== null) this._popover.actions = this._actions;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;
        // `gtk_widget_class_set_css_name (widget_class, "popoverbin")` (gtkpopoverbin.c:382).
        this.classList.add('adw-popover-bin');
        this.addEventListener('contextmenu', (event) => this._onContextMenu(event));
        this.addEventListener('keydown', (event) => this._onKeyDown(event));
        this._wireGestures();
        if (this._model.length === 0) this._model = this._parseMenuAttr();
        if (this._model.length > 0) this._adoptPopover(this._buildPopover());
    }

    disconnectedCallback() {
        this._cancelLongPress();
    }

    attributeChangedCallback(name?: string) {
        if (!this._initialized) return;
        if (name === 'handle-input') {
            // `set_handle_input` adds the click gesture, the touch-only long press AND the
            // Menu key shortcut when it turns on, and removes all three when it turns off
            // (gtkpopoverbin.c:624-672). Two of the three are listeners this element owns,
            // so the flag gates them rather than the flag changing anything else.
            if (!this.handleInput) this._cancelLongPress();
            return;
        }
        if (name === 'menu-model') {
            this._model = this._parseMenuAttr();
            this._adoptPopover(this._model.length > 0 ? this._buildPopover() : null);
            this._notifyModel();
        }
    }

    /** The `menu.popup` action — present the popover. */
    popup(): void {
        this.dispatchEvent(new CustomEvent('menu.popup', { bubbles: true }));
        const popover = this._popover;
        if (popover !== null) popover.open = true;
    }

    /** Dismiss the popover. */
    popdown(): void {
        this._popover?.popdown();
    }

    /** The widget whose `.has-open-popup` follows the popover, when the bin has one. */
    get childElement(): HTMLElement | null {
        const first = this.firstElementChild;
        if (first === null || first === this._popover) return null;
        return first as HTMLElement;
    }

    // --- the gesture pair (gtkpopoverbin.c:156-189) -----------------------------
    //
    // A plain left click must reach the child, so the handler DENIES everything it does not
    // claim — `gtk_gesture_set_state (gesture, GTK_EVENT_SEQUENCE_DENIED)`. In the DOM that
    // is "do nothing": there is no claim to make, and `contextmenu` is a separate event the
    // browser only fires for the gesture GTK's check recognises.
    private _wireGestures(): void {
        this.addEventListener('pointerdown', (event) => {
            if (!this.handleInput || this._popover === null) return;
            // `pressed_cb` only claims when `gdk_event_triggers_context_menu`, which is the
            // SECOND button on Linux and ctrl-click on macOS. In the browser that is the
            // `contextmenu` event below, so here the long press is all that is left.
            this._cancelLongPress();
            if (event.pointerType !== 'touch') return;
            this._longPressTimer = setTimeout(() => {
                this._longPressTimer = null;
                // `long_pressed_cb` claims and pops at the pointer (:178-187).
                this._popupAt(event);
            }, LONG_PRESS_MS);
        });
        this.addEventListener('pointerup', () => this._cancelLongPress());
        this.addEventListener('pointercancel', () => this._cancelLongPress());
    }

    private _cancelLongPress(): void {
        if (this._longPressTimer === null) return;
        clearTimeout(this._longPressTimer);
        this._longPressTimer = null;
    }

    private _onContextMenu(event: Event): void {
        if (!this.handleInput || this._popover === null) return;
        // `gtk_gesture_set_state (…, CLAIMED)` + `gtk_event_controller_reset` (:170-175):
        // the context menu event is consumed here, so the browser's own menu stays away.
        event.preventDefault();
        this._popupAt(event as MouseEvent);
    }

    /**
     * `popup_at_position` WITH the pointer's coordinates, which is the branch that sets
     * `pointing-to` to `(x, y)` (gtkpopoverbin.c:141-145). `<gtk-popover>` has no
     * `pointing-to` to set — placement is the `position`/`align` pair, the same gap the
     * element's own KNOWN_GAPS records — so the call is the plain `popup()` and what the
     * reader sees is GTK's: the menu under the child.
     */
    private _popupAt(_event: MouseEvent): void {
        const popover = this._popover;
        if (popover !== null) popover.open = true;
    }

    /**
     * The Menu key, which is the shortcut GTK installs next to the gestures
     * (`gtk_shortcut_trigger_create_for_menu`, gtkpopoverbin.c:643-649). GTK builds the
     * trigger in the platform's canonical form, which a keydown cannot carry, so the
     * un-modified key beside Shift is the whole binding here.
     */
    private _onKeyDown(event: KeyboardEvent): void {
        if (event.key !== 'ContextMenu' && event.key !== 'F10') return;
        if (event.shiftKey) return;
        if (this._popover === null) return;
        event.preventDefault();
        this.popup();
    }

    private _buildPopover(): GtkPopoverMenu | null {
        if (this._model.length === 0) return null;
        const popover = document.createElement('gtk-popover-menu') as GtkPopoverMenu;
        // `gtk_popover_set_position (popover, GTK_POS_BOTTOM)` in the same function
        // (gtkpopoverbin.c:493), on a popover `gtk_popover_menu_new_from_model` made.
        popover.setAttribute('position', 'bottom');
        popover.setAttribute('align', 'start');
        popover.menuModel = this._model;
        popover.actions = this._actions;
        popover.anchor = this;
        return popover;
    }

    /**
     * `set_popover` (gtkpopoverbin.c:543-587): hide and unparent the old one, parent the
     * new one, and wire the map/unmap handlers that carry `.has-open-popup` on the child.
     */
    private _adoptPopover(next: GtkPopoverMenu | null): void {
        const previous = this._popover;
        if (previous !== null && previous !== next) {
            previous.popdown();
            previous.remove();
        }
        this._popover = next;
        const child = this.childElement;
        if (next === null) {
            child?.classList.remove('has-open-popup');
            return;
        }
        next.subscribe((open) => {
            // `on_popover_map` / `on_popover_unmap` (:117-126). The class is what libadwaita
            // styles to say WHICH row opened the popup (`_lists.scss:57`), so it belongs to
            // the child and not to the bin.
            child?.classList.toggle('has-open-popup', open);
        });
        this.appendChild(next);
    }

    /**
     * `g_object_notify_by_pspec` is called for `:popover` AND `:menu-model` by BOTH setters
     * (gtkpopoverbin.c:502, :586-587), because the two are one slot. One event carrying
     * both is the faithful reading, and the second notify GTK sends separately has no state
     * of its own to report.
     */
    private _notifyModel(): void {
        this.dispatchEvent(
            new CustomEvent('notify::menu-model', {
                bubbles: true,
                detail: { menuModel: this._model, popover: this._popover },
            }),
        );
    }

    /**
     * The `menu-model` ATTRIBUTE through the core parser, refusing a `custom` item the way
     * every menu-bearing surface here does: markup is parsed by the browser, so a throw from
     * `connectedCallback` would reach nobody and the menu would be silently empty.
     */
    private _parseMenuAttr(): AdwMenuModel {
        const model = normalizeMenuModel(parseMenuModel(this.getAttribute('menu-model')));
        const refusals = menuRefusals(model, ADW_MENU_SURFACE_WEB);
        if (refusals.length === 0) return model;
        console.error(`${ADW_MENU_SURFACE_WEB.name} cannot render this menu, so it has none:`);
        for (const refusal of refusals) console.error(`  [${refusal.path.join('.')}] ${refusal.message}`);
        return [];
    }
}

customElements.define('gtk-popover-bin', GtkPopoverBin);
