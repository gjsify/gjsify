// <gtk-toggle-button> — a button that stays pressed. `Gtk.ToggleButton` IS a `Gtk.Button`
// with two more properties, `active` and `group`, so this element extends `<gtk-button>`
// and inherits its label, icon, child and style-class attributes unchanged; only the
// state and the mutual exclusion are new.
//
// `active` is the ATTRIBUTE, as it is on `<gtk-switch>` — `toggleAttribute` is
// idempotent, so "notify only on a real change" needs no guard and no core state class
// (ADR 0004: trivial behaviour gets none). A click, Space or Enter on the inner button
// flips it. `toggled` (GtkToggleButton's own signal) and `notify::active` (CustomEvent,
// bubbles, detail `{ active }`) fire on EVERY change, programmatic included, the way
// GObject notifies.
//
// `group` IS `gtk_toggle_button_set_group` — the doubly-linked list of
// `group_next`/`group_prev` (gtktogglebutton.c:121-122, 511-556), transcribed rather than
// approximated, because THREE of its rules are visible and none of them is "only one can
// be active":
//
//   · Activating a member walks `group_prev` to the FIRST of the group and deactivates
//     every member from there along `group_next`, then activates this one — the target is
//     deactivated even when this button was not in that group yet (:424-437).
//   · An ACTIVE member that has at least one link cannot be clicked off (:211-212), so a
//     group never reaches a state with nothing pressed. `b.set_group (a)` makes B the
//     member with the link, so it is B that stops being clickable-off — not A, and this
//     is the rule a reader gets wrong.
//   · Setting the group to the button ITSELF is refused (`g_return_if_fail
//     (toggle_button != group)`, :518) and a change that would put the button directly
//     before the same target again is a no-op (:539-540). Both are what keep the list
//     acyclic; a cycle is undefined behaviour upstream (:503) and is left undefined here
//     rather than detected.
//
// The property takes the other BUTTON, like `set_group`; the `group` ATTRIBUTE names it
// by `id`, which is the only spelling markup has for a widget reference, and it resolves
// through `document.getElementById`. It needs an `id` on the partner for that, so the
// property is the door that always works and the attribute the declarative one.
//
// `dispose` unlinks a button from its group (gtktogglebutton.c:225). The DOM has no
// terminal moment for an element that is merely re-parented, so nothing is unlinked on
// `disconnectedCallback`: the links are between the two buttons, and a row that moves
// keeps its group.
//
// The inner button wears libadwaita's `:checked` as a `.checked` class, and `aria-pressed`
// carries the same state for assistive technology.
//
// Reference: refs/gtk/gtk/gtktogglebutton.c (active, group, the clicked handler)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (`:checked`)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { GtkButton } from './gtk-button.js';

/**
 * How far {@link GtkToggleButton._groupFirst} walks before it gives up. A group of real
 * buttons is two or three long; the number only bounds what a cycle can cost.
 */
const GROUP_WALK_LIMIT = 1024;

export class GtkToggleButton extends GtkButton {
    private _wired = false;
    /** The other end of the group link, both halves of `GtkToggleButtonPrivate`. */
    private _groupNext: GtkToggleButton | null = null;
    private _groupPrev: GtkToggleButton | null = null;
    /** Guards the `group` property ↔ attribute loop, as `gtk-popover` guards its `open`. */
    private _reflectingGroup = false;

    static get observedAttributes() {
        return [...GtkButton.observedAttributes, 'active', 'group'];
    }

    /** Whether the button is pressed in. */
    get active(): boolean {
        return this.hasAttribute('active');
    }

    set active(value: boolean) {
        const next = !!value;
        if (this.active === next) return;
        // Before the attribute moves, so a `toggled` listener on the member being
        // released reads this one as still released — `gtk_toggle_button_set_active`
        // clears the group first and sets `priv->active` after (:424-439).
        if (next && this._grouped) this._clearGroup();
        this.toggleAttribute('active', next);
    }

    /**
     * `Gtk.ToggleButton:group` — the button this one joins, or `null` to leave the group.
     *
     * `G_PARAM_WRITABLE` upstream (:310-313), so there is deliberately NO getter: the
     * member's own links are the state, and reading them back is not what GTK offers.
     */
    set group(value: GtkToggleButton | null) {
        this._reflectingGroup = true;
        // The partner needs an `id` for the attribute to name it; without one the links
        // below still stand, and the attribute stays absent rather than naming nothing.
        if (value === null || value.id === '') this.removeAttribute('group');
        else this.setAttribute('group', value.id);
        this._reflectingGroup = false;
        this._setGroup(value);
    }

    /** Whether this button has at least one group link — `group_prev || group_next`. */
    private get _grouped(): boolean {
        return this._groupNext !== null || this._groupPrev !== null;
    }

