// <adw-preferences-group> — Groups child rows in a boxed list with a title,
// an optional dimmed description line and an optional trailing header-suffix
// widget (e.g. a flat "Sign out" button at the trailing edge of the header).
// Attributes: title, description.
// Property: description (get/set, proxies the attribute).
// Header-suffix: any child carrying `slot="header-suffix"` is hoisted into the
//   trailing edge of the header instead of the boxed list — mirroring
//   Adw.PreferencesGroup's `header-suffix` property / buildable type.
// Reference: refs/libadwaita/src/adw-preferences-group.ui (header_box layout)
// Reference: refs/adwaita-web/adwaita-web/scss/_preferences.scss
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web;
//   description line + header-suffix slot added to match Adw.PreferencesGroup.

export class AdwPreferencesGroup extends HTMLElement {
    private _titleEl!: HTMLSpanElement;
    private _descriptionEl!: HTMLSpanElement;
    private _suffixEl!: HTMLDivElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'description'];
    }

    get description(): string {
        return this.getAttribute('description') ?? '';
    }

    set description(value: string) {
        if (value) this.setAttribute('description', value);
        else this.removeAttribute('description');
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        const children = Array.from(this.childNodes);
        // Children opting into the header-suffix slot are hoisted to the
        // trailing edge of the header; everything else goes into the boxed list.
        const suffixChildren = children.filter(
            (child) => child instanceof Element && child.getAttribute('slot') === 'header-suffix',
        );
        const rowChildren = children.filter((child) => !suffixChildren.includes(child));

        // Header: a flex row with a title/description label column on the left
        // and the optional header-suffix on the trailing edge.
        const header = document.createElement('div');
        header.className = 'adw-preferences-group-header';

        const labels = document.createElement('div');
        labels.className = 'adw-preferences-group-labels';

        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-preferences-group-title';

        this._descriptionEl = document.createElement('span');
        this._descriptionEl.className = 'adw-preferences-group-description';

        labels.append(this._titleEl, this._descriptionEl);

        this._suffixEl = document.createElement('div');
        this._suffixEl.className = 'adw-preferences-group-suffix';
        suffixChildren.forEach((child) => this._suffixEl.appendChild(child));

        header.append(labels, this._suffixEl);

        // Boxed list container — the remaining children move into it.
        const listbox = document.createElement('div');
        listbox.className = 'adw-preferences-group-listbox';
        rowChildren.forEach((child) => listbox.appendChild(child));

        this.replaceChildren(header, listbox);

        this._renderHeader();
    }

    attributeChangedCallback() {
        if (this._initialized) this._renderHeader();
    }

    private _renderHeader() {
        const title = this.getAttribute('title') ?? '';
        this._titleEl.textContent = title;
        this._titleEl.hidden = title.length === 0;

        const description = this.getAttribute('description') ?? '';
        this._descriptionEl.textContent = description;
        this._descriptionEl.hidden = description.length === 0;

        // The header only takes space when it carries a title, a description or
        // a suffix — an empty group has no header padding, like Adw's.
        const hasSuffix = this._suffixEl.childElementCount > 0;
        const headerEl = this._titleEl.parentElement?.parentElement;
        if (headerEl) headerEl.hidden = title.length === 0 && description.length === 0 && !hasSuffix;
    }
}

customElements.define('adw-preferences-group', AdwPreferencesGroup);
