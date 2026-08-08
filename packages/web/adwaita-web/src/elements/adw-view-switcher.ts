// <adw-view-switcher> — An adaptive, tab-style switcher driving a set of named
// pages: the web counterpart of Adw.ViewSwitcher, bundled with the Adw.ViewStack
// libadwaita keeps separate. Pages are declared as <adw-view-switcher-page>
// children; their own children become the page body.
//
// Everything that decides WHAT to show is HEADLESS and lives in
// `@gjsify/adwaita-core` (ADR 0004): the button-visibility rule, the
// `image-missing` icon fallback, the mnemonic-stripped label, the badge label
// and its screen-reader description, and the SELECTION — which is
// `ViewSwitcherState` over the wave-1 `ViewStackState`, so this element and the
// NativeScript twin share one set of guards and one set of conformance vectors
// (`@gjsify/adwaita-core/conformance`). This file is the DOM half only.
//
// What the lift fixed here, all of it C-derived:
//   - a page with neither title nor icon rendered an empty, clickable,
//     space-consuming tab; libadwaita hides the button outright
//     (adw-view-switcher.c:178). An EMPTY title is NOT that case — it keeps its
//     button, which is why `getAttribute` is no longer flattened with `?? ''`.
//   - a page with no icon rendered no icon at all; libadwaita substitutes
//     `image-missing` (adw-view-switcher-button.c:399-405).
//   - `active="-1"` / `active="99"` were CLAMPED into range, so an out-of-range
//     request silently switched pages; `adw_view_stack_pages_select_item`
//     refuses (adw-view-stack.c:682-684).
//   - `notify::visible-child` fired only for a click, never for a property or
//     attribute set; C notifies on every path (adw-view-stack.c:1038-1039).
//   - `notify::policy` was documented in this header and never dispatched.
//   - the declared pages were harvested with an UNSCOPED querySelectorAll, so a
//     nested switcher inside a page had its pages stolen by the outer one.
//   - the 500 ms drag-hover auto-switch did not exist
//     (adw-view-switcher-button.c:14, :58-96).
//
// Attributes:
//   policy — 'wide' | 'narrow' (default 'narrow'). An unrecognised value is
//     REJECTED and leaves the current policy alone, as `g_return_if_fail` does;
//     removing the attribute restores the default.
//   active — zero-based index of the selected PAGE. Out-of-range, negative and
//     fractional values are refused and the attribute is reflected back to the
//     selection that actually holds.
// Page attributes: name, title, icon-name, hidden (= AdwViewStackPage:visible),
//   use-underline, badge-number, needs-attention.
// Events:
//   `notify::visible-child` (CustomEvent, bubbles,
//     detail = { index, name, title, interactive }) on every selection change,
//     including the auto-pick; `interactive` is false for a model-driven one.
//   `notify::policy` (CustomEvent, bubbles, detail = { policy }).
// Reference: refs/libadwaita/src/adw-view-switcher.c (AdwViewSwitcher behaviour)
// Reference: refs/libadwaita/src/adw-view-switcher-button.c (AdwViewSwitcherButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_view-switcher.scss
// Reference: packages/nativescript-bridge/adwaita/src/widgets/view-switcher-model.ts (NS twin)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    VIEW_SWITCHER_POLICIES,
    ViewSwitcherState,
    buildViewSwitcherButtons,
    isViewSwitcherPolicy,
} from '@gjsify/adwaita-core';
// Aliased because `AdwViewSwitcherPage` is already this module's page ELEMENT —
// the custom element the package has always exported under that name.
import type {
    AdwViewSwitcherPage as AdwViewSwitcherPageInfo,
    AdwViewSwitcherPolicy,
    ViewSwitcherStateChange,
} from '@gjsify/adwaita-core';

import {
    applyDescription,
    applyIndicator,
    domViewSwitcherScheduler,
    readSwitcherPage,
    switcherIconClass,
} from './view-switcher-dom.js';

/** The DOM nodes one page owns — the switcher paints the derived model onto them. */
interface PageNodes {
    button: HTMLButtonElement;
    icon: HTMLSpanElement;
    label: HTMLSpanElement;
    indicator: HTMLSpanElement;
    body: HTMLDivElement;
}

