// <adw-view-switcher> — An adaptive, tab-style switcher driving a set of named
// pages: the web counterpart of Adw.ViewSwitcher, bundled with the Adw.ViewStack
// libadwaita keeps separate. Pages are declared as <adw-view-switcher-page>
// children; their own children become the page body.
//
// Everything that decides WHAT to show is HEADLESS, in `@gjsify/adwaita-core`
// (ADR 0004): `ViewSwitcherState` over the wave-1 `ViewStackState`, so this
// element and the NativeScript twin share one set of guards and one set of
// conformance vectors. This file is the DOM half only.
//
// The C rules that are not visible in the DOM code:
//   - a page with NEITHER title NOR icon has no button at all. An EMPTY title is not
//     that case — it keeps its button, hence no `?? ''` flattening of `getAttribute`.
//   - a page with no icon gets `image-missing`, not nothing.
//   - an out-of-range, negative or fractional `active` is REFUSED, not clamped
//     (`adw_view_stack_pages_select_item`), and the attribute is reflected back to the
//     selection that actually holds.
//   - `notify::visible-child` fires on EVERY path, property and attribute sets
//     included, not only on a click.
//   - a drag hovering a button auto-switches after 500 ms.
//   - `policy` defaults 'narrow'; an unrecognised value is refused and leaves the
//     current policy alone, removing the attribute restores the default.
//
// A page's `hidden` attribute is `AdwViewStackPage:visible` inverted. Both events
// bubble; `notify::visible-child` carries `{ index, name, title, interactive }`, where
// `interactive` is false for a model-driven change such as the auto-pick.
//
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
import type { ViewSwitcherScheduler } from '@gjsify/adwaita-core';
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
    applySwitcherIcon,
    domViewSwitcherScheduler,
    readSwitcherPage,
} from './view-switcher-dom.js';
import { type AdwIcon, createAdwIcon } from './adw-icon.js';
import { attachRovingFocus } from './roving-focus.js';

/** The DOM nodes one page owns — the switcher paints the derived model onto them. */
interface PageNodes {
    button: HTMLButtonElement;
    icon: AdwIcon;
    label: HTMLSpanElement;
    indicator: HTMLSpanElement;
    body: HTMLDivElement;
}

/**
 * A single page. Children of `<adw-view-switcher>`; consumed at connect time.
 *
 * Deliberately carries NO `observedAttributes` and no `attributeChangedCallback`:
 * the switcher consumes these elements at connect and `replaceChildren`s them
 * away, so a detached page has no `closest` to reach its owner through. The
 * switcher watches them with a `MutationObserver` instead — the DOM stand-in for
 * the per-page `notify` C rebinds on.
 */
export class AdwViewSwitcherPage extends HTMLElement {}

export class AdwViewSwitcher extends HTMLElement {
    /**
     * The dwell timer, injectable so a test can hand in a clock and drive
     * `VIEW_SWITCHER_DRAG_VECTORS` against the real element. Replace it before the
     * element connects.
     */
    scheduler: ViewSwitcherScheduler = domViewSwitcherScheduler;
    private _stateInstance: ViewSwitcherState | null = null;

    /** Built on first access, so a `scheduler` set before connect is the one used. */
    private get _state(): ViewSwitcherState {
        if (!this._stateInstance) {
            this._stateInstance = new ViewSwitcherState({ scheduler: this.scheduler });
            this._stateInstance.subscribe((change) => this._onStateChange(change));
        }
        return this._stateInstance;
    }
    private _barEl!: HTMLDivElement;
    private _contentEl!: HTMLDivElement;
    private _nodes: PageNodes[] = [];
    /** The page ELEMENTS, kept because the switcher detaches them from the tree. */
    private _declared: HTMLElement[] = [];
    private _pageObserver: MutationObserver | undefined;
    private _policy: AdwViewSwitcherPolicy = 'narrow';
    private _initialized = false;

    static get observedAttributes() {
        return ['policy', 'active'];
    }

    constructor() {
        super();
    }

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

    get visibleChildName(): string {
        return this._state.selectedName;
    }

    set visibleChildName(name: string | null | undefined) {
        this._state.selectName(name);
    }

    get pages(): readonly AdwViewSwitcherPageInfo[] {
        return this._state.pages;
    }

    /**
     * Show or hide a page (`AdwViewStackPage:visible`). Returns whether the
     * SELECTION moved — hiding the selected page falls back to the first still
     * visible one.
     */
    setPageVisible(name: string, visible: boolean): boolean {
        const moved = this._state.setPageVisible(name, visible);
        this._render();
        return moved;
    }

