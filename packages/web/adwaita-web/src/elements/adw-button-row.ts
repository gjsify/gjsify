// <adw-button-row> — a boxed-list row that behaves like a button: a centred title between
// an optional start and end icon, spanning the full width of the list. The
// `suggested-action` / `destructive-action` style classes recolour it like the matching
// Adwaita button variants, and `activated` (CustomEvent, bubbles) mirrors the
// Adw.ButtonRow GObject signal.
//
// The label/icon visibility rules are HEADLESS and live in `@gjsify/adwaita-core`
// (ADR 0004) as {@link ButtonRowState}; this element keeps only the DOM render half.
//
// THERE IS NO `activatable` OPT-OUT, and inventing one would be wrong twice over: the
// upstream template hardcodes `activatable=True` and the class docs say "AdwButtonRow is
// always activatable", while `<adw-action-row>` in this same package reads `activatable`
// by PRESENCE — so `activatable="false"` means TRUE there, and one spelling would carry
// two opposite meanings.
//
// Reference: refs/libadwaita/src/adw-button-row.c, adw-button-row.ui
// Reference: refs/libadwaita/src/stylesheet/widgets/_lists.scss (row.button)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// label/icon state composed from @gjsify/adwaita-core.

import { BUTTON_ROW_ACTIVATABLE, ButtonRowState } from '@gjsify/adwaita-core';

import { type GtkImage, createGtkImage } from './gtk-image.js';
import { attachRowActivation } from './row-activation.js';

export class AdwButtonRow extends HTMLElement {
    private _contentsEl!: HTMLDivElement;
    private _startIconEl!: GtkImage;
    private _endIconEl!: GtkImage;
    private _titleEl!: HTMLSpanElement;
    /** The headless title + start/end icon state (ADR 0004). */
    private readonly _state = new ButtonRowState();
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'start-icon-name', 'end-icon-name'];
    }

    connectedCallback() {
        if (this._initialized) return;

        this._contentsEl = document.createElement('div');
        this._contentsEl.className = 'adw-button-row-contents';

        this._startIconEl = createGtkImage(null, 'start');

        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-button-row-title';

        this._endIconEl = createGtkImage(null, 'end');

        this._contentsEl.append(this._startIconEl, this._titleEl, this._endIconEl);
        this.replaceChildren(this._contentsEl);

        this._initialized = true;
        this._render();

        this.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('activated', { bubbles: true }));
        });
        // `BUTTON_ROW_ACTIVATABLE`, not an attribute read: there is no opt-out to read.
        attachRowActivation({ row: this, activatable: () => BUTTON_ROW_ACTIVATABLE });
    }

    attributeChangedCallback() {
        if (this._initialized) this._render();
    }

    private _render() {
        this._state.setTitle(this.getAttribute('title'));
        this._state.setStartIconName(this.getAttribute('start-icon-name'));
        this._state.setEndIconName(this.getAttribute('end-icon-name'));
        const state = this._state.state;

        this._titleEl.textContent = state.title;
        this._titleEl.hidden = !state.titleVisible;

        this._paintIcon(this._startIconEl, state.startIconName, state.startIconVisible);
        this._paintIcon(this._endIconEl, state.endIconName, state.endIconVisible);

        // Unconditional: an AdwButtonRow has no way to not be activatable.
        this.classList.toggle('activatable', BUTTON_ROW_ACTIVATABLE);
    }

    /**
     * Paint one of the two `image.icon.{start,end}` nodes.
     *
     * The `start` / `end` position class is set once at construction — it is
     * where the node sits, not what it draws — so only the name changes here.
     */
    private _paintIcon(el: GtkImage, iconName: string, visible: boolean) {
        el.iconName = visible ? iconName : null;
        el.hidden = !visible;
    }
}

customElements.define('adw-button-row', AdwButtonRow);
