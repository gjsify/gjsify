// <adw-tab-bar> — libadwaita's tab bar as the separate WIDGET it is: a strip of chips
// bound to an `<adw-tab-view>` through `Adw.TabBar:view`, with action widgets on either
// side of the tabs.
//
// WHY A SECOND BAR. Upstream the bar is its own `G_DEFINE_FINAL_TYPE` over `AdwTabBox`
// (adw-tab-bar.c:90), and `<adw-tab-view>` here carries a MERGED one: the bar that widget
// drew before this element existed is still what it draws, and this file does not change
// that. What changes is that a document can now put the two parts together the way
// libadwaita does — a bar over a view, or a bar over a view it does not own — which is the
// only reason `Adw.TabBar` has a block here at all.
//
// `view` is a widget REFERENCE (`Adw.TabView`), which on this renderer is an element id the
// way `<adw-tab-button view>` and `<adw-view-switcher-bar stack>` are one; the property
// setter takes the element directly for code. Both are the same shape of divergence:
// `scripts/generate-adwaita-attribute-comments.mjs`'s `id-reference` ledger entry.
//
// THE CHIP AND THE TWO MEASUREMENTS live in `../tab-chip.js`, shared with `<adw-tab-view>`
// so the two bars cannot drift apart; what is here is what is genuinely this widget's —
// the scroll window, the selection, the reveal rule and the two action slots.
//
// THE C RULES THE DOM DOES NOT SHOW:
//   - `tabs-revealed` hides the strip when the view has 0 or 1 tab, no pinned tab and no
//     tab in flight (`adw_tab_bar_update_tabs_revealed`), which `tabsRevealed` from
//     `@gjsify/adwaita-core` decides — the same call `<adw-tab-view>` makes for its own
//     bar, over the same three terms.
//   - `is-overflowing` is the strip's own adjustment: not the chip count, not a width
//     estimate. It is `scrollWidth > clientWidth`, which is what the revealer over the box
//     (`tabbox > revealer > indicator`) and the scrolled window agree on.
//   - a lone tab draws no background (`tabbox.single-tab tab`), and the separators either
//     side of the SELECTED or HOVERED tab are the ones C hides (`update_separators`).
//   - `inverted` puts the close button at the BEGINNING of a non-pinned tab and the
//     indicator at the end, rather than the opposite (adw-tab-bar.c:636-644).
//
// MODIFICATIONS, both about defaults an HTML boolean attribute cannot carry. `autohide` and
// `expand-tabs` default TRUE upstream (`DEFAULT_TAB_AUTOHIDE`, and the tab box's own
// default), and a present attribute is the only spelling a markup fence has, so both are
// OPT-IN here: `autohide` on the element hides the strip with a single tab, and without
// `expand-tabs` the chips sit at their minimum size. `<adw-tab-view>`'s merged bar made the
// same trade for `autohide` and says so in its header.
//
// NOT PORTED: `setup_extra_drop_target`'s PRELOAD step. `extra-drag-preload` is observed
// and exposed, the `extra-drag-value` signal is dispatched on hover-start with a `NULL`
// action exactly as C does, and `extra-drag-preferred-action` carries whatever a handler
// put there — but a browser only exposes drag data at DROP time (`DataTransfer.getData`
// returns nothing during `dragover`, by the HTML drag and drop specification), so the
// "read the data while the pointer is still over the widget" half has nothing to read. The
// hover-start signal is emitted either way, which is the part of the contract an
// application acts on.
//
// Events (all CustomEvent, all bubbling): `notify::view`, `notify::autohide`,
// `notify::expand-tabs`, `notify::inverted`, `notify::extra-drag-preload`
// (`detail: { <prop> }`); `extra-drag-value` (`{ action }`, `action` is `null` on
// hover-start and whatever a handler set on the next hover); and `extra-drag-drop`
// (`{ action, data }`), CANCELABLE, whose `preventDefault()` refuses the drop — the C
// handler's `TRUE`/`FALSE` return.
//
// A11Y: `role="tablist"` on the host over real `<button role="tab">` children, so Enter and
// Space arrive through the platform, and the roving tabindex moves with the selection.
//
// KNOWN_GAPS: none, and not by omission. `AdwTabBar` declares seven WRITABLE properties
// (`generated/props.ts`), three of them widget-valued and out of the ledger's scope; the
// other four — `autohide`, `expand-tabs`, `inverted` and `extra-drag-preload` — are all
// attributes here. Its three read-ONLY properties (`tabs-revealed`, `is-overflowing`,
// `extra-drag-preferred-action`) are getters rather than attributes, and the generated
// table carries no row for a property nothing can set.
//
// Reference: refs/libadwaita/src/adw-tab-bar.c (view, action widgets, autohide,
//   expand-tabs, inverted, is-overflowing, extra drop target, tabs-revealed)
// Reference: refs/libadwaita/src/adw-tab-box.c (the box, its single-tab class, SPACING)
// Reference: refs/libadwaita/src/stylesheet/widgets/_tab-view.scss:1-113 (tabbar, tabbox,
//   tab, start/end action) and :154-176 (the chip's own metrics)
// Copyright (c) 2024-2025 Alice Mikhaylenko / Purism SPC. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; `view` is an
//   element id, the drag target is the DOM drag and drop API, and the chips are the shared
//   ones from `../tab-chip.js`.

