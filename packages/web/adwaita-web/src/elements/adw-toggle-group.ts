// <adw-toggle-group> — the web counterpart of Adw.ToggleGroup: a linked set of toggle
// buttons where exactly one is active. Toggles are `<adw-toggle>` children carrying
// `label` and/or `icon-name`, and the `flat` / `round` attributes mirror the upstream
// `.flat` / `.round` style classes. `notify::active` (CustomEvent, bubbles, detail
// `{ active }`) mirrors the `active` GObject property.
//
// The SELECTION state machine (the segment list plus the guarded, no-op-on-same active
// index) is HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004) as
// {@link ToggleGroupState}; this element keeps only the DOM half — the buttons, the active
// pill / checked reflection, the keyboard and the event.
//
// THE ROLE IS A RADIO GROUP, not a tab list, and the element had neither. Upstream
// declares `GTK_ACCESSIBLE_ROLE_RADIO_GROUP` (adw-toggle-group.c:1191) and reads the
// group's CURRENT role when it builds each toggle: a group already declared a tab list
// gets `GTK_ACCESSIBLE_ROLE_TAB` children, everything else `GTK_ACCESSIBLE_ROLE_RADIO`
// (:857-865, under the comment "Special case for AdwInlineViewSwitcher" — that switcher
// builds exactly this widget with `TAB_LIST`, adw-inline-view-switcher.c:702). Both
// branches are ported, in the same order, because a consumer that declares the tab list
// upstream sanctions would otherwise get radios inside it.
//
// `aria-pressed` was the state before, and it belongs to NEITHER role — it is the
// toolbar toggle-button pattern, where each button is independent. The state of one of
// N mutually exclusive choices is `aria-checked` under `radio` and `aria-selected` under
// `tab`, so a screen reader was told these were three separate on/off buttons.
//
// THE KEYBOARD is one tab stop and arrows inside, which is the roving tabindex
// `elements/roving-focus.ts` implements — and `adw_toggle_group_focus`
// (adw-toggle-group.c:1045) is the citation that module is built on. Tab in either
// direction is PROPAGATED (:1059-1060), i.e. focus leaves the group; every other
// direction goes to `adw_widget_focus_child` (:1062), i.e. moves within it. Which button
// Tab enters on is `adw_toggle_group_grab_focus` (:1066): the ACTIVE toggle's button,
// never the first. The web element had three plain tab stops and no arrow keys at all,
// so it stayed operable — this change turns those three stops into one, which is visible
// to anything that tabs through a toggle group.
//
// HORIZONTAL ONLY, and the reason is not the missing `orientation` property. The C looks
// orientation-blind — `adw_toggle_group_focus` filters the two Tab directions and hands
// every other one on without consulting `self->orientation` — but the axis is decided
// one level down, GEOMETRICALLY. `adw_widget_focus_child` is `focus_move`
// (adw-widget-utils.c:428), which sorts through `focus_sort` (:388), which dispatches
// UP/DOWN into `focus_sort_up_down` (:298). That sorter DELETES every sibling with no
// horizontal overlap with the focused child (:339-342) — which, in a row of toggles, is
// all of them. The list is left holding only the focused button, `gtk_widget_child_focus`
// on a leaf that already has focus returns FALSE, and the press PROPAGATES: upstream,
// ArrowDown in a horizontal toggle group leaves the group. So `'horizontal'` is what the
// C does for the only layout this element has, it matches the three sibling tab lists,
// and it leaves ArrowUp/ArrowDown to the page instead of swallowing a scroll.
//
// Reference: refs/libadwaita/src/adw-toggle-group.c (AdwToggleGroup behaviour)
// Reference: refs/libadwaita/src/stylesheet/widgets/_toggle-group.scss
// Reference: refs/adwaita-web/adwaita-web/scss/_toggle_group.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// selection state machine composed from @gjsify/adwaita-core, the icon node
// from <gtk-image>.

import { ToggleGroupState } from '@gjsify/adwaita-core';

import { createGtkImage } from './gtk-image.js';
import { attachRovingFocus } from './roving-focus.js';

/** A single toggle. Children of <adw-toggle-group>; consumed at connect time. */
export class AdwToggle extends HTMLElement {
    static get observedAttributes() {
        return ['label', 'icon-name'];
    }
}

export class AdwToggleGroup extends HTMLElement {
    private _innerEl!: HTMLDivElement;
    private _buttons: HTMLButtonElement[] = [];
    /** The headless segment list + guarded selection state machine (ADR 0004). */
    private readonly _state = new ToggleGroupState();
    private _initialized = false;
    /** `aria-checked` under `radio`, `aria-selected` under `tab` — decided at connect. */
    private _stateAttr: 'aria-checked' | 'aria-selected' = 'aria-checked';

    static get observedAttributes() {
        return ['active', 'flat', 'round'];
    }

    /** Zero-based index of the active toggle. */
    get active(): number {
        return this._state.selected;
    }