    connectedCallback() {
        if (this._initialized) {
            // Re-entering a document: `disconnectedCallback` drops the page observer on
            // the way out, so a switcher that was merely MOVED (a slideshow slide, a
            // route change) has to get it back here or it stops noticing page changes.
            this._watchPages();
            return;
        }

        // `:scope >`, not a subtree scan: an unscoped query lets an outer switcher
        // adopt a nested one's pages, since both use the same tag. Pages come from
        // the stack's OWN children in C.
        const declared = Array.from(this.querySelectorAll(':scope > adw-view-switcher-page')) as HTMLElement[];
        // Read BEFORE adopting any page: the auto-pick reflects its own index back
        // into this very attribute.
        const declaredActive = this.getAttribute('active');

        this._barEl = document.createElement('div');
        this._barEl.className = 'adw-view-switcher-bar';
        this._barEl.setAttribute('role', 'tablist');
        // What makes the roving tabindex below navigable: without it the unselected
        // buttons are reachable by no key at all.
        attachRovingFocus({
            host: this,
            orientation: 'horizontal',
            items: () => this._nodes.map((nodes) => nodes.button).filter((button) => !button.hidden),
            select: (item) => this._state.setSelected(Number(item.dataset.pageIndex)),
        });

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-view-switcher-content';

        this._declared = declared;
        this._watchPages();
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
        // A drag that leaves with the element would otherwise switch pages after the
        // widget is gone; C drops the source in dispose the same way.
        this._state.cancelDrag();
        this._pageObserver?.disconnect();
        this._pageObserver = undefined;
    }

    /**
     * Re-read every declared page and push it into the state. Driven by the
     * `MutationObserver` in {@link _watchPages}, which is what makes a runtime
     * `badge-number` change reach the button. `setPages` keeps the selection where it
     * can, so this is a repaint and not a reset.
     */
    refreshPages(): void {
        if (!this._initialized) return;
        this._state.setPages(this._declared.map((pageEl) => readSwitcherPage(pageEl)));
        this._render();
    }

    /**
     * Watch the declared pages for attribute changes — the DOM's `notify::` on
     * `AdwViewStackPage`, which C's `update_button` binds per page. See
     * {@link AdwViewSwitcherPage} for why an observer and not a callback.
     *
     * MODIFICATION: delivers on a MICROTASK where GTK's notify is synchronous —
     * invisible to a user, and nothing here reads the button back inside a setter.
     */
    private _watchPages(): void {
        this._pageObserver?.disconnect();
        this._pageObserver = new MutationObserver(() => this.refreshPages());
        for (const pageEl of this._declared) this._pageObserver.observe(pageEl, { attributes: true });
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
        // The page index, so a keyboard move resolves an item back to a page without
        // recomputing the mapping — the spelling `<adw-inline-view-switcher>` uses.
        button.dataset.pageIndex = String(index);

        // Both children always exist, as in AdwViewSwitcherButton's template — the icon
        // carries `image-missing` rather than disappearing.
        const icon = createAdwIcon(null, 'adw-view-switcher-icon');

        const label = document.createElement('span');
        label.className = 'adw-view-switcher-label';

        const indicator = document.createElement('span');
        indicator.className = 'adw-view-switcher-indicator';
        indicator.setAttribute('aria-hidden', 'true'); // announced via aria-description

        button.append(icon, label, indicator);
        button.addEventListener('click', () => {
            this._state.setSelected(index);
        });
        // GtkDropControllerMotion's enter/leave, which drive TIMEOUT_EXPAND. The
        // `relatedTarget` containment test is load-bearing: the button contains an icon
        // and a label, and the DOM fires `dragleave` + `dragenter` when the pointer
        // crosses BETWEEN them. Since `leave` clears the dwell timer and `enter` re-arms
        // a fresh 500 ms, an untested crossing restarts the countdown forever. C's one
        // `GtkDropControllerMotion` per BUTTON has no such internal edges.
        button.addEventListener('dragenter', (event) => {
            if (button.contains((event as DragEvent).relatedTarget as Node | null)) return;
            this._state.dragEnter(index);
        });
        button.addEventListener('dragleave', (event) => {
            if (button.contains((event as DragEvent).relatedTarget as Node | null)) return;
            this._state.dragLeave(index);
        });

        const body = document.createElement('div');
        body.className = 'adw-view-switcher-page';
        body.dataset.name = pageEl.getAttribute('name') ?? '';
        for (const child of Array.from(pageEl.childNodes)) body.appendChild(child);

        return { button, icon, label, indicator, body };
    }

    private _readPolicyAttr(): AdwViewSwitcherPolicy {
        const raw = this.getAttribute('policy');
        // A removed attribute falls back to the C default; an unrecognised value is
        // refused and keeps the current policy, since `adw_view_switcher_set_policy` is
        // reached only through the enum, which rejects garbage.
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

        // The single `viewswitcher` node carries the policy style class.
        for (const policy of VIEW_SWITCHER_POLICIES) this.classList.toggle(policy, policy === this._policy);

        const models = buildViewSwitcherButtons(this._state.pages, this._state.selected, this._policy);
        models.forEach((model, index) => {
            const nodes = this._nodes[index];
            if (!nodes) return;

            nodes.button.hidden = !model.visible;
            nodes.button.classList.toggle('active', model.selected);
            nodes.button.setAttribute('aria-selected', String(model.selected));
            nodes.button.tabIndex = model.selected ? 0 : -1;

            applySwitcherIcon(nodes.icon, model.iconName);
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
