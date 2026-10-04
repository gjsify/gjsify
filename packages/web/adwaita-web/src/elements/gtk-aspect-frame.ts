// <gtk-aspect-frame> — Gtk.AspectFrame: one child, given a shape and a place inside it.
//
// `ratio` is the width over the height of the CHILD, `xalign` / `yalign` say where that box
// sits in the space left over, and `obey-child` decides which ratio wins: TRUE — the pspec
// default (gtkaspectframe.c:180-183) — takes the ratio from the child's own natural size
// and IGNORES `ratio` (get_effective_ratio, gtkaspectframe.c:525-551). That default maps
// exactly, because a box with no `aspect-ratio` IS its own natural ratio; so the TRUE case
// writes no ratio at all rather than measuring the child and writing the answer back.
//
// THE ONE DIVERGENCE, and it is about WHICH AXIS BINDS. GTK sizes the child to
// `MIN (W, ratio * H)` on the inline axis and takes the block axis from that
// (gtkaspectframe.c:566-575). A CSS box has one definite axis and one the ratio derives, and
// a max constraint on the definite axis does not re-derive the other for a non-replaced
// element — so the child here FILLS the inline axis (`flex: 1 1 auto`, the growth
// `compute_child_allocation` does whether or not the child asks to expand) and its block axis
// follows the ratio, capped by `max-height`. That is GTK's answer whenever the WIDTH runs out
// first, which is every frame wider than `ratio * its height`; where the HEIGHT is the one
// that runs out, GTK narrows the child to `ratio * height` and this port draws a full-width
// box instead. Declared because it is visible, not because it is tidy.
//
// The two alignments move the child in what is left over (`x * (W - child_w)`,
// `y * (H - child_h)`, gtkaspectframe.c:576-577), which after the axis above is the same
// narrow case GTK itself has. Between the three zones they take the house's THREE-ZONE
// mapping (adwaita-core's `labelYalignAlignItems`, which `<gtk-label>` reads for `yalign`):
// CSS has three `align-items` / `justify-content` keywords and no ratio.
//
// GTK's minimum size (gtkaspectframe.c:604-630, `MAX (min_w, ceil (min_h * ratio))`) needs
// no rule of its own: a box with an `aspect-ratio` already derives the minimum of the other
// axis from it, and CSS 2.1 §10.4 settles the other end — `min-width` wins over `max-width`,
// so a child that declares a minimum keeps it whatever cap `max-width` writes.
//
// A11Y: `role="generic"`, GtkAspectFrame's own accessible role (gtkaspectframe.c:195).
//
// Reference: refs/gtk/gtk/gtkaspectframe.c:153-195, :525-630
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { glibClamp, labelYalignAlignItems } from '@gjsify/adwaita-core';

import { bindSlottedChildren } from '../slotted-children.js';

/** `Gtk.AspectFrame:ratio`'s pspec range and default (gtkaspectframe.c:124-125, :172-175). */
const RATIO_MIN = 0.0001;
const RATIO_MAX = 10000;
const RATIO_DEFAULT = 1.0;

/** `xalign` / `yalign` are held in 0…1 with `0.5` as their default (gtkaspectframe.c:153-163). */
const ALIGN_DEFAULT = 0.5;

function normalizeAlign(value: string | null): number {
    const parsed = Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? glibClamp(parsed, 0, 1) : ALIGN_DEFAULT;
}

/** `Gtk.AspectFrame:ratio`, clamped to the pspec's range; unparseable is the default. */
function normalizeRatio(value: string | null): number {
    const parsed = Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? glibClamp(parsed, RATIO_MIN, RATIO_MAX) : RATIO_DEFAULT;
}

export class GtkAspectFrame extends HTMLElement {
    static get observedAttributes() {
        return ['ratio', 'xalign', 'yalign', 'obey-child'];
    }

    /** `Gtk.AspectFrame:ratio` — the width/height of the child. Ignored under `obey-child`. */
    get ratio(): number {
        return normalizeRatio(this.getAttribute('ratio'));
    }

    set ratio(value: number) {
        this.setAttribute('ratio', String(value));
    }

    /** `Gtk.AspectFrame:xalign` — where the child sits horizontally. `0.5` is the centre. */
    get xalign(): number {
        return normalizeAlign(this.getAttribute('xalign'));
    }

    set xalign(value: number) {
        this.setAttribute('xalign', String(value));
    }

    /** `Gtk.AspectFrame:yalign` — where the child sits vertically. `0.5` is the centre. */
    get yalign(): number {
        return normalizeAlign(this.getAttribute('yalign'));
    }

    set yalign(value: number) {
        this.setAttribute('yalign', String(value));
    }

    /**
     * `Gtk.AspectFrame:obey-child` — TRUE (the pspec default, and therefore the ABSENCE of
     * the attribute) takes the ratio from the child and ignores `ratio`. Spelled as
     * `obey-child="false"` rather than as an inverted attribute, because the default is the
     * affirmative one and every other boolean on every other element here means "present".
     */
    get obeyChild(): boolean {
        const raw = this.getAttribute('obey-child');
        return raw === null || (raw !== 'false' && raw !== '0');
    }

    set obeyChild(value: boolean) {
        if (value) this.setAttribute('obey-child', 'true');
        else this.setAttribute('obey-child', 'false');
    }

    /** `Gtk.AspectFrame:child` — the single widget the frame shapes. */
    get child(): HTMLElement | null {
        return (this.firstElementChild as HTMLElement | null) ?? null;
    }

    set child(value: HTMLElement | null) {
        if (this.firstElementChild !== null) this.firstElementChild.remove();
        if (value !== null) this.append(value);
        // The new child needs the shape written onto it, which is all this widget does.
        this._sync();
    }

    connectedCallback() {
        bindSlottedChildren(this, [{ name: 'child', into: this }]);
        this.setAttribute('role', 'generic');
        this._sync();
    }

    attributeChangedCallback(name: string, old: string | null, value: string | null) {
        this._sync();
        if (!this.isConnected) return;
        const next = this._normalized(name, value);
        if (next === this._normalized(name, old)) return;
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: next } }));
    }

    private _normalized(name: string, raw: string | null): number | boolean {
        if (name === 'ratio') return normalizeRatio(raw);
        if (name === 'xalign' || name === 'yalign') return normalizeAlign(raw);
        return raw !== null && raw !== 'false' && raw !== '0';
    }

    private _sync(): void {
        const child = this.child;
        if (child === null) return;
        const shape = child.style;
        // The child's own box, written because GTK writes the allocation on the CHILD.
        if (this.obeyChild) shape.removeProperty('aspect-ratio');
        else shape.aspectRatio = String(this.ratio);
        // `flex: 1 1 auto` is the growth `compute_child_allocation` does unconditionally:
        // the child takes as much of the frame as the ratio lets it, whether or not it asks
        // to expand — which is the whole point of the widget, and why the ratio rather than
        // `hexpand` is what decides its size.
        shape.flex = '1 1 auto';
        shape.maxWidth = '100%';
        shape.maxHeight = '100%';
        this.style.justifyContent = labelYalignAlignItems(this.xalign);
        this.style.alignItems = labelYalignAlignItems(this.yalign);
    }
}

customElements.define('gtk-aspect-frame', GtkAspectFrame);
