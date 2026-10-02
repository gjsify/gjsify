// <adw-view-switcher-sidebar> — an adaptive sidebar that drives an `<adw-view-stack>`
// (the web counterpart of Adw.ViewSwitcherSidebar, libadwaita 1.9). It is an
// `<adw-sidebar>` filled from the stack's page list, which is the whole difference
// from every other Adw switcher: the pages can be GROUPED into sections, each row
// carries an icon, a title and an unread dot or a badge, and the whole thing collapses
// from a sidebar into a page of boxed lists (`mode`).
//
// It is a COMPOSITE and it says so: this element owns one `<adw-sidebar>` and drives it
// from the stack, rather than reimplementing a sidebar. The rows, the section headers,
// the selection, the filter and the empty state are the `<adw-sidebar>` element's; what
// lives here is the C half — `populate_sidebar`, `activated_cb` and the properties.
//
// THE RULES THAT ARE C AND NOT MARKUP (adw-view-switcher-sidebar.c):
//
//   · `populate_sidebar` (:225-249): a page with `starts-section` opens a section and the
//     one before it is flushed; the FIRST page opens a section whatever it says, because
//     the test is `if (!section || get_starts_section (page))`; and the heading is the
//     opening page's `section-title`. The grouping itself is core's
//     {@link viewSwitcherSidebarSections}, pinned by the conformance vectors.
//   · `add_item` (:184-206): each item's title, icon, use-underline and visibility are BOUND
//     to the page's, so a later change reaches the row without a rebuild here.
//   · `update_badge` (:133-181): no attention and no count means NO indicator at all; a
//     count replaces the dot with a label capped at `999+` (`> 999`, so 999 prints); and
//     `.needs-attention` rides on the bin whether or not there is a number. The bin is the
//     item's `suffix`, which is what `<adw-sidebar>`'s `badge-number` /`needs-attention`
//     attributes spell.
//   · `activated_cb` (:104-112): activating a row selects the stack page at the SAME index
//     and only then emits `activated` — the signal an `Adw.NavigationSplitView` listens to
//     in order to reveal its content pane, so firing it before the selection moved would
//     reveal the previous page.
//   · `selection_changed_cb` (:258-271): the row follows the stack, not the other way round,
//     which is what keeps a programmatic `visible-child-name` write highlighted.
//
// `stack`, `filter`, `placeholder`, `prefix` and `suffix` are all widget- or object-valued
// properties: `stack` is an element id in the attribute and an element in the property,
// `filter` is a property (a function, which no attribute can carry), and the three widget
// ones are `slot="…"` children — the `AdwTabPage:child` rule, because a `.blp`'s
// `placeholder: …` authors a slot.
//
// A11Y: `<adw-sidebar>` carries `role="listbox"`, so the host adds nothing; the sections
// are headings inside it, and the C signal has no row identity of its own to forward.
//
// KNOWN_GAPS: none — `mode` is this widget's only scalar property and it is observed.
//
// Reference: refs/libadwaita/src/adw-view-switcher-sidebar.c (populate_sidebar,
//   add_item, update_badge, activated_cb, selection_changed_cb, the six pspecs)
// Reference: refs/libadwaita/src/adw-sidebar.c (the widget it drives)
// Reference: refs/libadwaita/src/stylesheet/widgets/_sidebars.scss:250-277
//   (`view-switcher-sidebar .indicator`)
// Copyright (c) 2025 GNOME Foundation Inc. (libadwaita). LGPLv2.1-or-later.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the sidebar it
// drives is a real `<adw-sidebar>` and the icon nodes are <gtk-image>.

import { viewSwitcherPagesFromStack, viewSwitcherSidebarSections } from '@gjsify/adwaita-core';
import type { AdwSidebarItemSpec, AdwSidebarSectionSpec, SidebarItemFilter } from '@gjsify/adwaita-core';

import { bindSlottedChildren } from '../slotted-children.js';
import type { AdwSidebar } from './adw-sidebar.js';
import type { AdwViewStack } from './adw-view-stack.js';

export class AdwViewSwitcherSidebar extends HTMLElement {
    private _sidebar!: AdwSidebar;
    private _placeholderEl!: HTMLDivElement;
    private _prefixEl!: HTMLDivElement;
    private _suffixEl!: HTMLDivElement;
    private _stack: AdwViewStack | null = null;
    private _filter: SidebarItemFilter | null = null;
    private _initialized = false;

    static get observedAttributes() {
        return ['stack', 'mode'];
    }

    /** `AdwViewSwitcherSidebar:stack` — the stack the sidebar controls. */
    get stack(): AdwViewStack | null {
        return this._stack;
    }

