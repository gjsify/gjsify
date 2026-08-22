// <adw-status-page> — A centered empty/placeholder state: a large symbolic
// icon, a title, a description and an optional action (slotted child).
// Attributes: icon (symbolic name, with or without -symbolic), title, description.
// Reference: refs/adwaita-web/adwaita-web/scss/_status_page.scss
// Reference: refs/libadwaita/src/stylesheet/widgets/_misc.scss (AdwStatusPage)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// icon node is <adw-icon>.

import { stringIsNotEmpty } from '@gjsify/adwaita-core';

import { bindEmptySections } from '../empty-sections.js';
import { type AdwIcon, createAdwIcon } from './adw-icon.js';

export class AdwStatusPage extends HTMLElement {
    private _iconEl!: AdwIcon;
    private _titleEl!: HTMLSpanElement;
    private _descEl!: HTMLSpanElement;
    private _childEl!: HTMLDivElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['icon', 'title', 'description'];
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        const children = Array.from(this.childNodes);

        this._iconEl = createAdwIcon(null, 'adw-status-page-icon');

        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-status-page-title';

        this._descEl = document.createElement('span');
        this._descEl.className = 'adw-status-page-description';

        this._childEl = document.createElement('div');
        this._childEl.className = 'adw-status-page-child';
        for (const child of children) this._childEl.appendChild(child);

        this.replaceChildren(this._iconEl, this._titleEl, this._descEl, this._childEl);
        // `_render` only ever runs from `attributeChangedCallback`, which an action
        // appended into the child slot after connect does not trigger.
        bindEmptySections(this._childEl);
        this._render();
    }

    attributeChangedCallback() {
        if (this._initialized) this._render();
    }

    private _render() {
        // The element swaps the mask class and keeps the size class.
        this._iconEl.iconName = this.getAttribute('icon');
        // `has_image`: `paintable || (icon_name && icon_name[0])` — a name that was GIVEN
        // shows the image whether or not the theme can resolve it, and GTK draws
        // `image-missing` in it. Reading `resolvedIconName` instead hid the slot for every
        // name that is not one CSS token, a branch the C does not have.
        // Reference: refs/libadwaita/src/adw-status-page.c:88 (has_image), bound from
        //   `<binding name="visible">` in adw-status-page.ui:27-31.
        this._iconEl.hidden = !stringIsNotEmpty(this.getAttribute('icon'));

        // `string_is_not_empty` from the core, not a local `.length === 0`: the same
        // closure the NativeScript port binds its labels to, and the reason a title of
        // `'   '` stays VISIBLE — it reads the first byte, it never trims.
        const title = this.getAttribute('title') ?? '';
        this._titleEl.textContent = title;
        this._titleEl.hidden = !stringIsNotEmpty(title);

        const description = this.getAttribute('description') ?? '';
        this._descEl.textContent = description;
        this._descEl.hidden = !stringIsNotEmpty(description);
    }
}

customElements.define('adw-status-page', AdwStatusPage);
