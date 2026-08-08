// <adw-button-row> — A boxed-list row that behaves like a button: a centered
// title between an optional start icon and an optional end icon, spanning the
// full width of the list. The `suggested-action` / `destructive-action` style
// classes recolor it like the matching Adwaita button variants.
// Attributes: title, start-icon-name, end-icon-name (symbolic names, e.g.
//   "list-add" / "go-next").
// Events: `activated` (CustomEvent, bubbles) when the row is clicked — mirrors
//   the Adw.ButtonRow `activated` GObject signal.
//
// The label/icon visibility rules are HEADLESS and live in
// `@gjsify/adwaita-core` (ADR 0004) as {@link ButtonRowState}; this element
// composes it and keeps only the DOM render half.
// `@gjsify/adwaita-nativescript` composes the same state, so both ports share one
// behaviour. Two things this fixes, both from adw-button-row.c:
//   - `end-icon-name` (C:213-223, bound at adw-button-row.ui:52-65) exists since
//     libadwaita 1.6 and neither renderer had it, so the trailing-chevron shape
//     the property exists for could not be expressed.
//   - THERE IS NO `activatable` OPT-OUT. `<property name="activatable">True
//     </property>` is in the template (adw-button-row.ui:5), the class docs say
//     "AdwButtonRow is always activatable." (C:31), and the whole public surface
//     (C:270-352) is `new` plus the two icon-name pairs. This element used to
//     honour an invented `activatable="false"`, which also gave the same markup
//     two opposite meanings inside one package — `<adw-action-row>` reads
//     `activatable` by PRESENCE, so `activatable="false"` there meant TRUE.
//
// Reference: refs/libadwaita/src/adw-button-row.c, adw-button-row.ui
// Reference: refs/libadwaita/src/stylesheet/widgets/_lists.scss (row.button)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// label/icon state composed from @gjsify/adwaita-core.

import { BUTTON_ROW_ACTIVATABLE, ButtonRowState } from '@gjsify/adwaita-core';

export class AdwButtonRow extends HTMLElement {
    private _contentsEl!: HTMLDivElement;
    private _startIconEl!: HTMLSpanElement;
    private _endIconEl!: HTMLSpanElement;
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

        this._startIconEl = document.createElement('span');
        this._startIconEl.setAttribute('aria-hidden', 'true');

        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-button-row-title';

        this._endIconEl = document.createElement('span');
        this._endIconEl.setAttribute('aria-hidden', 'true');

        this._contentsEl.append(this._startIconEl, this._titleEl, this._endIconEl);
        this.replaceChildren(this._contentsEl);

        this._initialized = true;
        this._render();

        this.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('activated', { bubbles: true }));
        });
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

        this._paintIcon(this._startIconEl, state.startIconName, state.startIconVisible, 'start');
        this._paintIcon(this._endIconEl, state.endIconName, state.endIconVisible, 'end');

        // Unconditional: an AdwButtonRow has no way to not be activatable.
        this.classList.toggle('activatable', BUTTON_ROW_ACTIVATABLE);
    }

    /** Paint one of the two `image.icon.{start,end}` nodes (adw-button-row.c:39-40). */
    private _paintIcon(el: HTMLSpanElement, iconName: string, visible: boolean, position: 'start' | 'end') {
        el.className = visible ? `adw-icon adw-icon--${iconName} ${position}` : '';
        el.hidden = !visible;
    }
}

customElements.define('adw-button-row', AdwButtonRow);