/** A single page. Children of <adw-view-switcher>; consumed at connect time. */
export class AdwViewSwitcherPage extends HTMLElement {
    static get observedAttributes() {
        return ['name', 'title', 'icon-name', 'badge-number', 'needs-attention', 'use-underline'];
    }
}

export class AdwViewSwitcher extends HTMLElement {
    private readonly _state = new ViewSwitcherState({ scheduler: domViewSwitcherScheduler });
    private _barEl!: HTMLDivElement;
    private _contentEl!: HTMLDivElement;
    private _nodes: PageNodes[] = [];
    private _policy: AdwViewSwitcherPolicy = 'narrow';
    private _initialized = false;

    static get observedAttributes() {
        return ['policy', 'active'];
    }

    constructor() {
        super();
        // Subscribing touches no attributes and no children, so it is legal in a
        // custom element constructor — unlike anything DOM-shaped.
        this._state.subscribe((change) => this._onStateChange(change));
    }

    /** The policy controlling the button layout ('wide' | 'narrow'). */
    get policy(): AdwViewSwitcherPolicy {
        return this._policy;
    }

    set policy(value: AdwViewSwitcherPolicy) {
        this.setAttribute('policy', value);
    }

    /** Zero-based index of the selected page, `-1` when nothing is selected. */
    get active(): number {
        return this._state.selected;
    }

    set active(value: number) {
        this._state.setSelected(value);
        this._reflectActive();
    }

    /** Name of the selected page, `''` when nothing is selected. */
    get visibleChildName(): string {
        return this._state.selectedName;
    }

    set visibleChildName(name: string | null | undefined) {
        this._state.selectName(name);
    }

    /** The resolved page records a bound layout can read. */
    get pages(): readonly AdwViewSwitcherPageInfo[] {
        return this._state.pages;
    }

    /**
     * Show or hide a page (`AdwViewStackPage:visible`). Returns whether the
     * SELECTION moved — hiding the selected page falls back to the first still
     * visible one (adw-view-stack.c:1061-1082).
     */
    setPageVisible(name: string, visible: boolean): boolean {
        const moved = this._state.setPageVisible(name, visible);
        this._render();
        return moved;
    }

    connectedCallback() {
        if (this._initialized) return;

        // `:scope >` rather than a subtree scan: an unscoped query let an outer
        // switcher adopt the pages of a nested one, since both use the same tag.
        // Pages come from the stack's OWN children in C (adw-view-switcher.c:203).
        const declared = Array.from(this.querySelectorAll(':scope > adw-view-switcher-page')) as HTMLElement[];
        // Read the declared selection BEFORE adopting any page: the auto-pick
        // reflects its own index back into this very attribute.
        const declaredActive = this.getAttribute('active');

        // The single `viewswitcher` node holds the segmented button bar; a
        // sibling content area shows the selected page.
        this._barEl = document.createElement('div');
        this._barEl.className = 'adw-view-switcher-bar';
        this._barEl.setAttribute('role', 'tablist');

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-view-switcher-content';

        this._nodes = declared.map((pageEl, index) => this._buildPage(pageEl, index));
        this._barEl.append(...this._nodes.map((nodes) => nodes.button));
        this._contentEl.append(...this._nodes.map((nodes) => nodes.body));
        this.replaceChildren(this._barEl, this._contentEl);

        this._policy = this._readPolicyAttr();
        this._initialized = true;

        this._state.setPages(declared.map((pageEl) => readSwitcherPage(pageEl)));
        if (declaredActive !== null) {
            const index = Number.parseInt(declaredActive, 10);
            // A declared selection is not a user activation.
            if (!Number.isNaN(index)) this._state.setSelected(index, false);
        }
        this._render();
    }

