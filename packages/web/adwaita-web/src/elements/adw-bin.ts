// <adw-bin> — a widget with ONE child.
//
// The smallest container libadwaita ships and the base every other one-child widget
// derives from: `adw_bin_set_child` replaces what was there, `GtkBinLayout` gives the
// child the whole allocation, `compute_expand` follows the child and `focus` goes to
// it (adw-bin.c:108-123). There is no `bin` node in the stylesheet — the widget draws
// nothing of its own, which is why the whole element is the slot and nothing else.
//
// ONE CHILD, and the replacement is C's, not the DOM's: a second child REPLACES the
// first rather than stacking beside it. Two doors lead there — `child`/`setChild`, which
// libadwaita offers, and a plain `append`, which markup and a `.blp`'s `child: …` use —
// and an observer on the host makes the second one end where the first does: the LAST
// child stays. The slot routing below only enrols the NAME `child` so a `.blp`'s child is
// not refused sight unseen (`src/slotted-children.ts`, and the reason `adw-clamp.ts`
// gives for not calling `.install()`).
//
// `set_child` REFUSES a child that already has a parent (`g_return_if_fail (gtk_widget
// _get_parent (child) == NULL)`, adw-bin.c:208). A DOM append MOVES such a node rather
// than rejecting it, so `setChild` refuses a child whose parent is another element and
// says so — the same contract `adw_preferences_group_remove` keeps in
// `<adw-preferences-group>`.
//
// A11Y: no role. `adw_bin_class_init` sets none, so the widget keeps `GtkWidget`'s
// default `GENERIC` and a bin contributes nothing to the accessibility tree of its own.
//
// KNOWN_GAPS: none — `AdwBin`'s only property is `child`, a widget, which is a SLOT on
// every renderer.
//
// Reference: refs/libadwaita/src/adw-bin.c (adw_bin_set_child, class_init)
// Copyright (c) 2021 Purism SPC / GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { bindSlottedChildren } from '../slotted-children.js';

export class AdwBin extends HTMLElement {
    private _observer: MutationObserver | null = null;

    /** `Adw.Bin:child` — the one child, or `null`. The last one appended is the one that stays. */
    get child(): Element | null {
        return this.lastElementChild;
    }

    /** `adw_bin_set_child`: replace the current child, unparenting it. */
    set child(value: Element | null) {
        this.setChild(value);
    }

    connectedCallback() {
        // The NAME only. Every child of a bin already IS its content — there is no
        // internal structure to route into — so `.install()` is deliberately not called
        // for the reason `adw-clamp.ts` gives: it would `replaceChildren` a subtree the
        // author wrote and arm an observer that then re-routes what the element itself
        // puts there.
        bindSlottedChildren(this, [{ name: 'child', into: this }]);
        this._enforceSingleChild();
        // After the enforcement above, so its own removals are not reported back to it.
        this._observer ??= new MutationObserver(() => this._enforceSingleChild());
        this._observer.observe(this, { childList: true });
    }

    disconnectedCallback() {
        // A bin parked with two children (both appended while detached, where no
        // observer is watching) comes back to one on re-entry, in connectedCallback.
        this._observer?.disconnect();
    }

    /**
     * `adw_bin_set_child` — the LAST child wins, and the one it replaces leaves.
     *
     * A removal, not a move: C unparents the child it replaces.
     */
    private _enforceSingleChild(): void {
        const last = this.lastElementChild;
        if (last === null) return;
        for (const child of Array.from(this.children)) {
            if (child === last) break;
            child.remove();
        }
    }

    /** `adw_bin_set_child`, including its refusal of a child that already has a parent. */
    setChild(value: Element | null): void {
        if (value !== null && value.parentElement !== null && value.parentElement !== this) {
            // C's `g_return_if_fail` is a no-op with a message on stderr; returning
            // `false` is the same contract without the write, and `child`'s setter
            // drops the answer the way the other elements' do.
            throw new Error('AdwBin.setChild: the child already has a parent.');
        }
        if (value === this.child) return;

        const previous = this.child;
        if (value === null) {
            previous?.remove();
        } else {
            this.replaceChildren(value);
        }
        this.dispatchEvent(new CustomEvent('notify::child', { bubbles: true, detail: { child: value } }));
    }
}

customElements.define('adw-bin', AdwBin);
