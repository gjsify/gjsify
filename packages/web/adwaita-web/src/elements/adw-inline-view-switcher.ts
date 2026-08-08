// <adw-inline-view-switcher> — A compact, toolbar-friendly view switcher (the
// web counterpart of Adw.InlineViewSwitcher). Each declared <adw-view-stack-page>
// child becomes a toggle in a toggle-group-style bar and a panel in the stack,
// and exactly one page is visible at a time.
//
// Everything that decides WHAT to show is HEADLESS and lives in
// `@gjsify/adwaita-core` (ADR 0004) — including the TWO INDEX SPACES this widget
// is built on: a hidden page produces NO toggle, so the compacted toggle index
// and the page index diverge, and libadwaita reconciles them through the
// `child-index` it stashes on every toggle (adw-inline-view-switcher.c:346,
// :114-129, :434-453). `buildInlineToggles` carries both indices, so this file
// never has to reconcile them itself.
//
// What the lift fixed here, all of it C-derived:
//   - hidden pages were not filtered at all, so the two index spaces collapsed
//     into one and `AdwViewStackPage:visible` had no spelling (:370-378).
//   - the display-mode default was 'both'; libadwaita's is 'labels' (:657, :715).
//   - an unrecognised display-mode value REPLACED the current mode with 'both';
//     `g_return_if_fail (mode <= …_BOTH)` rejects it and keeps the current one
//     (:819).
//   - the icons-mode tooltip used the RAW title, so `title="_Files"` showed the
//     underscore; C strips the mnemonic when use-underline is set (:180-188).
//   - a page with no icon rendered no icon; C substitutes `image-missing`
//     (:137-142) in every mode that builds an image at all.
//   - `active` was CLAMPED into range instead of refused, `notify::display-mode`
//     was documented but never dispatched, the page query was unscoped (so a
//     nested switcher lost its pages to the outer one), and the 500 ms
//     drag-hover auto-switch did not exist (:80, :194-236).
//
// Attributes:
//   active — zero-based index of the visible PAGE (not of the toggle). Refused,
//     never clamped, and reflected back to what actually holds.
//   display-mode — labels | icons | both (default 'labels'). An unrecognised
//     value is rejected; removing the attribute restores the default.
//   flat / round — the Adw.ToggleGroup style classes.
// Page attributes: name, title, icon-name, hidden (= AdwViewStackPage:visible),
//   use-underline, badge-number, needs-attention.
// Events:
//   `notify::active` (CustomEvent, bubbles,
//     detail = { active, name, toggleIndex, interactive }) on every selection
//     change, including the auto-pick.
//   `notify::display-mode` (CustomEvent, bubbles, detail = { displayMode }).
// Reference: refs/libadwaita/src/adw-inline-view-switcher.c (AdwInlineViewSwitcher)
// Reference: refs/libadwaita/src/stylesheet/widgets/_toggle-group.scss
// Copyright (c) 2023 Maximiliano Sandoval / 2024 GNOME Foundation Inc. (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    INLINE_VIEW_SWITCHER_DISPLAY_MODES,
    VIEW_SWITCHER_NO_SELECTION,
    ViewSwitcherState,
    buildInlineToggles,
    isInlineViewSwitcherDisplayMode,
    toggleIndexForPage,
} from '@gjsify/adwaita-core';
import type { ViewSwitcherScheduler } from '@gjsify/adwaita-core';
import type {
    AdwInlineViewSwitcherDisplayMode,
    AdwViewSwitcherPage,
    ViewSwitcherStateChange,
} from '@gjsify/adwaita-core';

import {
    applyDescription,
    applyIndicator,
    createSwitcherIcon,
    domViewSwitcherScheduler,
    readSwitcherPage,
} from './view-switcher-dom.js';

/** A single page. Children of <adw-inline-view-switcher>; consumed at connect time. */
export class AdwViewStackPage extends HTMLElement {
    static get observedAttributes() {
        return ['name', 'title', 'icon-name', 'badge-number', 'needs-attention', 'use-underline'];
    }
}