    set active(value: number) {
        this.setAttribute('active', String(value));
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Snapshot the declared <adw-toggle> children before we take over the
        // subtree — their label / icon-name become the rendered buttons.
        const toggles = Array.from(this.querySelectorAll('adw-toggle')) as AdwToggle[];

        // `gtk_widget_class_set_accessible_role` sets a CLASS DEFAULT that an instance's
        // construct-time `accessible-role` overrides, and `add_toggle` then reads
        // whatever the instance actually has. So a declared role is kept — only an
        // undeclared one is filled in — and `tablist` is the single branch, exactly as
        // in the C: any other role still gets radio children.
        // `|| null`, not `?? null`: `role=""` is not a declared role, and treating it as
        // one left the group with no role at all while its children were radios.
        const declared = this.getAttribute('role')?.trim() || null;
        if (declared === null) this.setAttribute('role', 'radiogroup');
        const isTabList = declared === 'tablist';
        const toggleRole = isTabList ? 'tab' : 'radio';
        this._stateAttr = isTabList ? 'aria-selected' : 'aria-checked';
        // Read ONCE, which is what upstream allows: `GtkAccessible:accessible-role` is
        // writable but documented "The accessible role cannot be changed once set", and
        // the only public setter is the CLASS-level `gtk_widget_class_set_accessible_role`
        // — there is no instance setter at all. So a later `role=` change has no upstream
        // meaning, and re-labelling the toggles on it would be behaviour this port
        // invented. Declare it in markup, or before the element is connected.
        //
        // (It is NOT construct-only, which an earlier draft of this comment claimed:
        // `Gtk-4.0.gir` marks the property `writable` with no construct flag at all. The
        // rule is the documented one above, which is the stronger citation anyway.)

        this._innerEl = document.createElement('div');
        this._innerEl.className = 'adw-toggle-group-inner';
        // The toggles are this element's own children upstream; the wrapper is a web-only
        // flex box with no counterpart in the C at all. Without a role it is a `generic`
        // sitting between a radio group and its radios, so it declares itself away.
        //
        // NO upstream precedent is claimed for this, and an earlier draft of this comment
        // invented one: every `GTK_ACCESSIBLE_ROLE_PRESENTATION` in libadwaita is a leaf
        // decoration (an icon, a gizmo), never a layout container between a role-bearing
        // parent and role-bearing children — because GTK has no such container here to
        // annotate. That is exactly why the attribute is needed on this side and nowhere
        // in the C.
        this._innerEl.setAttribute('role', 'none');

        this._buttons = toggles.map((toggle, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'adw-toggle';
            btn.setAttribute('role', toggleRole);

            const label = toggle.getAttribute('label') ?? '';
            const icon = toggle.getAttribute('icon-name') ?? '';
            if (icon) btn.appendChild(createGtkImage(icon));
            if (label) btn.appendChild(document.createTextNode(label));

            // An icon-only toggle has no text — give it an accessible name.
            if (icon && !label) btn.setAttribute('aria-label', icon);

            btn.addEventListener('click', () => this._selectIndex(index));
            return btn;
        });

        this._innerEl.append(...this._buttons);
        this.replaceChildren(this._innerEl);

        // Hand the segments to the headless state machine (it needs the count to
        // bound the selection), then seed the active index from the attribute.
        this._state.setLabels(
            toggles.map((toggle) => toggle.getAttribute('label') || toggle.getAttribute('icon-name') || ''),
        );
        this._state.subscribe(() => this._render());
        this._state.setSelected(this._readActiveAttr());
        this._render();

        // No `disabled`/`hidden` filter, because no `<adw-toggle>` attribute can produce
        // either — upstream's per-toggle `enabled` (adw-toggle-group.c:871) has no web
        // counterpart yet, and a filter for a state this element cannot reach would be
        // untestable. `AdwToggle.observedAttributes` is pinned in
        // `keyboard-operable.spec.ts` so the day it grows, this decision has to be
        // revisited instead of silently becoming a focus trap.
        attachRovingFocus({
            host: this,
            orientation: 'horizontal',
            items: () => this._buttons,
            // Same path a click takes, so an arrow key cannot drift from a press.
            select: (item) => this._selectIndex(this._buttons.findIndex((btn) => btn === item)),
        });
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'active') {
            // A no-op / out-of-range index is rejected by the core state machine.
            this._state.setSelected(this._readActiveAttr());
            return;
        }
        // flat / round are styling-only.
        this._render();
    }

    private _readActiveAttr(): number {
        const raw = Number.parseInt(this.getAttribute('active') ?? '0', 10);
        if (Number.isNaN(raw)) return 0;
        const max = Math.max(0, this._state.count - 1);
        return Math.min(Math.max(raw, 0), max);
    }

    private _selectIndex(index: number): void {
        // The core state machine guards the no-op/out-of-range cases and notifies
        // the subscriber (which re-renders) only on a real change.
        if (!this._state.setSelected(index)) return;
        // Keep the attribute in sync without re-entering via the guarded
        // attributeChangedCallback (value already matches, so it no-ops).
        this.setAttribute('active', String(index));
        this.dispatchEvent(new CustomEvent('notify::active', { bubbles: true, detail: { active: index } }));
    }

    private _render(): void {
        this.classList.toggle('flat', this.hasAttribute('flat'));
        this.classList.toggle('round', this.hasAttribute('round'));
        const active = this._state.selected;
        this._buttons.forEach((btn, index) => {
            const isActive = index === active;
            btn.classList.toggle('active', isActive);
            btn.setAttribute(this._stateAttr, String(isActive));
            // The roving tabindex: Tab enters on the ACTIVE toggle, the way
            // `adw_toggle_group_grab_focus` grabs it, and leaves the group from there.
            btn.tabIndex = isActive ? 0 : -1;
        });
    }
}

customElements.define('adw-toggle', AdwToggle);
customElements.define('adw-toggle-group', AdwToggleGroup);
