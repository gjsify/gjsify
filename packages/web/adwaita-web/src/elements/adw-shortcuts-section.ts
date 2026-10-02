// <adw-shortcuts-section> — one titled group of shortcuts inside an
// <adw-shortcuts-dialog>: the browser counterpart of `AdwShortcutsSection`, which
// upstream is a plain `GObject` (`G_DEFINE_FINAL_TYPE_WITH_CODE (…, G_TYPE_OBJECT)`
// in adw-shortcuts-section.c:44) implementing `GtkBuildable` and `Gio.ListModel`.
// It has no look of its own — libadwaita draws it as a preferences GROUP inside the
// dialog's page, and every row is a `AdwShortcutsItem` (`.shortcut-row`, styled at
// _shortcuts-dialog.scss:16-27).
//
// A tag anyway, and that is the same shape `<adw-sidebar-item>` and `<adw-toggle>`
// are: a GObject that is not a GtkWidget has no tag in a table of concrete widgets,
// and the mark-up form of `GtkBuildable`'s add-child is the only way a document can
// declare one. `scripts/check-vocabulary-alignment.mjs` records that in
// `WEB_ELEMENT_ALIGNMENT`.
//
// Children are `<adw-shortcuts-item>` elements, and they stay LIVE: a shortcut added
// after connect lands in the section (`bindSlottedChildren`).
//
// Attributes:
//   title (AdwShortcutsSection:title — the heading; an untitled section is the
//     "subdivide a section into groups" case the class documents)
//
// Properties: `items` (the section's shortcuts, in document order).
//
// Reference: refs/libadwaita/src/adw-shortcuts-section.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_shortcuts-dialog.scss:1-14
// Copyright (c) 2025 GNOME Foundation Inc. (libadwaita). LGPLv2.1+
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { bindSlottedChildren } from '../slotted-children.js';

export class AdwShortcutsSection extends HTMLElement {
    private _initialized = false;
    private _bodyEl!: HTMLDivElement;
    private _titleEl!: HTMLElement;

    static get observedAttributes() {
        return ['title'];
    }

    /** The section title (AdwShortcutsSection:title). */
    get title(): string {
        return this.getAttribute('title') ?? '';
    }

    set title(value: string) {
        this.setAttribute('title', value);
    }

    /** The shortcuts in this section, in document order (AdwShortcutsSection:n-items' list). */
    get items(): readonly HTMLElement[] {
        return [...this._bodyEl.children] as HTMLElement[];
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._titleEl = document.createElement('div');
        this._titleEl.className = 'adw-shortcuts-section-title';

        this._bodyEl = document.createElement('div');
        this._bodyEl.className = 'adw-shortcuts-section-body';

        // A `Gio.ListModel` the section can also be read as, so the row list is a
        // container with a name rather than bare children.
        this.setAttribute('role', 'group');
        bindSlottedChildren(this, [{ into: this._bodyEl }]).install(this._titleEl, this._bodyEl);

        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'title') this._render();
    }

    private _render(): void {
        const title = this.title;
        // An untitled section is a legal thing to write: the class documents it as the
        // way to subdivide a section into groups, and libadwaita draws no heading for it.
        this._titleEl.textContent = title;
        this._titleEl.hidden = title.length === 0;
    }
}

customElements.define('adw-shortcuts-section', AdwShortcutsSection);