    connectedCallback() {
        super.connectedCallback();
        if (this._wired) return;
        this._wired = true;
        // A disabled native button never emits `click`, so there is no guard to write here.
        this.button.addEventListener('click', () => {
            // `gtk_toggle_button_clicked` refuses to release an active member that has a
            // link, so a group always keeps exactly one button pressed.
            if (this.active && this._grouped) return;
            this.active = !this.active;
        });
        // A `group` written in server-rendered markup was seen by `attributeChangedCallback`
        // before this element was connected — and it may name a button that is not in the
        // DOM yet. Linking once the tree is whole is the only moment both ends exist.
        if (this.hasAttribute('group')) {
            this._setGroup(resolveGroupTarget(this.getAttribute('group'), this));
        }
    }

    // Optional because `GtkButton`'s own callback declares no parameter, and an override
    // may not demand one the base signature does not pass.
    attributeChangedCallback(name?: string) {
        if (name === 'group' && !this._reflectingGroup && this.isConnected) {
            this._setGroup(resolveGroupTarget(this.getAttribute('group'), this));
        }
        super.attributeChangedCallback();
        if (name !== 'active' || !this.isConnected) return;
        // The setter already cleared the group; this arm is the DECLARATIVE door, where
        // the attribute moved without going through it.
        if (this.active && this._grouped) this._clearGroup();
        this.dispatchEvent(new CustomEvent('toggled', { bubbles: true }));
        this.dispatchEvent(new CustomEvent('notify::active', { bubbles: true, detail: { active: this.active } }));
    }

    /**
     * `gtk_toggle_button_set_group` — insert this button DIRECTLY BEFORE `group`, or
     * unlink it when `group` is null. The three arms are the C's, in order.
     */
    private _setGroup(group: GtkToggleButton | null): void {
        // `g_return_if_fail (toggle_button != group)`: a critical, and the list stays as it
        // was. `console.error` is the browser's channel for "this is wrong, the page
        // continues"; throwing from an attribute callback is not deliverable to the author.
        if (group === this) {
            console.error('<gtk-toggle-button> cannot be its own group; the group is unchanged.');
            return;
        }
        if (group === null) {
            if (this._groupPrev) this._groupPrev._groupNext = this._groupNext;
            if (this._groupNext) this._groupNext._groupPrev = this._groupPrev;
            this._groupNext = null;
            this._groupPrev = null;
        } else {
            // Already directly before it — the one assignment that changes nothing, and
            // the reason setting the same group twice notifies once.
            if (this._groupNext === group) return;
            // NOTE: no unlink from a previous group first, because the C has none
            // (:542-554). `a.group = b; a.group = c;` leaves `b` linked to `a`, which is
            // upstream's behaviour and is ported rather than repaired: a list that
            // silently dropped the old link would make the two renderers disagree about
            // what the property does.
            this._groupPrev = null;
            if (group._groupPrev) {
                const previous = group._groupPrev;
                previous._groupNext = this;
                this._groupPrev = previous;
            }
            group._groupPrev = this;
            this._groupNext = group;
        }
        this.dispatchEvent(new CustomEvent('notify::group', { bubbles: true }));
    }

    /**
     * Release every OTHER member of the group — `get_group_first()` walked backwards,
     * then the chain forwards, skipping this one (:426-434).
     */
    private _clearGroup(): void {
        const first = this._groupFirst();
        for (let iter: GtkToggleButton | null = first; iter !== null; iter = iter._groupNext) {
            if (iter !== this) iter.active = false;
        }
    }

    /**
     * `get_group_first` (:242-262) — the walk backwards along `group_prev`.
     *
     * Written as recursion rather than a loop accumulator so no local ever holds `this`,
     * which the walk does not need: the C's `g_assert (group_first)` is its proof that the
     * walk terminates on a member, and the same proof is the `depth` guard here.
     */
    private _groupFirst(depth = 0): GtkToggleButton {
        const previous = this._groupPrev;
        // A CYCLE is undefined behaviour upstream (:503, "setting up groups in a cycle
        // leads to undefined behavior") and is left that way — but a cycle must not spin
        // the page, so the walk stops rather than hanging.
        if (previous === null || depth > GROUP_WALK_LIMIT) return this;
        return previous._groupFirst(depth + 1);
    }

    protected override decorate(button: HTMLButtonElement): void {
        button.classList.toggle('checked', this.active);
        button.setAttribute('aria-pressed', String(this.active));
    }
}

customElements.define('gtk-toggle-button', GtkToggleButton);

/**
 * The `group` attribute's value: the partner's id, resolved. A name that is not a
 * toggle button is refused the way `set_group`'s `Gtk.IS_TOGGLE_BUTTON` precondition is,
 * because linking to a non-toggle would break every walk in {@link _clearGroup}.
 */
function resolveGroupTarget(id: string | null, from: GtkToggleButton): GtkToggleButton | null {
    if (id === null || id === '') return null;
    const target = document.getElementById(id);
    if (target === null) {
        console.error(`<gtk-toggle-button group="${id}"> names no element; the group is unchanged.`);
        return null;
    }
    // The partner can sit LATER in the document than this button and so not be upgraded
    // yet — `document.getElementById` finds the element without running its constructor.
    if (!(target instanceof GtkToggleButton)) customElements.upgrade(target);
    if (!(target instanceof GtkToggleButton) || target === from) {
        console.error(`<gtk-toggle-button group="${id}"> names no other toggle button; the group is unchanged.`);
        return null;
    }
    return target;
}