import { tabsRevealed } from '@gjsify/adwaita-core';

import { bindSlottedChildren } from '../slotted-children.js';
import { type TabChip, createTabChip, refreshTabChip, refreshTabChipClose, scrollChipIntoBar } from '../tab-chip.js';
import type { AdwTabView } from './adw-tab-view.js';

/** `set_view`'s connections: the page list, the selection, and each page's own state. */
const VIEW_EVENTS = [
    'page-attached',
    'page-detached',
    'page-reordered',
    'page-updated',
    'page-pinned',
    'notify::selected-page',
] as const;

/** The CSS classes a chip's own layout reads — the states C puts on the widget. */

export class AdwTabBar extends HTMLElement {
    private _boxEl!: HTMLDivElement;
    private _startEl!: HTMLDivElement;
    private _endEl!: HTMLDivElement;
    private _indicatorEl!: HTMLDivElement;
    private _chips = new Map<string, TabChip>();
    private _hovered = new Set<string>();
    private _view: AdwTabView | null = null;
    private _initialized = false;
    private _preferredAction: string | null = null;
    private _dropTypes: readonly string[] = [];
    private _dropActions: readonly string[] = [];
    private _dropArmed = false;

    static get observedAttributes() {
        return ['view', 'autohide', 'expand-tabs', 'inverted', 'extra-drag-preload'];
    }

    /** `Adw.TabBar:view` — the tab view this bar controls. */
    get view(): AdwTabView | null {
        return this._view;
    }

    set view(value: AdwTabView | string | null) {
        this.setView(value === null ? null : typeof value === 'string' ? this._resolveView(value) : value);
    }

    /**
     * `Adw.TabBar:start-action-widget` — the widget shown BEFORE the tabs.
     *
     * READ OUT OF THE BIN rather than remembered: a `slot="start-action-widget"` child and
     * this setter are two spellings of one property, and a second copy of the truth is where
     * they drift apart. `bindSlottedChildren` moves the node; the bin holds it.
     */
    get startActionWidget(): HTMLElement | null {
        return (this._startEl?.firstElementChild as HTMLElement | null) ?? null;
    }

    set startActionWidget(widget: HTMLElement | null) {
        if (this.startActionWidget === widget) return;
        this._startEl.replaceChildren(...(widget === null ? [] : [widget]));
        this.dispatchEvent(new CustomEvent('notify::start-action-widget', { bubbles: true, detail: { widget } }));
    }

