// <gtk-center-box> — Gtk.CenterBox: three children, pinned to the start, the centre and
// the end, with whatever space is left over between them.
//
// THREE SLOTS AND TWO PROPERTIES. `start-widget`, `center-widget` and `end-widget` are
// WIDGET-valued, so on this renderer they are SLOTS (gtkcenterbox.c:285-321) and the
// element reads each child's `slot=` to learn which of the three it is — which also makes
// the markup order irrelevant, where GTK's is not: `gtk_center_box_set_start_widget()`
// unparents whatever held that slot first (gtkcenterbox.c:380-403).
//
// `shrink-center-last` is the interesting one, and its DEFAULT is TRUE (gtkcenterbox.c:
// 322-336). TRUE shrinks the start and end children first, each down to its own minimum,
// and only then the centre; FALSE reverses that. GTK expresses the order as a clamp chain
// (gtkcenterlayout.c:144-170: the centre is measured against `shrink_center_last`, then
// the start and end against what is left). CSS flexbox has no priority — only WEIGHTS —
// and its resolution loop freezes an item at its minimum size and redistributes the
// remaining violation among the rest (CSS Flexbox § 9.7), so a large weight on the widgets
// that shrink first reproduces the order exactly: they reach their minimum long before the
// other moves at all, and the last one then absorbs the whole remainder. 100 and 1 are that
// ratio, not a tuned constant.
//
// `baseline-position` says where a baseline-aligned child sits when the box has extra
// space. GTK's own default is the CENTRE position and every child's default `valign` is
// FILL, which is what the stylesheet's `align-items: stretch` already draws — so the
// attribute is read only when it is AUTHORED, and its three nicks map to the same three
// `align-items` zones `xalign` / `yalign` use in `<gtk-aspect-frame>`. A single-line flex
// container has nowhere to put a baseline line, so this is a DECLARED divergence, not an
// exact one.
//
// `gtk_center_box_set_layout_manager_type(GTK_TYPE_CENTER_LAYOUT)` plus the CSS name
// `box` (gtkcenterbox.c:344-345) mean the theme's `box` rule styles it — libadwaita ships
// no `box` rule at all, so the browser port draws no gap of its own and the spacing is
// whatever `gap` the author writes, exactly as a bare `Gtk.Box` with `spacing: 0` does.
//
// A11Y: `role="generic"`, GtkCenterBox's own accessible role (gtkcenterbox.c:346).
//
// Reference: refs/gtk/gtk/gtkcenterbox.c:267-346, :371-430
// Reference: refs/gtk/gtk/gtkcenterlayout.c:144-186
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { labelYalignAlignItems } from '@gjsify/adwaita-core';

import { bindSlottedChildren } from '../slotted-children.js';

/** `Gtk.BaselinePosition`'s three nicks, in the order GTK measures them (gtkcenterbox.c:267-271). */
const BASELINE_POSITIONS = { top: 0, center: 0.5, bottom: 1 } as const;

export type BaselinePosition = keyof typeof BASELINE_POSITIONS;

/** The weight split `shrink-center-last` is a ratio of; the ORDER is what carries it. */
const SHRINK_FIRST = 100;
const SHRINK_LAST = 1;

export class GtkCenterBox extends HTMLElement {
    static get observedAttributes() {
        return ['baseline-position', 'shrink-center-last'];
    }

    /**
     * `Gtk.CenterBox:baseline-position` — `top`, `center` (the pspec default) or `bottom`.
     * An unknown nick is the default, the same answer an enum nick GTK does not know gets.
     */
    get baselinePosition(): BaselinePosition {
        const raw = this.getAttribute('baseline-position');
        return raw !== null && raw in BASELINE_POSITIONS ? (raw as BaselinePosition) : 'center';
    }

    set baselinePosition(value: BaselinePosition) {
        this.setAttribute('baseline-position', value);
    }