    disconnectedCallback() {
        // A drag that leaves with the element would otherwise switch pages after
        // the widget is gone; C drops the source in dispose the same way.
        this._state.cancelDrag();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'policy') {
            const next = this._readPolicyAttr();
            if (next === this._policy) return;
            this._policy = next;
            this._render();
            this.dispatchEvent(new CustomEvent('notify::policy', { bubbles: true, detail: { policy: next } }));
            return;
        }
        if (name === 'active') {
            const raw = this.getAttribute('active');
            const index = raw === null ? Number.NaN : Number.parseInt(raw, 10);
            if (!Number.isNaN(index)) this._state.setSelected(index);
            // A refused request must not leave the attribute claiming something
            // the widget is not showing; re-reflecting is what makes "refused,
            // not clamped" observable in the DOM.
            this._reflectActive();
        }
    }

    private _buildPage(pageEl: HTMLElement, index: number): PageNodes {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'adw-view-switcher-button';
        button.setAttribute('role', 'tab');

        // Both children always exist, exactly as AdwViewSwitcherButton's template
        // does — the icon carries the `image-missing` fallback rather than
        // disappearing (adw-view-switcher-button.ui).
        const icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true'); // decorative (mask-image only)

        const label = document.createElement('span');
        label.className = 'adw-view-switcher-label';

        const indicator = document.createElement('span');
        indicator.className = 'adw-view-switcher-indicator';
        indicator.setAttribute('aria-hidden', 'true'); // announced via aria-description

        button.append(icon, label, indicator);
        button.addEventListener('click', () => {
            this._state.setSelected(index);
        });
        // GtkDropControllerMotion's enter/leave, which drive TIMEOUT_EXPAND.
        button.addEventListener('dragenter', () => this._state.dragEnter(index));
        button.addEventListener('dragleave', () => this._state.dragLeave(index));

        const body = document.createElement('div');
        body.className = 'adw-view-switcher-page';
        body.dataset.name = pageEl.getAttribute('name') ?? '';
        for (const child of Array.from(pageEl.childNodes)) body.appendChild(child);

        return { button, icon, label, indicator, body };
    }

    private _readPolicyAttr(): AdwViewSwitcherPolicy {
        const raw = this.getAttribute('policy');
        // A removed attribute falls back to the C default; an unrecognised value
        // is refused and keeps the current policy (adw_view_switcher_set_policy
        // is reached only through the enum, which rejects garbage).
        if (raw === null) return 'narrow';
        return isViewSwitcherPolicy(raw) ? raw : this._policy;
    }

    private _onStateChange(change: ViewSwitcherStateChange): void {
        this._render();
        this.dispatchEvent(
            new CustomEvent('notify::visible-child', {
                bubbles: true,
                detail: {
                    index: change.selected,
                    name: change.name,
                    title: change.title,
                    interactive: change.interactive,
                },
            }),
        );
    }

    private _render(): void {
        if (!this._initialized) return;

        // The single `viewswitcher` node carries the policy style class
        // (adw-view-switcher.c:539-545).
        for (const policy of VIEW_SWITCHER_POLICIES) this.classList.toggle(policy, policy === this._policy);

        const models = buildViewSwitcherButtons(this._state.pages, this._state.selected, this._policy);
        models.forEach((model, index) => {
            const nodes = this._nodes[index];
            if (!nodes) return;

            nodes.button.hidden = !model.visible;
            nodes.button.classList.toggle('active', model.selected);
            nodes.button.setAttribute('aria-selected', String(model.selected));
            nodes.button.tabIndex = model.selected ? 0 : -1;

            nodes.icon.className = switcherIconClass(model.iconName, 'adw-view-switcher-icon');
            nodes.label.textContent = model.label;
            nodes.label.hidden = model.label.length === 0;
            applyIndicator(nodes.indicator, model.badgeLabel, model.needsAttention);
            applyDescription(nodes.button, model.description);

            // A tab with no visible text still needs an accessible name; the
            // icon name is the only thing left to build one from.
            if (model.label) nodes.button.removeAttribute('aria-label');
            else nodes.button.setAttribute('aria-label', model.iconName);

            nodes.body.classList.toggle('active-view', model.selected);
            nodes.body.hidden = !model.selected;
        });

        this._reflectActive();
    }

    private _reflectActive(): void {
        const current = String(this._state.selected);
        if (this.getAttribute('active') !== current) this.setAttribute('active', current);
    }
}

customElements.define('adw-view-switcher-page', AdwViewSwitcherPage);
customElements.define('adw-view-switcher', AdwViewSwitcher);