export class AdwInlineViewSwitcher extends HTMLElement {
    /**
     * The dwell timer, injectable.
     *
     * It used to be `new ViewSwitcherState({ scheduler: domViewSwitcherScheduler })`
     * inline, which left NOWHERE to hand a clock in — so
     * `VIEW_SWITCHER_DRAG_VECTORS` was driven by the core suite alone, and the
     * conformance header claimed all three suites drove it. `scheduler` is a
     * property so a test can replace it before the element connects; the DOM one
     * is the default, exactly as before.
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
    private _groupEl!: HTMLDivElement;
    private _pagesEl!: HTMLDivElement;
    private _panels: HTMLDivElement[] = [];
    private _toggles: HTMLButtonElement[] = [];
    private _displayMode: AdwInlineViewSwitcherDisplayMode = 'labels';
    private _initialized = false;
    /** The page ELEMENTS, kept because this element detaches them from the tree. */
    private _declared: HTMLElement[] = [];
    private _pageObserver: MutationObserver | undefined;

    static get observedAttributes() {
        return ['active', 'display-mode', 'flat', 'round'];
    }

    constructor() {
        super();
    }

    /** Zero-based index of the visible PAGE, `-1` when nothing is selected. */
    get active(): number {
        return this._state.selected;
    }

    set active(value: number) {
        this._state.setSelected(value);
        this._reflectActive();
    }

    /**
     * Index of the ACTIVE TOGGLE, `-1` when the visible page has none because it
     * is hidden — the port-safe `GTK_INVALID_LIST_POSITION`
     * (adw-inline-view-switcher.c:441-446).
     */
    get activeToggle(): number {
        return toggleIndexForPage(this._state.pages, this._state.selected);
    }

    /** What the toggles display: 'labels', 'icons' or 'both'. */
    get displayMode(): AdwInlineViewSwitcherDisplayMode {
        return this._displayMode;
    }

    set displayMode(value: AdwInlineViewSwitcherDisplayMode) {
        this.setAttribute('display-mode', value);
    }

    /** Name of the visible page, `''` when nothing is selected. */
    get visibleChildName(): string {
        return this._state.selectedName;
    }

    set visibleChildName(name: string | null | undefined) {
        this._state.selectName(name);
    }

    /** The resolved page records. */
    get pages(): readonly AdwViewSwitcherPage[] {
        return this._state.pages;
    }

    /**
     * Show or hide a page. Returns whether the SELECTION moved. Rebuilds the
     * toggle row, because a hidden page has no toggle at all — C reacts to a
     * page's `notify::visible` with `recreate_toggles`
     * (adw-inline-view-switcher.c:425, :471-477).
     */
    setPageVisible(name: string, visible: boolean): boolean {
        const moved = this._state.setPageVisible(name, visible);
        this._rebuildToggles();
        return moved;
    }

    connectedCallback() {
        if (this._initialized) return;

        // `:scope >` rather than a subtree scan — `<adw-view-stack>` uses the
        // same tag for its pages, so an unscoped query adopted a nested stack's.
        const declared = Array.from(this.querySelectorAll(':scope > adw-view-stack-page')) as HTMLElement[];
        const declaredActive = this.getAttribute('active');

        this._groupEl = document.createElement('div');
        this._groupEl.className = 'adw-inline-view-switcher-group';
        this._groupEl.setAttribute('role', 'tablist');

        this._pagesEl = document.createElement('div');
        this._pagesEl.className = 'adw-inline-view-switcher-pages';

        this._panels = declared.map((pageEl) => {
            const panel = document.createElement('div');
            panel.className = 'adw-inline-view-switcher-page';
            panel.setAttribute('role', 'tabpanel');
            panel.dataset.name = pageEl.getAttribute('name') ?? '';
            for (const child of Array.from(pageEl.childNodes)) panel.appendChild(child);
            this._pagesEl.appendChild(panel);
            return panel;
        });

        this.replaceChildren(this._groupEl, this._pagesEl);

        this._displayMode = this._readDisplayModeAttr();
        this._initialized = true;

        this._declared = declared;
        this._watchPages();
        this._state.setPages(declared.map((pageEl) => readSwitcherPage(pageEl)));
        if (declaredActive !== null) {
            const index = Number.parseInt(declaredActive, 10);
            if (!Number.isNaN(index)) this._state.setSelected(index, false);
        }
        this._rebuildToggles();
    }

