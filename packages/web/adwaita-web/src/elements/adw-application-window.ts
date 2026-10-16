// <adw-application-window> — the web counterpart of Adw.ApplicationWindow: an
// AdwWindow that belongs to a GtkApplication, plus that application's menubar.
//
// WHAT ADDS UPSTREAM, measured: `Adw.ApplicationWindow` extends `GtkApplicationWindow`
// and adds nothing but its own `content` / `adaptive-preview` pair, which are
// AdwWindow's (Adw-1.gir, `parent="ApplicationWindow"`). The whole difference from
// <adw-window> is `Gtk.ApplicationWindow:show-menubar` — one boolean, and the window
// draws the menubar the GtkApplication installed in `Gtk.Application:menubar` when it
// is on, and no menubar at all when it is off.
//
// A BROWSER HAS NO GtkApplication, so the model is handed to the window instead of to
// an application that does not exist here. `menu-model` is the same portable menu value
// ADR 0042 gave `<gtk-menu-button>` and `<adw-split-button>` (a JSON array), and it is
// read through the same core parser, so one menu is written once. A menubar is a row of
// MENU LINKS, which is what `Adw.Application`'s menubar is documented to be, so a
// section is inlined and a bare item becomes a plain button — `flattenMenu` is the
// walk that decides both.
//
// Attributes:
//   show-menubar (boolean — Gtk.ApplicationWindow:show-menubar; the bar is drawn only
//     while this is set AND the model has something in it, exactly as GTK draws no bar
//     for an application that installed none)
//   menu-model   (the portable menu model, JSON — the stand-in for the model a
//     GtkApplication would own; the same value `<gtk-menu-button menu-model>` takes)
//
// Extends <gtk-application-window>, as Adw.ApplicationWindow extends Gtk.ApplicationWindow,
// so the Gtk.Window state members come with it. The content property, the size request, the
// breakpoints and the dialog bookkeeping are the same AdwWindowFeatures <adw-window> uses.
//
// Reference: refs/libadwaita/src/adw-application-window.c (the class adds no behaviour)
// Reference: Gtk-4.0.gir `Gtk.ApplicationWindow:show-menubar` ("If this property is true,
//   the window will display a menubar unless it is shown by the desktop shell")
// Copyright (c) 2021-2023 Alice Mikhaylenko / Purism SPC (libadwaita). LGPLv2.1+
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    flattenMenu,
    normalizeMenuModel,
    parseMenuModel,
    type AdwMenuInput,
    type AdwMenuModel,
} from '@gjsify/adwaita-core';

import type { AdwBreakpoint } from '@gjsify/adwaita-core';
import type { AdwSlot } from '../slotted-children.js';
import { AdwWindowFeatures } from './adw-window-features.js';
import { GtkApplicationWindow } from './gtk-application-window.js';

export class AdwApplicationWindow extends GtkApplicationWindow {
    private readonly _features = new AdwWindowFeatures(this);
    private _model: AdwMenuModel = [];
    private _menubarEl: HTMLDivElement | null = null;

    // The base's list BY NAME, not `super.observedAttributes`: `AdwPasswordEntryRow`
    // spells its spread this way and the attribute readers follow (`adwaita-elements.mjs`
    // resolves a `[...Base.observedAttributes]` spread across files, and reports a
    // `super` one as unreadable rather than as empty).
    static get observedAttributes(): string[] {
        return [
            ...GtkApplicationWindow.observedAttributes,
            'width',
            'height',
            'width-request',
            'height-request',
            'menu-model',
        ];
    }

    /** The content area — the Adw.Window:content property. */
    get contentArea(): HTMLDivElement {
        return this._content;
    }

    get content(): HTMLElement | null {
        return this._features.content;
    }

    set content(value: HTMLElement | null) {
        this._features.content = value;
    }

    get breakpoints(): readonly AdwBreakpoint[] {
        return this._features.breakpoints;
    }

    get currentBreakpoint(): AdwBreakpoint | null {
        return this._features.currentBreakpoint;
    }

    get dialogs(): readonly HTMLElement[] {
        return this._features.dialogs;
    }

    get visibleDialog(): HTMLElement | null {
        return this._features.visibleDialog;
    }

    addBreakpoint(condition: string): AdwBreakpoint {
        return this._features.addBreakpoint(condition);
    }

