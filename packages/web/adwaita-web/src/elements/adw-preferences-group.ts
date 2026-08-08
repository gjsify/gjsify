// <adw-preferences-group> — Groups child rows in a boxed list with a title,
// an optional dimmed description line and an optional trailing header-suffix
// widget (e.g. a flat "Sign out" button at the trailing edge of the header).
// Attributes: title, description.
// Property: description (get/set, proxies the attribute).
// Header-suffix: any child carrying `slot="header-suffix"` is hoisted into the
//   trailing edge of the header instead of the boxed list — mirroring
//   Adw.PreferencesGroup's `header-suffix` property / buildable type.
//
// The five visibility states (title, description, header, `single-line`,
// listbox) are NOT derived here: they come from
// `derivePreferencesGroupHeader` in `@gjsify/adwaita-core`, which both this
// element and the NativeScript group delegate to (ADR 0004). This element used
// to compute two of the five by hand and was missing the other three — no
// `single-line` class, and a `.boxed-list` card that stayed painted (with its
// full-width `box-shadow` hairline) over an empty group.
//
// Reference: refs/libadwaita/src/adw-preferences-group.c
//   (update_title_visibility, update_listbox_visibility, is_single_line,
//    update_header_visibility, adw_preferences_group_add)
// Reference: refs/libadwaita/src/adw-preferences-group.ui (header_box layout)
// Reference: refs/adwaita-web/adwaita-web/scss/_preferences.scss
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web;
//   description line + header-suffix slot added to match Adw.PreferencesGroup;
//   header/listbox state delegated to @gjsify/adwaita-core.

import { derivePreferencesGroupHeader } from '@gjsify/adwaita-core';

/** A child that asked to sit in the header rather than in the boxed list. */
function isHeaderSuffix(node: Node): boolean {
    return node instanceof Element && node.getAttribute('slot') === 'header-suffix';
}

export class AdwPreferencesGroup extends HTMLElement {
    private _headerEl!: HTMLDivElement;
    private _titleEl!: HTMLSpanElement;
    private _descriptionEl!: HTMLSpanElement;
    private _suffixEl!: HTMLDivElement;
    private _listboxEl!: HTMLDivElement;
    private _initialized = false;
    private _observer: MutationObserver | null = null;

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

    /**
     * `adw_preferences_group_add` (adw-preferences-group.c:396-411): a row goes
     * into the boxed list, a `header-suffix` child into the header.
     *
     * Exposed as a method AND wired to a `MutationObserver` on the host, because
     * both spellings occur: `group.addRow(row)` in code, `group.append(row)` in
     * a framework's rendering. Before this, a child appended after connect
     * stayed a bare child of the host — outside the card, and invisible to the
     * row count that decides whether the card is painted at all.
     */
    addRow(child: Node): void {
        if (isHeaderSuffix(child)) this._suffixEl.appendChild(child);
        else this._listboxEl.appendChild(child);
        this._renderHeader();
    }

    /**
     * `adw_preferences_group_remove` (:421-440). C logs
     * `ADW_CRITICAL_CANNOT_REMOVE_CHILD` and no-ops for a child it does not
     * own; returning `false` is the same contract without a console write.
     */
    removeRow(child: Node): boolean {
        const parent = child.parentNode;
        if (parent !== this._listboxEl && parent !== this._suffixEl) return false;
        parent.removeChild(child);
        this._renderHeader();
        return true;
    }

    connectedCallback() {
        if (this._initialized) {
            this._observeHost();
            return;
        }
        this._initialized = true;

        const children = Array.from(this.childNodes);
        // Children opting into the header-suffix slot are hoisted to the
        // trailing edge of the header; everything else goes into the boxed list.
        const suffixChildren = children.filter(isHeaderSuffix);
        const rowChildren = children.filter((child) => !suffixChildren.includes(child));

        // Header: a flex row with a title/description label column on the left
        // and the optional header-suffix on the trailing edge.
        this._headerEl = document.createElement('div');
        this._headerEl.className = 'adw-preferences-group-header';

        const labels = document.createElement('div');
        labels.className = 'adw-preferences-group-labels';

        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-preferences-group-title';

        this._descriptionEl = document.createElement('span');
        this._descriptionEl.className = 'adw-preferences-group-description';

        labels.append(this._titleEl, this._descriptionEl);

        this._suffixEl = document.createElement('div');
        this._suffixEl.className = 'adw-preferences-group-suffix';
        for (const child of suffixChildren) this._suffixEl.appendChild(child);

        this._headerEl.append(labels, this._suffixEl);

        // Boxed list container — the remaining children move into it.
        this._listboxEl = document.createElement('div');
        this._listboxEl.className = 'adw-preferences-group-listbox';
        for (const child of rowChildren) this._listboxEl.appendChild(child);

        this.replaceChildren(this._headerEl, this._listboxEl);

        this._renderHeader();
        this._observeHost();
    }

    disconnectedCallback() {
        // The observer holds this element alive through the host node; drop it
        // with the connection that created it, not at some later "cleanup".
        this._observer?.disconnect();
        this._observer = null;
    }

    attributeChangedCallback() {
        if (this._initialized) this._renderHeader();
    }

    /**
     * Adopt children appended to the HOST after the subtree was built, so
     * `group.append(row)` behaves like `adw_preferences_group_add`.
     *
     * C gets this for free — `gtk_widget_observe_children` on the listbox drives
     * `update_listbox_visibility` through `items-changed`
     * (adw-preferences-group.c:335-339) — and a DOM element needs the observer
     * to have the same rule hold over time rather than only at connect.
     */
    private _observeHost(): void {
        if (this._observer) return;
        this._observer = new MutationObserver((records) => {
            for (const record of records) {
                // Only the HOST's own children need re-homing. Records from the
                // listbox are the CONSEQUENCE of that move; re-adopting them
                // would append each row a second time and reorder the list.
                if (record.target !== this) continue;
                for (const node of record.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node === this._headerEl || node === this._listboxEl) continue;
                    this.addRow(node);
                }
            }
            // A removal straight out of the listbox still changes the row count.
            this._renderHeader();
        });
        this._observer.observe(this, { childList: true });
        this._observer.observe(this._listboxEl, { childList: true });
    }

    private _renderHeader() {
        const title = this.getAttribute('title') ?? '';
        const description = this.getAttribute('description') ?? '';

        this._titleEl.textContent = title;
        this._descriptionEl.textContent = description;

        const state = derivePreferencesGroupHeader({
            title,
            description,
            hasHeaderSuffix: this._suffixEl.childElementCount > 0,
            // The RAW child count, matching `gtk_widget_observe_children` — a
            // row with an empty title still keeps the card painted.
            rowCount: this._listboxEl.childElementCount,
            // The labels are `textContent`, not markup: what is displayed IS the
            // attribute value, so visibility must be judged on the raw string.
            // libadwaita's labels are `use-markup=True`; rendering Pango markup
            // in the browser is a separate, still-open gap, and half-closing it
            // here would hide a title this element visibly renders.
            useMarkup: false,
        });

        this._titleEl.hidden = !state.titleVisible;
        this._descriptionEl.hidden = !state.descriptionVisible;
        this._headerEl.hidden = !state.headerVisible;
        // `single-line` is not cosmetic: the stylesheet keys the header's
        // min-height / margin-bottom off it.
        this._headerEl.classList.toggle('single-line', state.singleLine);
        this._listboxEl.hidden = !state.listboxVisible;
    }
}

customElements.define('adw-preferences-group', AdwPreferencesGroup);
