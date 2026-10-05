// <adw-toggle-group> — the web counterpart of Adw.ToggleGroup: a linked set of toggle
// buttons where exactly one is active. Toggles are `<adw-toggle>` children carrying
// `label` and/or `icon-name`, an optional `tooltip`, and an optional `name`, which the
// group's `active-name` selects by (read at connect, like the rest). The `flat` / `round`
// attributes mirror the upstream
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
// SENSITIVITY HAS TWO DOORS, and both are the GTK ones. `GtkWidget:sensitive` on the GROUP
// is the `sensitive` attribute, read by VALUE rather than by presence because the property
// is TRUE by default and `<adw-toggle-group>` must not read as insensitive (`src/attributes.ts`).
// `AdwToggle:enabled` is per toggle.
//
// PER-TOGGLE `enabled` IS REACHABLE, and the issue's warning does not close it. `add_toggle`
// spends it at add time — `gtk_widget_set_sensitive (toggle->button, toggle->enabled)`
// (adw-toggle-group.c:871) — and `adw_toggle_set_enabled` applies it to that same button
// afterwards (:1663), so nothing about the order is load-bearing. What makes the door awkward
// is not the order but the TYPE: `AdwToggle` is not a widget and has no `set_sensitive`, so
// `add_toggle` is the only public way in and it wants an `AdwToggle` this element never
// builds. Here the door is the rendered `<button>` — which is exactly what `add_toggle` spends
// the flag on — so the element reads `enabled` where `add_toggle` would have read it and lands
// in the same state. One consequence is ported with it: an insensitive toggle cannot be the
// active one (`set_active_toggle`, :720), which is also what makes a disabled `<button>`
// agree with the selection rather than sitting checked and unreachable.
//
// The roving walk is FILTERED, which `roving-focus.ts` requires of every caller: a disabled
// `<button>` cannot take focus, and leaving one in strands the user on a `focus()` the browser
// refuses. `status/open-todos/adwaita-web.md` made adding that filter the price of the
// attribute; this is that change.
//
// Reference: refs/libadwaita/src/adw-toggle-group.c (AdwToggleGroup behaviour)
// Reference: refs/libadwaita/src/stylesheet/widgets/_toggle-group.scss
// Reference: refs/adwaita-web/adwaita-web/scss/_toggle_group.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// selection state machine composed from @gjsify/adwaita-core, the icon node
// from <gtk-image>.

import { ToggleGroupState, keptToggles, toggleIndexOfName } from '@gjsify/adwaita-core';

import { booleanAttribute } from '../attributes.js';
import { createGtkImage } from './gtk-image.js';
import { attachRovingFocus } from './roving-focus.js';