    set stack(value: AdwViewStack | string | null) {
        this.setStack(value === null ? null : typeof value === 'string' ? this._resolveStack(value) : value);
    }

    /**
     * `adw_view_switcher_sidebar_set_stack`: unbind the old stack's four connections, bind
     * the new one's, and populate. A NULL stack is refused, exactly as C is
     * (`g_return_if_fail (!stack)`, :284) — an overview-less sidebar is not a state the C
     * has, and inventing one here would give a reader a widget libadwaita cannot build.
     */
    setStack(stack: AdwViewStack | null): void {
        if (stack === null) return;
        if (this._stack === stack) return;
        this._unbindStack();
        this._stack = stack;
        this._bindStack();
        this._populate();
        this._syncSelection();
        this.dispatchEvent(new CustomEvent('notify::stack', { bubbles: true, detail: { stack } }));
    }

    /** `AdwViewSwitcherSidebar:mode` — `sidebar` (default) or `page`. */
    get mode(): 'sidebar' | 'page' {
        return this.getAttribute('mode') === 'page' ? 'page' : 'sidebar';
    }

    set mode(value: 'sidebar' | 'page') {
        this.setAttribute('mode', value);
    }

    /**
     * `AdwViewSwitcherSidebar:filter` — a `GtkFilter`, which on this renderer is the
     * sidebar's own predicate. A property and not an attribute: it is a FUNCTION, and
     * markup cannot carry one.
     */
    get filter(): SidebarItemFilter | null {
        return this._filter;
    }

    set filter(value: SidebarItemFilter | null) {
        this._filter = value;
        if (this._initialized) {
            this._sidebar.filter = value;
            this._applyEmptyState();
        }
    }

    /** `AdwViewSwitcherSidebar:placeholder` — shown when no item survives. */
    get placeholder(): HTMLElement | null {
        return this._placeholderEl.firstElementChild as HTMLElement | null;
    }

    set placeholder(value: HTMLElement | null) {
        if (value === null) this._placeholderEl.replaceChildren();
        else this._placeholderEl.replaceChildren(value);
        this._applyEmptyState();
    }

    /**
     * `AdwViewSwitcherSidebar:prefix` (1.10) — shown above the items.
     *
     * NOT `prefix`. `HTMLElement.prefix` is the RDFa attribute and a STRING, and a
     * property of a different type cannot shadow it (TS2416). The GIR name is kept in the
     * SLOT (`slot="prefix"`, what a `.blp`'s `prefix: …` authors) and here in the header.
     */
    get prefixWidget(): HTMLElement | null {
        return this._prefixEl.firstElementChild as HTMLElement | null;
    }

    set prefixWidget(value: HTMLElement | null) {
        if (value === null) this._prefixEl.replaceChildren();
        else this._prefixEl.replaceChildren(value);
    }

    /** `AdwViewSwitcherSidebar:suffix` (1.10) — shown below the items. `suffixWidget`, as `prefixWidget`. */
    get suffixWidget(): HTMLElement | null {
        return this._suffixEl.firstElementChild as HTMLElement | null;
    }

    set suffixWidget(value: HTMLElement | null) {
        if (value === null) this._suffixEl.replaceChildren();
        else this._suffixEl.replaceChildren(value);
    }

    connectedCallback() {
        if (this._initialized) {
            this._bindStack();
            this._populate();
            return;
        }
        this._initialized = true;

        this._prefixEl = document.createElement('div');
        this._prefixEl.className = 'view-switcher-sidebar-prefix';
        this._suffixEl = document.createElement('div');
        this._suffixEl.className = 'view-switcher-sidebar-suffix';
        this._placeholderEl = document.createElement('div');
        this._placeholderEl.className = 'view-switcher-sidebar-placeholder';
        this._placeholderEl.hidden = true;

        // The widget C composes (`adw_view_switcher_sidebar_init`, :555-560): an
        // `AdwSidebar`, parented to the widget, with `activated` re-emitted.
        this._sidebar = document.createElement('adw-sidebar') as AdwSidebar;
        this._sidebar.addEventListener('activated', this._onSidebarActivated);

        const box = document.createElement('div');
        box.className = 'view-switcher-sidebar-box';
        box.append(this._sidebar, this._placeholderEl);

        // `placeholder`, `prefix` and `suffix` are widget PROPERTIES, so a `.blp`'s
        // `placeholder: …` authors `slot="placeholder"` — the rule `adw-tab-page` states.
        bindSlottedChildren(this, [
            { name: 'placeholder', into: this._placeholderEl },
            { name: 'prefix', into: this._prefixEl },
            { name: 'suffix', into: this._suffixEl },
        ]);

        this.replaceChildren(this._prefixEl, box, this._suffixEl);
        this._applyMode();

        const declared = this.getAttribute('stack');
        this.setStack(declared === null ? this._findStack() : this._resolveStack(declared));
    }

