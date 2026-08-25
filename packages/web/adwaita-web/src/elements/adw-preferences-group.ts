// <adw-preferences-group> — groups child rows in a boxed list with a title, an
// optional dimmed description line and an optional trailing header-suffix widget.
//
// Any child carrying `slot="header-suffix"` is hoisted into the trailing edge of the
// header instead of the boxed list, mirroring Adw.PreferencesGroup's `header-suffix`
// property / buildable type.
//
// The five visibility states (title, description, header, `single-line`, listbox) are
// NOT derived here: they come from `derivePreferencesGroupHeader` in
// `@gjsify/adwaita-core`, which this element and the NativeScript group both delegate
// to (ADR 0004).
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

import { bindSlottedChildren } from '../slotted-children.js';

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
    /**
     * Watches the two BOXES, not the host: the routing of a host child is
     * `src/slotted-children.ts`'s job now, and what is left here is the header derivation,
     * whose inputs are the row count and whether a suffix exists. A removal straight out of
     * the listbox changes both and reaches no other callback.
     */
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
     * `adw_preferences_group_add`: a row goes into the boxed list, a `header-suffix`
     * child into the header.
     *
     * Kept as a method as well as a slot, because both spellings occur —
     * `group.addRow(row)` in code, `group.append(row)` from a framework's rendering — and a
     * bare child of the host would sit outside the card, invisible to the row count that
     * decides whether the card is painted at all. The `append` spelling is routed by
     * `src/slotted-children.ts`, which every other slotted element now shares.
     */
    addRow(child: Node): void {
        if (isHeaderSuffix(child)) this._suffixEl.appendChild(child);
        else this._listboxEl.appendChild(child);
        this._renderHeader();
    }

    /**
     * `adw_preferences_group_remove`. C logs `ADW_CRITICAL_CANNOT_REMOVE_CHILD` and
     * no-ops for a child it does not own; returning `false` is the same contract
     * without a console write.
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
            this._observeBoxes();
            return;
        }
        this._initialized = true;

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

        this._headerEl.append(labels, this._suffixEl);

        this._listboxEl = document.createElement('div');
        this._listboxEl.className = 'adw-preferences-group-listbox';

        bindSlottedChildren(
            this,
            [{ name: 'header-suffix', into: this._suffixEl }, { into: this._listboxEl }],
            // Redundant while this group is connected — the listbox record covers it — and
            // the only thing that covers it while it is DETACHED, where `_observeBoxes` is
            // deliberately off. A row appended to a parked group must be right when it
            // comes back, not one derivation behind.
            () => this._renderHeader(),
        ).install(this._headerEl, this._listboxEl);
        // adw-preferences-group.c:319 — GTK_ACCESSIBLE_ROLE_GROUP. A GROUP, not a list:
        // that is why the rows inside carry no `listitem` role, which outside a list
        // would be worse than none.
        this.setAttribute('role', 'group');

        this._observeBoxes();
    }

    disconnectedCallback() {
        // The observer holds this element alive through the boxes it watches; drop it
        // with the connection that created it, not at some later "cleanup".
        this._observer?.disconnect();
        this._observer = null;
    }

    attributeChangedCallback() {
        if (this._initialized) this._renderHeader();
    }

    /**
     * Re-derive the header whenever the two boxes change, in EITHER direction.
     *
     * C gets this for free: `gtk_widget_observe_children` on the listbox drives
     * `update_listbox_visibility` through `items-changed`. A DOM element needs the observer
     * for the same rule to hold over time rather than only at connect. Adoption is not what
     * this watches — a row appended to the host reaches the listbox through the shared slot
     * routing, and lands here as the listbox record it causes. A row REMOVED straight out
     * of the listbox reaches no other callback at all, and it still changes the row count.
     */
    private _observeBoxes(): void {
        if (this._observer) return;
        this._observer = new MutationObserver(() => this._renderHeader());
        this._observer.observe(this._listboxEl, { childList: true });
        // The suffix too: `hasHeaderSuffix` is an INPUT to the header derivation, so a
        // suffix appended after connect left the header hidden on a group with no title.
        this._observer.observe(this._suffixEl, { childList: true });
        // Arming and deriving are ONE act, as in `src/empty-sections.ts`: a group that was
        // parked, filled and re-attached would otherwise come back showing the header state
        // it had when it left.
        this._renderHeader();
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
            // The RAW child count, matching `gtk_widget_observe_children`: a row with an
            // empty title still keeps the card painted.
            rowCount: this._listboxEl.childElementCount,
            // The labels are `textContent`, not markup, so visibility must be judged on
            // the raw string. libadwaita's labels are `use-markup=True`, but rendering
            // Pango markup in the browser is a separate open gap — half-closing it here
            // would hide a title this element visibly renders.
            useMarkup: false,
        });

        this._titleEl.hidden = !state.titleVisible;
        this._descriptionEl.hidden = !state.descriptionVisible;
        this._headerEl.hidden = !state.headerVisible;
        // `single-line` is not cosmetic: the stylesheet keys the header's min-height and
        // margin-bottom off it.
        this._headerEl.classList.toggle('single-line', state.singleLine);
        this._listboxEl.hidden = !state.listboxVisible;
    }
}

customElements.define('adw-preferences-group', AdwPreferencesGroup);
