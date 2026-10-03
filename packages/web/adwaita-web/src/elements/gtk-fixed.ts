// <gtk-fixed> — Gtk.Fixed: children at pixel positions, and nothing else.
//
// NO PROPERTIES AT ALL, which is the shape of the widget: `Gtk.Fixed` declares none in the
// GIR because every child carries its own, and `gtk_fixed_put(child, x, y)` is the whole
// API (gtkfixed.c:213-240). So the markup form of a position is the CHILD's own CSS
// offset — `style="left:20px;top:10px"`, which is what `put()` writes and what it reads
// back — and `put()` / `move()` are here as the imperative route, so a caller that has the
// child in hand does not have to spell a string.
//
// `gtk_fixed_buildable_add_child` puts a child written without a position at 0, 0
// (gtkfixed.c:171-177), so an unpositioned child lands there too: `left`/`top` start at
// `0` rather than CSS's `auto`, which for an absolutely positioned box resolves to its
// STATIC position instead — a different answer, and the one that would silently stack
// every child where the markup happens to read.
//
// THE ONE MEASUREMENT. A child that is out of flow contributes nothing to its parent's
// size, so a fixed whose children are absolutely positioned would collapse to zero without
// this. `gtk_fixed_layout_measure` returns the union of the children's rectangles
// (gtkfixedlayout.c:224-300): the fixed's minimum and natural size are
// `MAX (x + width)` and `MAX (y + height)` over the children it should lay out. A CSS box
// cannot hold a minimum and a natural size, so the union is written as the box's own
// `min-width` / `min-height`, which is the measurement GTK keeps and the one that decides
// how much space the fixed asks its parent for.
//
// `gtk_fixed_init` sets `GTK_OVERFLOW_HIDDEN` (gtkfixed.c:189-195), so the fixed clips a
// child that reaches past the union — here the union is exactly the children, so nothing
// is clipped and the rule is there for a child positioned negatively.
//
// A11Y: GtkFixed declares no accessible role, so none is set.
//
// Reference: refs/gtk/gtk/gtkfixed.c:171-177, :189-195, :213-240
// Reference: refs/gtk/gtk/gtkfixedlayout.c:224-300
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class GtkFixed extends HTMLElement {
    private _resize: ResizeObserver | null = null;
    private _mutations: MutationObserver | null = null;

    connectedCallback() {
        // Neither observer is guarded by a build flag, and that is the shape
        // `check-adwaita-connect-rebind.mjs` asks for: a re-parent runs this whole body
        // again, so the element comes back listening rather than deaf.
        this._resize = new ResizeObserver(() => this._size());
        this._resize.observe(this);
        this._mutations = new MutationObserver(() => {
            this._observeChildren();
            this._size();
        });
        this._mutations.observe(this, { childList: true });
        this._observeChildren();
        this._size();
    }

    disconnectedCallback() {
        this._resize?.disconnect();
        this._resize = null;
        this._mutations?.disconnect();
        this._mutations = null;
    }

    /** `gtk_fixed_put()` — a child and the position it sits at, both relative to the fixed. */
    put(child: HTMLElement, x: number, y: number): void {
        if (child.parentNode !== this) this.append(child);
        this.move(child, x, y);
    }

    /** `gtk_fixed_move()` — the same position for a child already in this fixed. */
    move(child: HTMLElement, x: number, y: number): void {
        child.style.left = `${x}px`;
        child.style.top = `${y}px`;
    }

    private _observeChildren(): void {
        if (this._resize === null) return;
        for (const child of this.children) {
            if (child instanceof HTMLElement) this._resize.observe(child);
        }
    }

    /** `gtk_fixed_layout_measure`: the union of the children's rectangles, as one box. */
    private _size(): void {
        let width = 0;
        let height = 0;
        for (const child of this.children) {
            if (!(child instanceof HTMLElement)) continue;
            width = Math.max(width, child.offsetLeft + child.offsetWidth);
            height = Math.max(height, child.offsetTop + child.offsetHeight);
        }
        // Written only on a real change, so a resize that finds the same union cannot feed
        // its own observer.
        const nextWidth = `${width}px`;
        const nextHeight = `${height}px`;
        if (this.style.minWidth !== nextWidth) this.style.minWidth = nextWidth;
        if (this.style.minHeight !== nextHeight) this.style.minHeight = nextHeight;
    }
}

customElements.define('gtk-fixed', GtkFixed);