/** A single toggle. Children of <adw-toggle-group>; consumed at connect time. */
export class AdwToggle extends HTMLElement {
    // `tooltip` joins because `AdwToggle:tooltip` exists upstream (:467) and an
    // icon-only toggle has no other text — `tooltip` is what NAMES it, so it is not a
    // decoration. It produces no disabled or hidden button, which is the invariant
    // `keyboard-operable.spec.ts` pins this list for.
    //
    // `enabled` is the one that DOES change the invariant, and the pinned list is what
    // forced the roving filter to land in the same change.
    static get observedAttributes() {
        return ['label', 'icon-name', 'tooltip', 'enabled'];
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (name === 'enabled' && oldValue !== newValue) {
            // Notify the parent group that this toggle's enabled state changed.
            this.dispatchEvent(
                new CustomEvent('toggle-enabled-changed', {
                    bubbles: true,
                    composed: true,
                    detail: { enabled: newValue !== 'false' },
                }),
            );
        }
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
    /** Each toggle's `name`, in order — what `active-name` resolves against. */
    private _names: (string | null)[] = [];
    /** `AdwToggle:enabled` per rendered button, in order — `add_toggle` spends this at add time. */
    private _enabled: boolean[] = [];
    /** The authored <adw-toggle> elements, kept to observe live `enabled` changes. */
    private _toggles: AdwToggle[] = [];

    static get observedAttributes() {
        return ['active', 'active-name', 'flat', 'round', 'sensitive'];
    }

    /**
     * `GtkWidget:sensitive` — whether the whole group is insensitive.
     *
     * TRUE unless the attribute says `false`, because the property defaults to TRUE and a
     * boolean attribute read by PRESENCE would leave every group on a page insensitive.
     */
    get sensitive(): boolean {
        return booleanAttribute(this.getAttribute('sensitive'), true);
    }

    set sensitive(value: boolean) {
        this.setAttribute('sensitive', value ? 'true' : 'false');
    }

    /** Whether the toggle at `index` is enabled (`AdwToggle:enabled`) — false once disabled. */
    isToggleEnabled(index: number): boolean {
        return this._enabled[index] ?? false;
    }

    /** Zero-based index of the active toggle. */
    get active(): number {
        return this._state.selected;
    }

    set active(value: number) {
        this.setAttribute('active', String(value));
    }

    /** `Adw.ToggleGroup:active-name` — the `name` of the active toggle, or `null`. */
    get activeName(): string | null {
        return this._names[this._state.selected] ?? null;
    }

    set activeName(value: string | null) {
        if (value === null) this.removeAttribute('active-name');
        else this.setAttribute('active-name', value);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Snapshot the declared <adw-toggle> children before we take over the
        // subtree — their label / icon-name become the rendered buttons.
        // A second toggle claiming a name is refused whole, as `add_toggle` refuses it
        // (adw-toggle-group.c:849) — the core's rule, not this element's.
        const authored = Array.from(this.querySelectorAll('adw-toggle')) as AdwToggle[];
        const toggles = keptToggles(authored.map((el) => ({ el, name: el.getAttribute('name') }))).map(
            (toggle) => toggle.el,
        );
        if (toggles.length < authored.length) {
            console.warn('[adw-toggle-group] a toggle name already exists; the later toggle is not added');
        }

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

        this._toggles = toggles;
        this._buttons = toggles.map((toggle, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'adw-toggle';
            btn.setAttribute('role', toggleRole);
            // `add_toggle` reads `enabled` while building the button (:871), and a toggle
            // with no `enabled` attribute is the TRUE default (:513).
            this._enabled[index] = booleanAttribute(toggle.getAttribute('enabled'), true);

            const label = toggle.getAttribute('label') ?? '';
            const icon = toggle.getAttribute('icon-name') ?? '';
            const tooltip = toggle.getAttribute('tooltip') ?? '';
            if (icon) btn.appendChild(createGtkImage(icon));
            if (label) btn.appendChild(document.createTextNode(label));

            // `update_button` (adw-toggle-group.c:215) sets the tooltip FIRST and
            // unconditionally, so it is a property of the button whatever else it holds.
            btn.title = tooltip;

            // The accessible NAME falls through in upstream's order (:226-282): a label
            // names the toggle and the tooltip is then GTK's automatic DESCRIPTION; with
            // no label, the TOOLTIP becomes the name. The icon name is the last resort —
            // it is a symbolic identifier, not words, which is exactly why an icon-only
            // toggle was undiscoverable without this.
            if (!label && tooltip) btn.setAttribute('aria-label', tooltip);
            else if (icon && !label) btn.setAttribute('aria-label', icon);

            btn.addEventListener('click', () => this._selectIndex(index));
            return btn;
        });

        this._innerEl.append(...this._buttons);
        this.replaceChildren(this._innerEl);

        // Observe live `enabled` changes on the authored <adw-toggle> elements.
        // Upstream's `adw_toggle_set_enabled` is a live setter (:1663); the port
        // snapshots at connect, so a later `toggle.setAttribute('enabled', 'false')`
        // had no effect. The `AdwToggle` element fires `toggle-enabled-changed`
        // from its attributeChangedCallback; we update `_enabled` and re-render.
        for (let i = 0; i < this._toggles.length; i++) {
            this._toggles[i].addEventListener('toggle-enabled-changed', (event: Event) => {
                const { enabled } = (event as CustomEvent<{ enabled: boolean }>).detail;
                if (this._enabled[i] !== enabled) {
                    this._enabled[i] = enabled;
                    this._render();
                }
            });
        }

        // Hand the segments to the headless state machine (it needs the count to
        // bound the selection), then seed the active index from the attribute.
        this._state.setLabels(
            toggles.map((toggle) => toggle.getAttribute('label') || toggle.getAttribute('icon-name') || ''),
        );
        this._names = toggles.map((toggle) => toggle.getAttribute('name'));
        this._state.subscribe(() => this._render());
        this._state.setSelected(this._readActiveAttr());
        // After `active`, and after the toggles are in, as `parser_finished` applies it
        // (adw-toggle-group.c:1247): a group whose markup names both ends on the name.
        this._applyActiveName();
        this._render();

        // No `hidden` filter, because no `<adw-toggle>` attribute can produce one — and now
        // there IS a `disabled` one, so the filter `roving-focus.ts` asks of every caller is
        // here. `status/open-todos/adwaita-web.md` made that the price of `enabled`.
        attachRovingFocus({
            host: this,
            orientation: 'horizontal',
            items: () => this._buttons.filter((btn) => !btn.disabled),
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
        if (name === 'active-name') {
            this._applyActiveName();
            return;
        }
        // `sensitive`, flat and round: styling and per-button state, both `_render`.
        this._render();
    }

    /**
     * `adw_toggle_group_set_active_name`: the toggle carrying the name becomes active, and
     * a name nothing carries leaves the selection where it was — the C's `g_critical` and
     * return (:2001). Which toggle a name means is the core's answer, not this element's.
     */
    private _applyActiveName(): void {
        const name = this.getAttribute('active-name');
        if (name === null) return;
        const index = toggleIndexOfName(this._names, name);
        if (index !== -1) this._state.setSelected(index);
    }

    private _readActiveAttr(): number {
        const raw = Number.parseInt(this.getAttribute('active') ?? '0', 10);
        if (Number.isNaN(raw)) return 0;
        const max = Math.max(0, this._state.count - 1);
        return Math.min(Math.max(raw, 0), max);
    }

    private _selectIndex(index: number): void {
        // `set_active_toggle` refuses a toggle that is not enabled (:720), so an insensitive
        // one can never become the active one — the check is the core state machine's guard
        // plus this one, in C's order.
        if (!this._enabled[index]) return;
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
        const sensitive = this.sensitive;
        // The group node's own `:disabled` rule (_toggle-group.scss:16) needs the UA's
        // `:disabled`, which a custom element never is — `_expander.scss` records why, and
        // writes the rule against the attribute for the same reason.
        this.toggleAttribute('disabled', !sensitive);
        this._buttons.forEach((btn, index) => {
            const isActive = index === active;
            btn.classList.toggle('active', isActive);
            btn.setAttribute(this._stateAttr, String(isActive));
            // `GtkWidget:sensitive` on the GROUP reaches every child in GTK, because
            // `gtk_widget_is_sensitive` ANDs the parent chain; a `<button disabled>` is the
            // browser's half of that, and it is also what takes the toggle out of the tab
            // order and out of the roving walk.
            btn.disabled = !sensitive || !this._enabled[index];
            // The roving tabindex: Tab enters on the ACTIVE toggle, the way
            // `adw_toggle_group_grab_focus` grabs it, and leaves the group from there.
            btn.tabIndex = isActive ? 0 : -1;
        });
        // An insensitive toggle can never BE the active one, so an active-but-disabled toggle
        // — `active="1"` authored next to `<adw-toggle enabled="false">` — would be a
        // checked radio nothing can reach. Upstream cannot express the pair at all
        // (`set_active_toggle` clears the selection instead, :720), so the selection moves
        // to the first enabled toggle, which is the one Tab then enters on.
        if (!this._enabled[active]) this._activateFirstEnabled();
    }

    /** Select the first enabled toggle, if there is one — the C's "no active" repair. */
    private _activateFirstEnabled(): void {
        const first = this._enabled.findIndex((enabled) => enabled);
        if (first === -1) return;
        this._state.setSelected(first);
        this.setAttribute('active', String(first));
        // The state change came from _render, not user interaction, but the active
        // index changed — emit notify::active so consumers stay in sync.
        this.dispatchEvent(new CustomEvent('notify::active', { bubbles: true, detail: { active: first } }));
    }
}

customElements.define('adw-toggle', AdwToggle);
customElements.define('adw-toggle-group', AdwToggleGroup);
