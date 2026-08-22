// <adw-expander-row> — a boxed-list row that discloses nested rows when expanded,
// with an optional enable switch. Mirrors Adw.ExpanderRow.
//
// Slots: `slot="prefix"` / `slot="suffix"` children sit in the HEADER row beside the
// title (before the enable switch and disclosure chevron), like Adw.ExpanderRow's
// add_prefix/add_suffix; every other child is moved into the disclosed content
// listbox. The `notify::expanded` / `notify::enable-expansion` events are named after
// Adw.ExpanderRow's GObject signals so one code path drives the web and GTK renderers.
//
// The DISCLOSURE state (the expanded flag and its idempotent, notify-on-change
// transitions) is HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004) as
// {@link ExpanderState}; this element keeps only the DOM half — header/content markup,
// the `expanded` attribute reflection and the event.
//
// Reference: refs/adwaita-web/adwaita-web/scss/_expander_row.scss
// Reference: refs/libadwaita/src/stylesheet/widgets/_lists.scss (AdwExpanderRow)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// disclosure state machine composed from @gjsify/adwaita-core, the enable
// switch from <adw-switch> and the chevron from <adw-icon>.

import { ExpanderState, deriveRowLabels } from '@gjsify/adwaita-core';

import { bindEmptySections } from '../empty-sections.js';

// SIDE-EFFECT import, deliberately separate from the type import below: it guarantees
// `adw-switch` is defined before this module's `customElements.define` can upgrade a
// server-rendered `<adw-expander-row>` and build one. A combined
// `import { AdwSwitch }` would NOT do it — the binding is only used in type position,
// and this package compiles without `verbatimModuleSyntax`, so TypeScript would elide
// the statement and take the registration with it.
import './adw-switch.js';
import type { AdwSwitch } from './adw-switch.js';
import { type AdwIcon, createAdwIcon } from './adw-icon.js';
import { attachRowActivation } from './row-activation.js';

export class AdwExpanderRow extends HTMLElement {
    private _headerEl!: HTMLDivElement;
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    private _enableSwitch!: AdwSwitch;
    private _chevronEl!: AdwIcon;
    private _contentEl!: HTMLDivElement;
    private _prefixEl!: HTMLDivElement;
    private _suffixEl!: HTMLDivElement;
    /** The headless expanded/collapsed disclosure state machine (ADR 0004). */
    private readonly _state = new ExpanderState();
    private _initialized = false;
    /**
     * Guards the enable switch's `notify::active` while WE are the ones writing
     * it. Only a user toggle publishes `notify::enable-expansion`; a programmatic
     * `enableExpansion = …` re-syncs the control silently, as it always has.
     */
    private _reflectingEnable = false;

    constructor() {
        super();
        // Subscribed in the constructor, NOT connectedCallback, so a disclosure set
        // before the element is connected still reflects to the attribute. The
        // custom-element constructor rules allow it: nothing touches the DOM until the
        // state actually changes.
        this._state.subscribe((expanded) => {
            if (expanded) this.setAttribute('expanded', '');
            else this.removeAttribute('expanded');
            if (this._initialized) this._render();
        });
    }

    static get observedAttributes() {
        return ['title', 'subtitle', 'expanded', 'enable-expansion', 'show-enable-switch'];
    }

    get expanded(): boolean {
        return this._state.expanded;
    }

    set expanded(value: boolean) {
        this._state.setExpanded(value);
    }

    get enableExpansion(): boolean {
        return !this.hasAttribute('enable-expansion') || this.getAttribute('enable-expansion') !== 'false';
    }

    set enableExpansion(value: boolean) {
        this.setAttribute('enable-expansion', value ? 'true' : 'false');
    }

    /** The disclosed content section — append nested rows here imperatively. */
    get contentSection(): HTMLDivElement {
        return this._contentEl;
    }

    /** The header suffix section — append controls here imperatively. */
    get suffixSection(): HTMLDivElement {
        return this._suffixEl;
    }