    /** `Adw.TabBar:end-action-widget` — the widget shown AFTER the tabs. */
    get endActionWidget(): HTMLElement | null {
        return (this._endEl?.firstElementChild as HTMLElement | null) ?? null;
    }

    set endActionWidget(widget: HTMLElement | null) {
        if (this.endActionWidget === widget) return;
        this._endEl.replaceChildren(...(widget === null ? [] : [widget]));
        this.dispatchEvent(new CustomEvent('notify::end-action-widget', { bubbles: true, detail: { widget } }));
    }

    /**
     * `Adw.TabBar:autohide` — whether the strip hides itself when it has nothing to show.
     * TRUE upstream, opt-in here; see the header.
     */
    get autohide(): boolean {
        return this.hasAttribute('autohide');
    }

    set autohide(value: boolean) {
        if (value) this.setAttribute('autohide', '');
        else this.removeAttribute('autohide');
    }

    /** `Adw.TabBar:expand-tabs` — chips fill the strip instead of sitting at minimum size. */
    get expandTabs(): boolean {
        return this.hasAttribute('expand-tabs');
    }

    set expandTabs(value: boolean) {
        if (value) this.setAttribute('expand-tabs', '');
        else this.removeAttribute('expand-tabs');
    }

    /** `Adw.TabBar:inverted` — close button first, indicator last. */
    get inverted(): boolean {
        return this.hasAttribute('inverted');
    }

    set inverted(value: boolean) {
        if (value) this.setAttribute('inverted', '');
        else this.removeAttribute('inverted');
    }

    /** `Adw.TabBar:extra-drag-preload` — see the header for the half a browser cannot do. */
    get extraDragPreload(): boolean {
        return this.hasAttribute('extra-drag-preload');
    }

    set extraDragPreload(value: boolean) {
        if (value) this.setAttribute('extra-drag-preload', '');
        else this.removeAttribute('extra-drag-preload');
    }

    /** `Adw.TabBar:tabs-revealed` — read-only, and `tabsRevealed`'s answer. */
    get tabsRevealed(): boolean {
        return tabsRevealed({
            autohide: this.autohide,
            nPages: this._view?.nPages ?? 0,
            nPinnedPages: this._view?.nPinnedPages ?? 0,
            // Tab transfer between views is drag-and-drop, i.e. compositor work, and is
            // not modelled — the same `false` `<adw-tab-view>` passes.
            isTransferringPage: false,
        });
    }

    /** `Adw.TabBar:is-overflowing` — read-only, measured off the strip's own scroll window. */
    get isOverflowing(): boolean {
        if (!this._initialized) return false;
        return this.scrollWidth > this.clientWidth;
    }

    /** `Adw.TabBar:extra-drag-preferred-action` — read-only, set by a drag handler. */
    get extraDragPreferredAction(): string | null {
        return this._preferredAction;
    }

    /** `adw_tab_bar_set_view`: rebind, then redraw every chip from the new view's pages. */
    setView(view: AdwTabView | null): void {
        if (this._view === view) return;
        this._unbindView();
        this._view = view;
        this._bindView();
        this._syncChips();
        this._applyRevealed();
        this.dispatchEvent(new CustomEvent('notify::view', { bubbles: true, detail: { view } }));
    }

