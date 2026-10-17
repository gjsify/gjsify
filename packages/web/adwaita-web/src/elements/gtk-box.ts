// <gtk-box> — GTK's one-axis container: children in a row or a column, a fixed gap
// between them.
//
// NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034 clause 1): libadwaita ships no box,
// it styles what a caller puts in one. Without this element a Blueprint layout mounted
// through `mountSharedTree` realised every `Gtk.Box` as an unknown inline element, so a
// vertical stack of preference groups laid out as one run of inline boxes.
//
// NO CORE STATE MACHINE (ADR 0004, trivial behaviour): the stacking is flexbox's. What is
// shared is how an authored value becomes the property — `normalizeBoxSpacing` and
// `normalizeBoxOrientation` in `@gjsify/adwaita-core`, which the NativeScript `GtkBox`
// reads too. The gap is the flex `gap`, which is GTK's spacing exactly: between children
// only, never at the box's own edges.
//
// `homogeneous` gives every child an equal share along the axis (`flex: 1 1 0`, in
// `_box.scss`). A child's minimum still holds, as in `gtk_box_layout`'s homogeneous
// allocation, because flex never shrinks an item below its min-content size.
//
// Children are not moved or wrapped: the element IS the flex container, so a child in the
// light DOM is a child of the layout, which is what `gtk_box_append` means.
//
// EXPAND IS THE COMPUTED VALUE, not the attribute: GtkBoxLayout grows a child when
// `gtk_widget_compute_expand` says so (gtkboxlayout.c:391), and that is true for a bin whose
// descendant set `hexpand` too. `compute-expand.ts` computes it; the box writes it on each
// child that authored no value of its own as `data-computed-hexpand` / `-vexpand`, which
// `_widget.scss` grows like the attribute. A MutationObserver over the box's subtree is the
// substitute for `gtk_widget_queue_compute_expand`, which walks up from any widget whose
// expand or visibility changed — so a runtime reparent or a toggled `hexpand` deep inside a
// child lands one microtask later.
//
// Reference: refs/gtk/gtk/gtkbox.c (the three properties, the `box` CSS name)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { normalizeBoxOrientation, normalizeBoxSpacing, type BoxOrientation } from '@gjsify/adwaita-core';

import { computeExpand, explicitExpand, type ExpandOrientation } from '../compute-expand.js';

/** The attributes that carry a property — also the `notify::` roster. */
const PROPERTY_ATTRIBUTES = ['orientation', 'spacing', 'homogeneous'] as const;

/** The marker per axis a child carries while its computed expand is true. */
const COMPUTED_EXPAND: Record<ExpandOrientation, string> = {
    horizontal: 'data-computed-hexpand',
    vertical: 'data-computed-vexpand',
};

export class GtkBox extends HTMLElement {
    private _expandObserver: MutationObserver | null = null;

    static get observedAttributes() {
        return [...PROPERTY_ATTRIBUTES];
    }

    /** `GtkOrientable:orientation` — `horizontal` (the default) or `vertical`. */
    get orientation(): BoxOrientation {
        return normalizeBoxOrientation(this.getAttribute('orientation'));
    }

    set orientation(value: BoxOrientation) {
        this.setAttribute('orientation', value);
    }

    /** `Gtk.Box:spacing` — the gap between children, in px. Defaults to 0. */
    get spacing(): number {
        return normalizeBoxSpacing(this.getAttribute('spacing'));
    }

    set spacing(value: number) {
        this.setAttribute('spacing', String(value));
    }

    /** `Gtk.Box:homogeneous` — whether every child gets the same size along the axis. */
    get homogeneous(): boolean {
        return this.hasAttribute('homogeneous');
    }

    set homogeneous(value: boolean) {
        this.toggleAttribute('homogeneous', !!value);
    }

    connectedCallback() {
        this._sync();
        this._syncComputedExpand();
        if (this._expandObserver) return;
        this._expandObserver = new MutationObserver((records) => {
            if (records.some(affectsExpand)) this._syncComputedExpand();
        });
        this._expandObserver.observe(this, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['hexpand', 'vexpand', 'hidden'],
        });
    }

    disconnectedCallback() {
        this._expandObserver?.disconnect();
        this._expandObserver = null;
    }

    attributeChangedCallback(name: string, old: string | null, value: string | null) {
        this._sync();
        const next = this._normalized(name, value);
        if (next === this._normalized(name, old)) return;
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: next } }));
    }

    private _normalized(name: string, raw: string | null): string | number | boolean {
        if (name === 'orientation') return normalizeBoxOrientation(raw);
        if (name === 'spacing') return normalizeBoxSpacing(raw);
        return raw !== null;
    }

    private _sync(): void {
        // Inline, from the NORMALISED values, so an unknown nick or a negative spacing
        // lays out as the GTK default rather than whatever the raw attribute says.
        this.style.flexDirection = this.orientation === 'vertical' ? 'column' : 'row';
        this.style.gap = `${this.spacing}px`;
    }

    private _syncComputedExpand(): void {
        for (const child of this.children) {
            for (const orientation of ['horizontal', 'vertical'] as const) {
                const grows = explicitExpand(child, orientation) === undefined && computeExpand(child, orientation);
                child.toggleAttribute(COMPUTED_EXPAND[orientation], grows);
            }
        }
    }
}

/**
 * Text rewritten inside a label (a hex dump does it every frame) adds and removes only text
 * nodes; no widget came or went, so the computed expand cannot have changed.
 */
function affectsExpand(record: MutationRecord): boolean {
    if (record.type !== 'childList') return true;
    const isElement = (node: Node): boolean => node.nodeType === Node.ELEMENT_NODE;
    return [...record.addedNodes].some(isElement) || [...record.removedNodes].some(isElement);
}

customElements.define('gtk-box', GtkBox);
