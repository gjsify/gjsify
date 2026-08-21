// <adw-action-row> — a boxed-list row with a title, optional subtitle and prefix /
// suffix widget slots; the most fundamental Adwaita row type. `slot="prefix"` holds
// icons/widgets before the text, `slot="suffix"` the controls after it, and an
// `activatable` row emits `activated` on click.
//
// The LABEL VISIBILITY rule and the activatable-widget coupling are HEADLESS and live
// in `@gjsify/adwaita-core` (ADR 0004) as {@link ActionRowState}; this element keeps
// only the DOM render half.
//
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/actionrow.md
// Reference: refs/libadwaita/src/adw-action-row.c, adw-action-row.ui
// Reference: refs/libadwaita/src/stylesheet/widgets/_lists.scss (.row styling)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// label + activation state composed from @gjsify/adwaita-core.

import { ActionRowState } from '@gjsify/adwaita-core';

import { bindEmptySections } from '../empty-sections.js';

/**
 * Attributes whose change means the activatable widget's sensitivity may have
 * changed. `disabled` is the DOM's `GtkWidget:sensitive` for form controls;
 * `aria-disabled` is the only spelling a non-form element has.
 */
const SENSITIVITY_ATTRIBUTES = ['disabled', 'aria-disabled'];

/** Whether `widget` is sensitive, i.e. NOT disabled in either DOM spelling. */
function isSensitive(widget: HTMLElement): boolean {
    if ((widget as HTMLElement & { disabled?: boolean }).disabled === true) return false;
    return widget.getAttribute('aria-disabled') !== 'true';
}

export class AdwActionRow extends HTMLElement {
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    private _suffixEl!: HTMLDivElement;
    private _prefixEl!: HTMLDivElement;
    /** The headless labels + activatable-widget coupling (ADR 0004). */
    private readonly _state = new ActionRowState<HTMLElement>();
    /** Watches the activatable widget's `disabled`/`aria-disabled` — the live binding. */
    private _sensitivityObserver: MutationObserver | null = null;
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'subtitle', 'activatable'];
    }

    /** The end (suffix) section — append controls here imperatively. */
    get suffixSection(): HTMLDivElement {
        return this._suffixEl;
    }

    /** The start (prefix) section — append icons/widgets here imperatively. */
    get prefixSection(): HTMLDivElement {
        return this._prefixEl;
    }

    /** `Adw.ActionRow:activatable-widget` — the widget this row activates. */
    get activatableWidget(): HTMLElement | null {
        return this._state.activatableWidget;
    }

    /**
     * Set the activatable widget. Its sensitivity is copied into `activatable` right
     * away and then tracked, as libadwaita's `sensitive` → `activatable` binding does —
     * including the surprising part: clearing the widget LEAVES the row activatable.
     */
    set activatableWidget(widget: HTMLElement | null) {
        if (!this._state.setActivatableWidget(widget, widget ? isSensitive(widget) : true)) return;
        this._observeSensitivity(widget);
        this._syncActivatable();
    }

    /** Whether a click activates this row — `GtkListBoxRow:activatable`. */
    get activatable(): boolean {
        return this._state.activatable;
    }

    connectedCallback() {
        if (this._initialized) {
            // Re-entering a document: `disconnectedCallback` dropped the sensitivity
            // observer, so it has to be rebuilt here or a MOVED row is permanently blind
            // to its activatable widget becoming insensitive.
            this._observeSensitivity(this._state.activatableWidget);
            return;
        }
        this._initialized = true;

        const prefixChildren = Array.from(this.querySelectorAll(':scope > [slot="prefix"]'));
        const suffixChildren = Array.from(this.querySelectorAll(':scope > [slot="suffix"]'));

        this._prefixEl = document.createElement('div');
        this._prefixEl.className = 'adw-action-row-prefix';
        for (const child of prefixChildren) this._prefixEl.appendChild(child);

        const textEl = document.createElement('div');
        textEl.className = 'adw-action-row-text';
        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';
        this._subtitleEl = document.createElement('span');
        this._subtitleEl.className = 'adw-row-subtitle';
        textEl.append(this._titleEl, this._subtitleEl);

        this._suffixEl = document.createElement('div');
        this._suffixEl.className = 'adw-action-row-suffix';
        for (const child of suffixChildren) this._suffixEl.appendChild(child);

        this.replaceChildren(this._prefixEl, textEl, this._suffixEl);
        // `_render` runs from `attributeChangedCallback`, which a control appended into
        // `suffixSection` never triggers — the section stayed `hidden` and the control
        // measured 0x0. The observer is what keeps the two sections in step with what
        // they actually hold.
        bindEmptySections(this._prefixEl, this._suffixEl);
        // `attributeChangedCallback` was guarded until now, so a parsed row would
        // otherwise start with a stale state.
        this._adoptAttributes();
        this._render();

        this.addEventListener('click', (event) => this._onClick(event));
    }

    /** Copy the declarative attributes into the headless state. */
    private _adoptAttributes() {
        this._state.setTitle(this.getAttribute('title'));
        this._state.setSubtitle(this.getAttribute('subtitle'));
        this._state.setActivatable(this.hasAttribute('activatable'));
    }

    disconnectedCallback() {
        this._sensitivityObserver?.disconnect();
        this._sensitivityObserver = null;
    }

    attributeChangedCallback() {
        if (!this._initialized) return;
        this._adoptAttributes();
        this._render();
    }

    /**
     * `adw_action_row_activate_real`: forward the activation to the activatable widget,
     * then emit `activated`.
     *
     * A click that ORIGINATED inside the activatable widget does not activate the row at
     * all — no forwarding, no `activated`. That is GTK's answer too: the widget claims
     * the gesture, so `GtkListBox` never emits `row-activated`. It is also what keeps the
     * forwarding from looping — the synthetic click below bubbles back into this same
     * listener, and without the guard one activation emitted `activated` twice.
     */
    private _onClick(event: Event) {
        if (!this._state.activatable) return;
        const target = this._state.activate();
        if (target && event.target instanceof Node && target.contains(event.target)) return;
        target?.click();
        this.dispatchEvent(new CustomEvent('activated', { bubbles: true }));
    }

    /** (Re)point the sensitivity watcher at `widget`, or stop watching. */
    private _observeSensitivity(widget: HTMLElement | null) {
        this._sensitivityObserver?.disconnect();
        if (!widget) {
            this._sensitivityObserver = null;
            return;
        }
        this._sensitivityObserver ??= new MutationObserver(() => {
            const current = this._state.activatableWidget;
            if (current && this._state.setActivatableWidgetSensitive(isSensitive(current))) this._syncActivatable();
        });
        this._sensitivityObserver.observe(widget, { attributeFilter: SENSITIVITY_ATTRIBUTES });
    }

    /** Reflect the state's `activatable` back onto the attribute + class. */
    private _syncActivatable() {
        // Re-enters attributeChangedCallback, whose `setActivatable` is then a
        // no-op — the state already holds this value.
        this.toggleAttribute('activatable', this._state.activatable);
        if (this._initialized) this._render();
    }

    private _render() {
        const { title, titleVisible, subtitle, subtitleVisible } = this._state.state;
        this._titleEl.textContent = title;
        // `string_is_not_empty` applies to the TITLE as much as to the subtitle.
        this._titleEl.hidden = !titleVisible;
        this._subtitleEl.textContent = subtitle;
        this._subtitleEl.hidden = !subtitleVisible;
        this.classList.toggle('activatable', this._state.activatable);
    }
}

customElements.define('adw-action-row', AdwActionRow);