    connectedCallback() {
        if (this._initialized) {
            // Re-entering a document: `disconnectedCallback` dropped the listeners, so a
            // bar that was merely MOVED has to get them back here or it stops noticing pages.
            this._bindView();
            this._syncChips();
            return;
        }
        this._initialized = true;

        this.classList.add('adw-tab-bar');
        this.setAttribute('role', 'tablist');

        this._startEl = document.createElement('div');
        this._startEl.className = 'adw-tab-bar-start-action';

        this._boxEl = document.createElement('div');
        this._boxEl.className = 'adw-tab-box';

        this._indicatorEl = document.createElement('div');
        this._indicatorEl.className = 'adw-tab-box-overflow';
        this._indicatorEl.hidden = true;
        this._boxEl.appendChild(this._indicatorEl);

        this._endEl = document.createElement('div');
        this._endEl.className = 'adw-tab-bar-end-action';

        // `AdwBin`s on both sides of the box (adw-tab-bar.ui): the action widgets are
        // widget-typed PROPERTIES, so a document spells them as `slot=` children. The three
        // boxes go in through `install`, which is how the router learns which children are
        // the widget's OWN structure — `src/slotted-children.ts` has the incident, and a
        // plain `replaceChildren` here would leave them to be read as authored children.
        bindSlottedChildren(this, [
            { name: 'start-action-widget', into: this._startEl },
            { name: 'end-action-widget', into: this._endEl },
        ]).install(this._startEl, this._boxEl, this._endEl);

        const ref = this.getAttribute('view');
        this.setView(ref === null ? null : this._resolveView(ref));
        this._bindView();
        this._syncChips();
        this._applyRevealed();

        this.addEventListener('keydown', (event) => this._onKeyDown(event as KeyboardEvent));
        // The extra drop target's two platform events, attached ALWAYS and inert until
        // `setupExtraDropTarget` names the types: a drag over a bar that has no target is
        // the page's own business, and rebinding on every setup call would be a second
        // place to forget one.
        this.addEventListener('dragover', this._onDragOver);
        this.addEventListener('drop', this._onDrop);
    }

