// <adw-layout-slot> — one named hole inside a layout of an `Adw.MultiLayoutView`.
//
// `AdwLayoutSlot` is a bin with an ID and nothing else: it takes a child when the view
// inserts the child whose ID matches, and its `visible` property is bound to that
// child's so hiding the child hides the hole (:151). The ID is what pairs the two
// sides — `adw_multi_layout_view_set_child(id, widget)` finds the layout's slots by
// `g_hash_table_lookup (self->slots, id)` (:139) — and it is CONSTRUCT-ONLY
// (adw-layout-slot.c:145), so it is read once and never written.
//
// DUPLICATE IDs ACROSS LAYOUTS ARE THE WIDGET'S OWN MODEL, not a mistake here: the
// canonical example in the C documentation puts an `AdwLayoutSlot` with `id="primary"`
// in BOTH layouts of one view, because that is how a child follows a layout change. The
// element never resolves a slot by document lookup, only from the subtree of the layout
// it is currently mounting, so two of them with one ID are ordinary.
//
// Attributes:
//   id  (`AdwLayoutSlot:id` — the slot ID. Construct-only upstream, so changing it here
//        after connect re-registers the slot and warns, as `g_error` does for a slot
//        constructed without one (adw-layout-slot.c:68).)
//
// A11Y: `role="group"`, the accessible role libadwaita installs on the class
// (adw-layout-slot.c:131).
//
// There is no box of its own (`display: contents`, so the child takes the allocation the
// container would have given the slot) and libadwaita ships NO rule for this widget —
// `src/stylesheet/widgets/` has no `layout-slot` partial and no selector names the node,
// so there is nothing to port and nothing invented to replace it.
//
// Reference: refs/libadwaita/src/adw-layout-slot.c
// Copyright (c) 2023-2024 Purism SPC / GNOME Foundation Inc. (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { AdwMultiLayoutView } from './adw-multi-layout-view.js';

export class AdwLayoutSlot extends HTMLElement {
    private _registered = false;

    static get observedAttributes() {
        return ['id'];
    }

    /** `adw_layout_slot_get_slot_id()` (:184), read under its property's name. */
    get slotId(): string | null {
        return this.getAttribute('id');
    }

    connectedCallback() {
        this.setAttribute('role', 'group');
        // `display: contents` inline rather than in a partial: libadwaita styles nothing
        // here, and a host page that wants the slot to box its child sets one rule.
        this.style.display = 'contents';
        this._register();
    }

    disconnectedCallback() {
        this._registered = false;
    }

    attributeChangedCallback(name?: string) {
        if (!this.isConnected || name !== 'id') return;
        if (this._registered) {
            // `G_PARAM_CONSTRUCT_ONLY`: upstream cannot change a slot's ID either, and
            // the bin's `slots` table is keyed by it — `register_slot` refuses a second
            // entry under one ID (adw-multi-layout-view.c:693). Saying so beats
            // silently leaving the view holding the old pairing.
            console.warn('<adw-layout-slot>: `id` is construct-only upstream; re-registering the slot.');
        }
        this._register();
    }

    /**
     * Hand this slot to the nearest `<adw-multi-layout-view>` ancestor.
     *
     * `adw_layout_slot_root` walks up for the view and calls
     * `adw_multi_layout_view_register_slot` (adw-layout-slot.c:55). The view's own
     * mount path is the authority — it registers only while it is building a layout —
     * so a call arriving outside that window is refused there, exactly as
     * `accepting_slots` refuses it upstream.
     */
    private _register(): void {
        const id = this.slotId;
        if (id === null || id === '') {
            console.error('<adw-layout-slot> created without an `id` — libadwaita refuses this with g_error.');
            return;
        }
        // `instanceof` rather than a cast on `closest(…)`: an ancestor that is present
        // but not upgraded yet satisfies a cast and fails at the call, and this is on the
        // connect path of every slot.
        const view = this.closest('adw-multi-layout-view');
        if (view instanceof AdwMultiLayoutView) view.registerSlot(id, this);
        this._registered = true;
    }
}

customElements.define('adw-layout-slot', AdwLayoutSlot);