    disconnectedCallback() {
        this._unbindStack();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        if (name === 'stack') this.setStack(value === null ? this._findStack() : this._resolveStack(value));
        else if (name === 'mode') this._applyMode();
    }

    private _resolveStack(ref: string): AdwViewStack | null {
        return (document.getElementById(ref) as AdwViewStack | null) ?? this._findStack();
    }

    /** The stack this sidebar is next to, when the author named no id. */
    private _findStack(): AdwViewStack | null {
        const parent = this.parentElement;
        return (parent?.querySelector('adw-view-stack') as AdwViewStack | null) ?? null;
    }

    /** `set_stack`'s four connections (:270-282), read off the stack's own events. */
    private _bindStack(): void {
        this._unbindStack();
        for (const type of STACK_EVENTS) this._stack?.addEventListener(type, this._onStackChange);
    }

    private _unbindStack(): void {
        for (const type of STACK_EVENTS) this._stack?.removeEventListener(type, this._onStackChange);
    }

    private _onStackChange = (): void => {
        this._populate();
        this._syncSelection();
    };

    /**
     * `activated_cb` (:104-112) — the row's index is the stack's index, so the two lists
     * are kept one for one. The selection moves FIRST: `activated` is the signal a split
     * view reveals its content pane on, and a handler that read the stack in that callback
     * would otherwise see the page the user was leaving.
     */
    private _onSidebarActivated = (event: Event): void => {
        const index = (event as CustomEvent).detail.index as number;
        const stack = this._stack;
        if (stack === null) return;
        stack.selectNthPage(index);
        this.dispatchEvent(new CustomEvent('activated', { bubbles: true, detail: { index } }));
    };

    /**
     * `populate_sidebar` (:225-249) — one `AdwSidebarSection` per group of pages, each
     * holding one `AdwSidebarItem` per page. The grouping is core's, so the browser and
     * any second renderer derive the sections from the same table.
     */
    private _populate(): void {
        const stack = this._stack;
        if (stack === null) {
            this._sidebar.sections = [];
            this._applyEmptyState();
            return;
        }
        const pages = viewSwitcherPagesFromStack(stack.pages);
        this._sidebar.sections = viewSwitcherSidebarSections(pages).map((section) => this._toSectionSpec(section));
        this._applyEmptyState();
    }

    private _toSectionSpec(section: ReturnType<typeof viewSwitcherSidebarSections>[number]): AdwSidebarSectionSpec {
        const items: AdwSidebarItemSpec[] = section.pages.map((page) => ({
            // `g_object_bind_property (page, "title", item, "title", …)`: the row shows the
            // page's title, never a resolved fallback — `createViewSwitcherPage` has already
            // resolved it against the page NAME, which is what C binds too.
            title: page.title ?? '',
            iconName: page.iconName ?? '',
            visible: page.visible,
            badgeNumber: page.badgeNumber,
            needsAttention: page.needsAttention,
        }));
        // `section-title` bound to the SECTION's title; an empty one is the separator
        // header, which is `<adw-sidebar-section>`'s own rule (`update_header_page_cb`).
        return { title: section.title, items };
    }

    /**
     * `selection_changed_cb` (:258-271) — the row follows the stack's visible page. Read as
     * the INDEX, because the sidebar's flat index space is the unfiltered one (ADR 0004),
     * so page position and row position are the same number.
     */
    private _syncSelection(): void {
        const stack = this._stack;
        if (stack === null) return;
        const index = stack.visibleChildIndex;
        if (index < 0) return;
        if (this._sidebar.selected !== index) this._sidebar.selected = index;
    }

    private _applyMode(): void {
        const page = this.mode === 'page';
        this.classList.toggle('page', page);
        this._sidebar.mode = this.mode;
    }

    /**
     * `placeholder` (:449-460) — shown when the sidebar has no items, or when the filter
     * took them all. The `<adw-sidebar>` knows the filtered list (`visibleItems` is empty),
     * which is the C condition in `AdwSidebar`'s own words.
     */
    private _applyEmptyState(): void {
        const rows = this._sidebar.querySelectorAll('.adw-sidebar-item').length;
        this._placeholderEl.hidden = rows > 0;
        this.classList.toggle('empty', rows === 0);
    }
}

/** The stack signals `set_stack` connects to: the page list, its sections and the selection. */
const STACK_EVENTS = ['items-changed', 'notify::visible-child'] as const;

customElements.define('adw-view-switcher-sidebar', AdwViewSwitcherSidebar);