    disconnectedCallback() {
        this._unbindView();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        switch (name) {
            case 'view':
                this.setView(value === null ? null : this._resolveView(value));
                return;
            case 'autohide':
                this._applyRevealed();
                break;
            case 'expand-tabs':
            case 'inverted':
            case 'extra-drag-preload':
                break;
        }
        // Every one of the four notifies, and only on a real change: `attributeChangedCallback`
        // fires for a write that writes the value it already holds, and C's `set_property`
        // does the same (adw-tab-bar.c:520-546), so the event is dispatched here rather than
        // from the attribute itself.
        if (value !== null || name === 'view') {
            this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: value } }));
        }
    }

    /**
     * `adw_tab_bar_setup_extra_drop_target`: the DOM half of an extra drop target.
     *
     * `types` is the list of MIME types the widget accepts and `actions` the list of drop
     * effects it will let through, which is the pair the C call takes. A drop of any other
     * type is not ours and is left to the page.
     */
    setupExtraDropTarget(types: readonly string[], actions: readonly string[] = ['copy', 'move']): void {
        this._dropTypes = types;
        this._dropActions = actions;
    }

    private _resolveView(ref: string): AdwTabView | null {
        // Resolved NOW, because the view is normally EARLIER in the document (the pages
        // below the chrome), which is the same reason `<adw-tab-button>` resolves its `view`
        // on connect rather than on the first attribute write.
        return (document.getElementById(ref) as AdwTabView | null) ?? null;
    }

    /** `set_view`'s connections, as the view's own events rather than GObject notifications. */
    private _bindView(): void {
        this._unbindView();
        for (const type of VIEW_EVENTS) this._view?.addEventListener(type, this._onViewChange);
    }

    private _unbindView(): void {
        for (const type of VIEW_EVENTS) this._view?.removeEventListener(type, this._onViewChange);
    }

    private _onViewChange = (): void => {
        this._syncChips();
        this._applyRevealed();
    };

    /**
     * The whole strip, rebuilt in place: the page list is the model, and C edits the box
     * rather than rebuilding it, so a chip that survives keeps its node, its hover state and
     * its focus.
     */
    private _syncChips(): void {
        const pages = this._view?.pages ?? [];
        const seen = new Set<string>();
        pages.forEach((page, position) => {
            seen.add(page.id);
            const existing = this._chips.get(page.id);
            if (existing === undefined) {
                const chip = createTabChip({
                    onSelect: () => this._view?.setSelectedPage(page.id),
                    onClose: () => this._view?.closePage(page.id),
                    onHover: (hovering) => {
                        if (hovering) this._hovered.add(page.id);
                        else this._hovered.delete(page.id);
                        this._refreshOne(page.id);
                    },
                });
                chip.el.dataset.pageId = page.id;
                // `can-focus=False` on AdwTab's close button (adw-tab.ui:77). It lives HERE
                // rather than in the shared chip builder because the roving obligation is
                // discharged by the file that registers the arrow keys
                // (scripts/check-adwaita-keyboard-contract.mjs), and a builder has none.
                chip.close.tabIndex = -1;
                this._chips.set(page.id, chip);
                this._boxEl.insertBefore(chip.el, this._boxEl.children[position] ?? null);
            } else if (this._boxEl.children[position] !== existing.el) {
                this._boxEl.insertBefore(existing.el, this._boxEl.children[position] ?? null);
            }
            this._refreshOne(page.id);
        });
        for (const [id, chip] of this._chips) {
            if (seen.has(id)) continue;
            chip.el.remove();
            this._chips.delete(id);
            this._hovered.delete(id);
        }
        this._applyActiveState();
        this._boxEl.classList.toggle('single-tab', pages.length <= 1);
        this._applyOverflow();
    }

    private _refreshOne(id: string): void {
        const page = this._view?.pages.find((candidate) => candidate.id === id);
        const chip = this._chips.get(id);
        if (page === undefined || chip === undefined) return;
        refreshTabChip(chip, page, this._view?.getAttribute('default-icon'));
        refreshTabChipClose(this, chip, page, {
            hovering: this._hovered.has(id),
            selected: this._view?.selectedId === id,
        });
    }

    /**
     * `update_selected_tab`: the selected chip takes the `:selected` state, the roving
     * tabindex follows it, and the strip scrolls it into view the way C does on EVERY
     * selection (`adw-tab-bar.c:934` -> `adw-tab-box.c:1728`).
     */
    private _applyActiveState(): void {
        const selected = this._view?.selectedId ?? null;
        for (const [id, chip] of this._chips) {
            const active = id === selected;
            // Only `active` is the bar's own state; `pinned`, `needs-attention` and
            // `closing` come off the PAGE and `refreshTabChip` owns them.
            chip.el.classList.toggle('active', active);
            chip.el.setAttribute('aria-selected', String(active));
            chip.el.tabIndex = active ? 0 : -1;
            const page = this._view?.pages.find((candidate) => candidate.id === id);
            if (page !== undefined)
                refreshTabChipClose(this, chip, page, { hovering: this._hovered.has(id), selected: active });
        }
        if (selected === null) return;
        const chip = this._chips.get(selected);
        if (chip !== undefined) scrollChipIntoBar(this, chip.el);
    }

    /** `update_tabs_revealed`: the strip is up or it is not. */
    private _applyRevealed(): void {
        this.hidden = !this.tabsRevealed;
    }

    /**
     * `is-overflowing`, and the revealer over the box that reads it
     * (`tabbox > revealer > indicator`, _tab-view.scss:44-55): a two-pixel accent bar under
     * the chips, shown exactly while the strip cannot show them all.
     */
    private _applyOverflow(): void {
        this._indicatorEl.hidden = !this.isOverflowing;
    }

    /**
     * `Adw.TabView`'s shortcut table as the BAR sees it (`adw-tab-bar.c` connects the same
     * moves), plus the ArrowLeft/ArrowRight movement `role=tablist` promises. Ctrl+Tab WRAPS
     * and Ctrl+Page-Up/Down does not — the same `last` flag that separates them in C.
     */
    private _onKeyDown(event: KeyboardEvent): void {
        const view = this._view;
        if (view === null) return;
        let handled = false;

        if (event.ctrlKey && event.key === 'Tab') {
            handled = event.shiftKey ? view.cyclePreviousPage() : view.cycleNextPage();
        } else if (event.ctrlKey && (event.key === 'PageUp' || event.key === 'PageDown')) {
            handled = event.key === 'PageUp' ? view.selectPreviousPage() : view.selectNextPage();
        } else if (event.ctrlKey && (event.key === 'Home' || event.key === 'End')) {
            handled = event.key === 'Home' ? view.selectFirstPage() : view.selectLastPage();
        } else if (event.altKey && /^[0-9]$/.test(event.key)) {
            const digit = Number.parseInt(event.key, 10);
            handled = view.selectNthPage(digit === 0 ? 9 : digit - 1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            handled = event.key === 'ArrowLeft' ? view.selectPreviousPage() : view.selectNextPage();
        } else if (event.key === 'Home' || event.key === 'End') {
            // `role=tablist`'s own two keys, and the halves `Ctrl+Home` / `Ctrl+End` do not
            // cover: C reaches the last tab through the same selection call, so this is the
            // same move with the reordering pair left to the Ctrl branches above.
            handled = event.key === 'Home' ? view.selectFirstPage() : view.selectLastPage();
        }

        if (!handled) return;
        event.preventDefault();
        // `preventScroll` because a bare `focus()` scrolls every scrollable ancestor up to
        // and including the WINDOW, while C only ever moves the strip.
        const id = view.selectedId;
        if (id !== null) this._chips.get(id)?.el.focus({ preventScroll: true });
    }

    // --- the extra drop target, in the DOM's own vocabulary -----------------------

    private _onDragOver = (event: DragEvent): void => {
        if (this._dropTypes.length === 0 || event.dataTransfer === null) return;
        const type = [...this._dropTypes].find((candidate) => event.dataTransfer?.types.includes(candidate));
        if (type === undefined) return;
        event.preventDefault();
        if (event.dataTransfer.dropEffect !== 'none') event.dataTransfer.dropEffect = this._dropEffects(event);
        this._armHoverValue();
    };

    private _onDrop = (event: DragEvent): void => {
        if (this._dropTypes.length === 0 || event.dataTransfer === null) return;
        const type = [...this._dropTypes].find((candidate) => event.dataTransfer?.types.includes(candidate));
        if (type === undefined) return;
        event.preventDefault();
        const action = this._dropEffects(event);
        const proceed = this.dispatchEvent(
            new CustomEvent('extra-drag-drop', {
                bubbles: true,
                cancelable: true,
                detail: { action, data: event.dataTransfer.getData(type) },
            }),
        );
        // The C handler returns whether it took the drop; a cancelled event is the same
        // refusal, and the platform has to be told either way.
        event.dataTransfer.dropEffect = proceed ? action : 'none';
    };

    /** `dropEffect` is the DOM's own name for `Gdk.DragAction`, and it takes the same words. */
    private _dropEffects(_event: DragEvent): DataTransfer['dropEffect'] {
        const action = this._preferredAction;
        if (action !== null && this._dropActions.includes(action)) return action as DataTransfer['dropEffect'];
        return (this._dropActions[0] ?? 'copy') as DataTransfer['dropEffect'];
    }

    /**
     * `extra-drag-value` on hover-start with a `NULL` action (adw-tab-bar.c: the signal is
     * emitted whenever an item starts hovering, whatever `extra-drag-preload` says), and
     * `extra-drag-preferred-action` is whatever the handler answered with.
     */
    private _armHoverValue(): void {
        if (this._dropArmed) return;
        this._dropArmed = true;
        const event = new CustomEvent('extra-drag-value', {
            bubbles: true,
            cancelable: true,
            detail: { action: null },
        });
        this.dispatchEvent(event);
        const answer = (event as CustomEvent).detail.action as string | null;
        if (answer !== this._preferredAction) {
            this._preferredAction = answer;
            this.dispatchEvent(
                new CustomEvent('notify::extra-drag-preferred-action', { bubbles: true, detail: { action: answer } }),
            );
        }
    }
}

customElements.define('adw-tab-bar', AdwTabBar);