    disconnectedCallback() {
        this._state.cancelDrag();
        this._pageObserver?.disconnect();
        this._pageObserver = undefined;
    }

    /**
     * Re-read every declared page and push it into the state.
     *
     * Driven by {@link _watchPages}, which is what makes a runtime
     * `badge-number` or `icon-name` change reach the toggle — C rebinds on every
     * page `notify` (adw-view-switcher.c:184-193) and this element did not.
     */
    refreshPages(): void {
        if (!this._initialized) return;
        this._state.setPages(this._declared.map((pageEl) => readSwitcherPage(pageEl)));
        this._rebuildToggles();
    }

    /**
     * Watch the declared pages for attribute changes — the DOM's `notify::` on
     * `AdwViewStackPage`, which C binds per page (adw-view-switcher.c:184-193).
     *
     * A `MutationObserver` rather than an `attributeChangedCallback`: this
     * element consumes the page elements at connect and `replaceChildren`s them
     * out of the tree, so a detached page cannot find its owner. It delivers on
     * a MICROTASK where GTK's notify is synchronous — invisible to a user, and
     * nothing here reads the toggle back inside the setter.
     */
    private _watchPages(): void {
        this._pageObserver?.disconnect();
        this._pageObserver = new MutationObserver(() => this.refreshPages());
        for (const pageEl of this._declared) this._pageObserver.observe(pageEl, { attributes: true });
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'active') {
            const raw = this.getAttribute('active');
            const index = raw === null ? Number.NaN : Number.parseInt(raw, 10);
            if (!Number.isNaN(index)) this._state.setSelected(index);
            this._reflectActive();
            return;
        }
        if (name === 'display-mode') {
            const next = this._readDisplayModeAttr();
            if (next === this._displayMode) return;
            this._displayMode = next;
            // C rebuilds every toggle's child on a mode change rather than
            // toggling visibility on the existing ones (:852-854).
            this._rebuildToggles();
            this.dispatchEvent(
                new CustomEvent('notify::display-mode', { bubbles: true, detail: { displayMode: next } }),
            );
            return;
        }
        // flat / round are styling-only.
        this._applyStyleClasses();
    }

    private _readDisplayModeAttr(): AdwInlineViewSwitcherDisplayMode {
        const raw = this.getAttribute('display-mode');
        if (raw === null) return 'labels';
        return isInlineViewSwitcherDisplayMode(raw) ? raw : this._displayMode;
    }

    /**
     * Rebuild the toggle row from the derived models. One node per VISIBLE page,
     * in compacted order — the structural half of `recreate_toggles`. Selection
     * alone never lands here: `selection_changed_cb` only sets the active toggle
     * (adw-inline-view-switcher.c:434-453), and rebuilding mid-drag would drop
     * the dwell the drag has already armed.
     */
    private _rebuildToggles(): void {
        if (!this._initialized) return;

        const models = buildInlineToggles(this._state.pages, this._displayMode);
        this._groupEl.replaceChildren();
        this._toggles = models.map((model) => {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'adw-inline-view-switcher-toggle';
            toggle.setAttribute('role', 'tab');
            // Both index spaces, so a consumer never has to recompute either.
            toggle.dataset.pageIndex = String(model.pageIndex);
            toggle.dataset.toggleIndex = String(model.toggleIndex);

            if (model.showIcon) {
                toggle.appendChild(createSwitcherIcon(model.iconName, 'adw-inline-view-switcher-icon'));
            }
            if (model.showLabel) {
                const label = document.createElement('span');
                label.className = 'adw-inline-view-switcher-label';
                label.textContent = model.label;
                toggle.appendChild(label);
            }

            const indicator = document.createElement('span');
            indicator.className = 'adw-inline-view-switcher-indicator';
            indicator.setAttribute('aria-hidden', 'true');
            applyIndicator(indicator, model.badgeLabel, model.needsAttention);
            toggle.appendChild(indicator);

            if (model.tooltip) toggle.title = model.tooltip;
            // An icon-only toggle has no visible text; the tooltip is also its
            // accessible name, which is exactly what C's toggle does.
            if (!model.showLabel) toggle.setAttribute('aria-label', model.tooltip || model.iconName);
            applyDescription(toggle, model.description);

            toggle.addEventListener('click', () => {
                this._state.setSelected(model.pageIndex);
            });
            // The `relatedTarget` test is load-bearing: a toggle holds an icon,
            // a label and an indicator, and the DOM fires `dragleave` +
            // `dragenter` when the pointer crosses BETWEEN them — which cleared
            // the dwell timer and re-armed a fresh 500ms, so a drag that merely
            // slid across the toggle never switched the page. C has one
            // `GtkDropControllerMotion` per BUTTON widget
            // (adw-view-switcher-button.c:79-96), which has no internal edges.
            toggle.addEventListener('dragenter', (event) => {
                if (toggle.contains((event as DragEvent).relatedTarget as Node | null)) return;
                this._state.dragEnter(model.pageIndex);
            });
            toggle.addEventListener('dragleave', (event) => {
                if (toggle.contains((event as DragEvent).relatedTarget as Node | null)) return;
                this._state.dragLeave(model.pageIndex);
            });

            this._groupEl.appendChild(toggle);
            return toggle;
        });

        this._render();
    }

    private _onStateChange(change: ViewSwitcherStateChange): void {
        this._render();
        this.dispatchEvent(
            new CustomEvent('notify::active', {
                bubbles: true,
                detail: {
                    active: change.selected,
                    name: change.name,
                    toggleIndex: this.activeToggle,
                    interactive: change.interactive,
                },
            }),
        );
    }

    private _render(): void {
        if (!this._initialized) return;

        this._applyStyleClasses();

        const activeToggle = this.activeToggle;
        this._toggles.forEach((toggle, toggleIndex) => {
            const isActive = toggleIndex === activeToggle && activeToggle !== VIEW_SWITCHER_NO_SELECTION;
            toggle.classList.toggle('active', isActive);
            toggle.setAttribute('aria-selected', String(isActive));
            toggle.tabIndex = isActive ? 0 : -1;
        });

        const selected = this._state.selected;
        this._panels.forEach((panel, index) => {
            const isActive = index === selected;
            panel.classList.toggle('active-view', isActive);
            panel.hidden = !isActive;
        });

        this._reflectActive();
    }

    private _applyStyleClasses(): void {
        this.classList.toggle('flat', this.hasAttribute('flat'));
        this.classList.toggle('round', this.hasAttribute('round'));
        // The group carries the display-mode class, mirroring libadwaita's
        // inline-view-switcher > toggle-group.{labels,icons,both} (:826-850).
        for (const mode of INLINE_VIEW_SWITCHER_DISPLAY_MODES) {
            this._groupEl.classList.toggle(mode, mode === this._displayMode);
        }
    }

    private _reflectActive(): void {
        const current = String(this._state.selected);
        if (this.getAttribute('active') !== current) this.setAttribute('active', current);
    }
}

customElements.define('adw-view-stack-page', AdwViewStackPage);
customElements.define('adw-inline-view-switcher', AdwInlineViewSwitcher);
