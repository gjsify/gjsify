// <gtk-overlay> — other widgets stacked ON TOP of one main child.
//
// `Gtk.Overlay` owns ONE property, `child`, and it is a widget: the main child, the one
// the overlay sizes ITSELF to ("An overlay's minimum and natural sizes are those of its
// main child", gtkoverlay.c:56-58). Every other knob lives on `GtkOverlayLayoutChild` —
// `measure` (does this child's size count towards the overlay's?) and `clip-overlay` (is
// it clipped to the parent?) — which GTK reaches per child through
// `gtk_overlay_set_measure_overlay()` / `_set_clip_overlay()`, and a reader reaches in
// markup as the child's own placement. Both are one CSS switch here, so they are declared
// on the CHILD and this element does not observe them. Neither is a scalar of
// `GtkOverlay`, which is why the element observes none.
//
// THE PLACEMENT IS `gtk_overlay_get_child_position` (gtkoverlay.c:130-196) IN CSS, and
// the mapping is one-to-one because that function is already an alignment rule:
//
//   · it fills the overlay with the main child's own allocation — `_childEl` is
//     `display: contents`, so the authored child is laid out as a direct child of the
//     host and the overlay takes its size;
//   · each overlay child is given `min(w, natural)` and then placed by its own
//     `halign`/`valign` — exactly what an auto margin does in a flex box, which is why
//     the generic `[halign]` / `[valign]` rules in `_widget.scss` place an overlay child
//     with no rule of its own;
//   · `GTK_ALIGN_FILL` — the DEFAULT for both properties — grows the child to the whole
//     allocation on that axis (gtkoverlay.c:156, :180). In flex that is `align-self:
//     stretch` on the cross axis, and on the main axis a `flex-grow` this partial gives
//     only to a child that named no `halign` (`:not([halign])`): a child that DID name
//     one also carries an auto margin, and an auto margin would be handed the space a
//     grow factor had already spent.
//
// The layer does not intercept input meant for the main child: it is `pointer-events: none`
// with each overlay child re-enabling them on its own box, because GTK delivers an event
// to the widget whose ALLOCATION it lands in and to nothing else.
//
// `.left` / `.right` / `.top` / `.bottom` are the classes `gtk_overlay_child_update_style_classes`
// adds to an overlay child (gtkoverlaylayout.c:335-388), which the widget's own doc
// section publishes as part of the CSS node contract (gtkoverlay.c:66-71): one per edge
// the child's alignment actually pinned it to. `halign=start` in an RTL row is the RIGHT
// edge, which is what `effective_align` (gtkoverlay.c:111-128) decides before the classes
// are read.
//
// A11Y: no role of its own — GtkOverlay is a plain GtkWidget, and naming one would flatten
// the child a screen reader should be able to reach. The MAIN child keeps the name; an
// overlay child that is itself a widget keeps its own.
//
// Reference: refs/gtk/gtk/gtkoverlay.c (child, get_child_position, compute_expand)
// Reference: refs/gtk/gtk/gtkoverlaylayout.c (measure, clip_overlay, the edge classes)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { bindSlottedChildren } from '../slotted-children.js';

/** The edges `gtk_overlay_child_update_style_classes` can pin a child to. */
const EDGES = ['left', 'right', 'top', 'bottom'] as const;

export class GtkOverlay extends HTMLElement {
    private _childEl!: HTMLDivElement;
    private _layerEl!: HTMLDivElement;
    private _initialized = false;
    /**
     * GTK recomputes the edge classes on every allocation of an overlay child, which is a
     * frame-clock fact this renderer does not have; a ResizeObserver on the layer is the
     * honest substitute — it fires on the changes the C would answer to.
     */
    private _resize: ResizeObserver | null = null;
    /** The two things a child can do that change which edge it is pinned to. */
    private _mutations: MutationObserver | null = null;

    static get observedAttributes() {
        return [];
    }

    /** `Gtk.Overlay:child` — the main child, as the light-DOM node the host adopted. */
    get child(): Element | null {
        return this._childEl?.firstElementChild ?? null;
    }

    /** The absolutely-positioned layer every `slot="overlay"` child lands in. */
    get overlayLayer(): HTMLDivElement {
        return this._layerEl;
    }

    connectedCallback() {
        if (this._initialized) {
            // The teardown below released both observers on the way out, so a re-parent has
            // to arm them again — see `scripts/check-adwaita-connect-rebind.mjs`.
            this._observe();
            return;
        }
        this._initialized = true;

        this._childEl = document.createElement('div');
        this._childEl.className = 'adw-overlay-child';

        this._layerEl = document.createElement('div');
        this._layerEl.className = 'adw-overlay-layer';

        // GtkBuildable's `<child type="overlay">` becomes the `overlay` SLOT name, and the
        // bare `<child>` — the default — is the main child, which is the pairing
        // `packages/framework/gtk-host/src/descriptors/gtk.ts` curates for `GtkOverlay`
        // (`slots: { child, overlay }`, `defaultSlot: 'child'`).
        bindSlottedChildren(this, [{ into: this._childEl }, { name: 'overlay', into: this._layerEl }]).install(
            this._childEl,
            this._layerEl,
        );

        this._observe();
    }

    disconnectedCallback() {
        this._resize?.disconnect();
        this._resize = null;
        this._mutations?.disconnect();
        this._mutations = null;
    }

    private _observe(): void {
        if (this._resize) return;
        // ResizeObserver delivers an initial observation on observe(), so the first edge
        // classes land before paint without a separate seeding pass.
        this._resize = new ResizeObserver(() => this._syncEdgeClasses());
        this._resize.observe(this._layerEl);
        // A child adopted after `install()` and an alignment rewritten on one are both
        // changes GTK would see at the next allocation of that child; the layer itself does
        // not resize, so the observer is what hears them. `subtree` is what makes it hear
        // them — `halign` is on a CHILD of the layer, not on the layer.
        this._mutations = new MutationObserver(() => this._syncEdgeClasses());
        this._mutations.observe(this._layerEl, { childList: true, attributes: true, subtree: true });
        this._syncEdgeClasses();
    }

    private _syncEdgeClasses(): void {
        // `effective_align` first: under RTL a `halign="start"` child is pinned to the
        // RIGHT edge, and the class has to say so.
        const rtl = this.matches(':dir(rtl)');
        for (const child of this._layerEl.children) {
            const halign = child.getAttribute('halign');
            const valign = child.getAttribute('valign');
            const pinned: Record<(typeof EDGES)[number], boolean> = {
                left: rtl ? halign === 'end' : halign === 'start',
                right: rtl ? halign === 'start' : halign === 'end',
                top: valign === 'start',
                bottom: valign === 'end',
            };
            for (const edge of EDGES) child.classList.toggle(edge, pinned[edge]);
        }
    }
}

customElements.define('gtk-overlay', GtkOverlay);