    /** The header prefix section — append icons/widgets here imperatively. */
    get prefixSection(): HTMLDivElement {
        return this._prefixEl;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        const prefixChildren = Array.from(this.querySelectorAll(':scope > [slot="prefix"]'));
        const suffixChildren = Array.from(this.querySelectorAll(':scope > [slot="suffix"]'));
        const claimed = new Set<Node>([...prefixChildren, ...suffixChildren]);
        const rows = Array.from(this.childNodes).filter((node) => !claimed.has(node));

        this._headerEl = document.createElement('div');
        this._headerEl.className = 'adw-expander-row-header';

        const textEl = document.createElement('div');
        textEl.className = 'adw-row-text';
        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';
        this._subtitleEl = document.createElement('span');
        this._subtitleEl.className = 'adw-row-subtitle';
        textEl.append(this._titleEl, this._subtitleEl);

        // Clicking the enable switch does NOT toggle the disclosure.
        this._enableSwitch = document.createElement('adw-switch') as AdwSwitch;
        this._enableSwitch.classList.add('adw-expander-row-enable-switch');
        this._enableSwitch.active = this.enableExpansion;

        this._chevronEl = createAdwIcon('go-down', 'adw-expander-row-chevron');

        this._prefixEl = document.createElement('div');
        this._prefixEl.className = 'adw-expander-row-prefix';
        for (const child of prefixChildren) this._prefixEl.appendChild(child);

        this._suffixEl = document.createElement('div');
        this._suffixEl.className = 'adw-expander-row-suffix';
        for (const child of suffixChildren) this._suffixEl.appendChild(child);

        // Same reason as the action row's: `_render` is attribute-driven, and a widget
        // appended into `prefixSection` after connect is a childList change nothing else
        // hears. `contentSection` is NOT in here — an empty disclosure is still the
        // disclosure, and `.expanded` alone decides whether it shows.
        bindEmptySections(this._prefixEl, this._suffixEl);

        this._headerEl.append(this._prefixEl, textEl, this._suffixEl, this._enableSwitch, this._chevronEl);

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-expander-row-content';
        for (const row of rows) this._contentEl.appendChild(row);

        this.replaceChildren(this._headerEl, this._contentEl);

        this._headerEl.addEventListener('click', (event) => {
            // Clicks on the enable switch toggle expansion-enable, not disclosure.
            if (this._enableSwitch.contains(event.target as Node)) return;
            // The core state machine flips, reflects and re-renders; the event is emitted
            // here so only a USER disclosure notifies — a programmatic `expanded = …`
            // stays silent.
            if (this._state.toggle()) {
                this.dispatchEvent(
                    new CustomEvent('notify::expanded', { bubbles: true, detail: { expanded: this.expanded } }),
                );
            }
        });

        // adw-expander-row.c:123 — `grab_focus` forwards to the header row, so the header
        // is both the focus target and the disclosure control. Enter and Space go through
        // its click handler, which is what a pointer already uses.
        attachRowActivation({ row: this._headerEl, activatable: () => true });

        this._enableSwitch.addEventListener('notify::active', (event) => {
            // The switch's own notify stops at the row: the row publishes
            // `notify::enable-expansion`, and letting `notify::active` past would give
            // every ancestor listener a second, differently-named event for one action.
            event.stopPropagation();
            if (this._reflectingEnable) return;
            const enabled = this._enableSwitch.active;
            this.setAttribute('enable-expansion', enabled ? 'true' : 'false');
            this.dispatchEvent(
                new CustomEvent('notify::enable-expansion', {
                    bubbles: true,
                    detail: { enableExpansion: enabled },
                }),
            );
        });

        // Seed the disclosure from the parsed markup: attributeChangedCallback is guarded
        // until the element is initialized, so a declarative `expanded` lands here.
        this._state.setExpanded(this.hasAttribute('expanded'));
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'expanded') this._state.setExpanded(this.hasAttribute('expanded'));
        this._render();
    }

    private _render() {
        // The `string_is_not_empty` label rule, from core — it hides the TITLE too, not
        // just the subtitle.
        const labels = deriveRowLabels({
            title: this.getAttribute('title'),
            subtitle: this.getAttribute('subtitle'),
        });
        this._titleEl.textContent = labels.title;
        this._titleEl.hidden = !labels.titleVisible;
        this._subtitleEl.textContent = labels.subtitle;
        this._subtitleEl.hidden = !labels.subtitleVisible;

        const showSwitch = this.hasAttribute('show-enable-switch');
        this._enableSwitch.hidden = !showSwitch;
        // OUR write, not the user's — see `_reflectingEnable`.
        this._reflectingEnable = true;
        this._enableSwitch.active = this.enableExpansion;
        this._reflectingEnable = false;

        this.classList.toggle('expanded', this.expanded);
        // adw-expander-row.c:657 keeps GTK_ACCESSIBLE_STATE_EXPANDED on the header row in
        // step with the flag; `aria-expanded` is the same statement to the same reader.
        this._headerEl.setAttribute('aria-expanded', String(this.expanded));
        this._contentEl.classList.toggle('expanded', this.expanded);
    }
}

customElements.define('adw-expander-row', AdwExpanderRow);