    /** Whether this window shows the application's menubar (Gtk.ApplicationWindow:show-menubar). */
    get showMenubar(): boolean {
        return this.hasAttribute('show-menubar');
    }

    set showMenubar(value: boolean) {
        if (value) this.setAttribute('show-menubar', '');
        else this.removeAttribute('show-menubar');
    }

    /** The menubar's model — what a GtkApplication would own here. */
    get menuModel(): AdwMenuModel {
        return this._model;
    }

    set menuModel(value: AdwMenuInput) {
        this._model = normalizeMenuModel(value);
        this._renderMenubar();
    }

    /** The menubar strip, or null before the window is connected. */
    get menubar(): HTMLDivElement | null {
        return this._menubarEl;
    }

    connectedCallback() {
        super.connectedCallback();
        this._features.adopt(this._content);
        // EVERY connect, not only the first — see `AdwWindowFeatures.bind`.
        this._features.bind();
    }

    disconnectedCallback() {
        this._features.release();
        super.disconnectedCallback();
    }

    attributeChangedCallback(name: string) {
        if (name === 'width' || name === 'height' || name === 'width-request' || name === 'height-request') {
            this.renderFrameSize();
            return;
        }
        super.attributeChangedCallback(name);
        // The attribute is the declarative form and it wins when it changes — the same
        // precedence `<gtk-menu-button>` gives `menu-model`, through the same parser.
        if (name === 'menu-model') {
            this._model = parseMenuModel(this.getAttribute('menu-model'));
            this._renderMenubar();
        }
    }

    /** `Adw.ApplicationWindow` has no titlebar of its own, like `Adw.Window`. */
    protected override hasTitlebar(): boolean {
        return false;
    }

    protected override strips(): Node[] {
        return [this._content];
    }

    protected override extraSlots(): AdwSlot[] {
        return [{ name: 'content', into: this._content }];
    }

    protected override renderFrameSize(): void {
        this._features.applySizeRequest();
    }

    /**
     * The menubar, INSIDE the content area rather than beside it.
     *
     * `bindSlottedChildren` watches the host and moves every child it does not claim
     * into the content area, so a sibling would be re-homed into it one tick later. The
     * content area's own children are not watched, so prepending here is stable — and
     * it is also where the bar belongs: above the toolbar view, inside the window box.
     * Replaces the base's observer: this bar is filled from the model, not from a slot,
     * and observing it would re-trigger every render.
     */
    protected override _followMenubar(): void {
        if (this._menubarEl === null) {
            this._menubarEl = document.createElement('div');
            this._menubarEl.className = 'adw-application-window-menubar';
            this._content.prepend(this._menubarEl);
        }
        this._renderMenubar();
    }

    protected override menubarSection(): HTMLDivElement {
        return this._menubarEl ?? super.menubarSection();
    }

    protected override _renderMenubar(): void {
        const bar = this._menubarEl;
        if (bar === null) return;

        bar.replaceChildren();
        // GTK draws no menubar for an application that installed none, so neither does
        // this: both the flag and a model with rows in it are required.
        bar.hidden = !this.showMenubar || this._model.length === 0;

        for (const row of flattenMenu(this._model)) {
            const node = row.node;
            if (node.kind === 'submenu') {
                // A link is a menu the user OPENS — a button with that menu on it,
                // which is the whole of what a Gtk.PopoverMenuBar row is.
                const button = document.createElement('gtk-menu-button');
                button.setAttribute('menu-title', node.label);
                (button as unknown as { menuModel: AdwMenuInput }).menuModel = node.items;
                bar.appendChild(button);
                continue;
            }
            // A bare item has no menu to open, so it is a button that activates it — and
            // it reports the activation the way every other menu surface here does
            // (`<gtk-menu-button>`, `<adw-split-button>`): the item's id, its label and
            // its PATH in the model.
            const button = document.createElement('gtk-button');
            button.setAttribute('label', node.label ?? '');
            button.setAttribute('flat', '');
            button.addEventListener('click', () => {
                this.dispatchEvent(
                    new CustomEvent('menu-item-activated', {
                        bubbles: true,
                        detail: { id: node.id ?? node.label, label: node.label, path: [...row.path] },
                    }),
                );
            });
            bar.appendChild(button);
        }
    }
}

customElements.define('adw-application-window', AdwApplicationWindow);