    /**
     * `Gtk.CenterBox:shrink-center-last` — TRUE (the pspec default, gtkcenterbox.c:330-333)
     * shrinks the start and end children before the centre; FALSE shrinks the centre first.
     * The default is the AFFIRMATIVE one, so it is the ABSENCE of the attribute — a bare
     * `<gtk-center-box>` is a TRUE box, and `shrink-center-last="false"` is what turns it off.
     */
    get shrinkCenterLast(): boolean {
        const raw = this.getAttribute('shrink-center-last');
        return raw === null || (raw !== 'false' && raw !== '0');
    }

    set shrinkCenterLast(value: boolean) {
        if (value) this.removeAttribute('shrink-center-last');
        else this.setAttribute('shrink-center-last', 'false');
    }

    /** `Gtk.CenterBox:start-widget` — the child pinned to the start. */
    get startWidget(): HTMLElement | null {
        return this.querySelector<HTMLElement>('[slot="start-widget"]');
    }

    set startWidget(value: HTMLElement | null) {
        this._assign('start-widget', value);
    }

    /** `Gtk.CenterBox:center-widget` — the child that takes the space between the other two. */
    get centerWidget(): HTMLElement | null {
        return this.querySelector<HTMLElement>('[slot="center-widget"]');
    }

    set centerWidget(value: HTMLElement | null) {
        this._assign('center-widget', value);
    }

    /** `Gtk.CenterBox:end-widget` — the child pinned to the end. */
    get endWidget(): HTMLElement | null {
        return this.querySelector<HTMLElement>('[slot="end-widget"]');
    }

    set endWidget(value: HTMLElement | null) {
        this._assign('end-widget', value);
    }

    connectedCallback() {
        // The three NAMES, so an authored tree may address them. Nothing is MOVED: the box
        // places its children by their `slot=`, so the author's order is not the layout's,
        // and moving them would only fight a renderer that appends them back.
        bindSlottedChildren(this, [
            { name: 'start-widget', into: this },
            { name: 'center-widget', into: this },
            { name: 'end-widget', into: this },
        ]);
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

    private _normalized(name: string, raw: string | null): boolean | string {
        if (name === 'shrink-center-last') return raw === null || (raw !== 'false' && raw !== '0');
        return raw !== null && raw in BASELINE_POSITIONS ? raw : 'center';
    }

    private _assign(slot: string, value: HTMLElement | null): void {
        const current = this.querySelector(`[slot="${slot}"]`);
        if (current !== null) {
            current.removeAttribute('slot');
            // `set_start_widget(NULL)` UNPARENTS the child (gtkcenterbox.c:391-393), and an
            // element left behind as an unnamed one would be a fourth slot this widget does
            // not have — GtkCenterBox's buildable refuses an untyped child (gtkcenterbox.c:110-135).
            current.remove();
        }
        if (value !== null) {
            value.setAttribute('slot', slot);
            this.append(value);
        }
        // The new child needs its shrink weight, which `_sync` reads off the slot names.
        this._sync();
    }

    private _sync(): void {
        const centerShrinksLast = this.shrinkCenterLast;
        for (const child of this.children) {
            const role = child.getAttribute('slot');
            // An unnamed child is not one of the three slots — GtkCenterBox's buildable
            // refuses an untyped child (gtkcenterbox.c:110-135) — so it takes the weight of a
            // widget that shrinks LAST and keeps whatever position the author gave it.
            const shrinksFirst =
                role === 'center-widget'
                    ? !centerShrinksLast
                    : role === 'start-widget' || role === 'end-widget'
                      ? centerShrinksLast
                      : false;
            (child as HTMLElement).style.flexShrink = String(shrinksFirst ? SHRINK_FIRST : SHRINK_LAST);
        }
        // Only when AUTHORED: GTK's default position is `center` and a box of FILL children
        // already draws stretched, which is the stylesheet's `align-items`. Writing it
        // unconditionally would make the default position change the default look.
        if (this.hasAttribute('baseline-position')) {
            this.style.alignItems = labelYalignAlignItems(BASELINE_POSITIONS[this.baselinePosition]);
        } else {
            this.style.removeProperty('align-items');
        }
    }
}

customElements.define('gtk-center-box', GtkCenterBox);
