// <gtk-notebook> — the older page container, which brings its own tab bar. A stack
// plus a strip of tabs, in one widget: `tab-pos` says which edge the strip is on,
// `show-tabs` takes it away entirely, and `page` is the current page by INDEX
// rather than by name.
//
// IT IS A STACK IN C. `GtkNotebook` holds a `stack_widget` (a GtkStack) for the pages
// and a `header_widget` with the tabs beside it, and `real_switch_page` drives the
// stack directly (`gtk_stack_set_visible_child`, gtknotebook.c:5476). That is why
// `page` is an index: the stack speaks names, the notebook speaks positions.
//
// THE CHILD IS THE PAGE. `GtkNotebookPage` is a GObject, not a widget
// (`G_DEFINE_TYPE (…, G_TYPE_OBJECT)`, gtknotebook.c:423), so it has no element of its
// own: its properties are attributes on the child, and the descriptor
// {@link NotebookPageInfo} is what `getNthPage()` describes. Of its eleven properties
// (gtknotebook.c:600-699) this element carries the five that are scalars and draw
// something — `tab-label` (the tab's text), `menu-label`, `tab-fill`, `tab-expand` and
// `reorderable` — and the `hidden` attribute is `GtkWidget:visible`.
//
// WHICH PAGE IS CURRENT, transcribed from `set_current_page`
// (gtknotebook.c:6046-6060) and `real_switch_page` (gtknotebook.c:5436-5498):
//   · a NEGATIVE index means the LAST page, not "none" (:6054) — so `page="-1"` on a
//     notebook with three pages selects the third;
//   · `page` OUT OF RANGE does nothing at all, because `g_list_nth` returns NULL and
//     the switch is guarded (:6056-6058);
//   · a page whose child is NOT visible is refused the same way
//     (`!gtk_widget_get_visible (child)`, :5444), which is how a hidden page is kept
//     out of the rotation;
//   · switching to the CURRENT page is not a change (:5444), so no notify;
//   · the old tab loses `:checked` and the new one gains it, and the tab's
//     `GTK_ACCESSIBLE_STATE_SELECTED` follows (:5458-5462, :5472-5474) — which is
//     `aria-selected` here.
// `page` then notifies (`:5497`), as does every property the setters move.
//
// TAB POSITION. `tab-pos` is one of the four `GtkPositionType` nicks and defaults to
// `top` (gtknotebook.c:1113-1117). `get_effective_tab_pos` swaps left and right under
// RTL (:1741-1757), which is why the element reflects the SWAPPED position in
// `data-tab-pos` rather than the raw property.
//
// `show-border` is a CSS CLASS in C and not a branch: `gtk_notebook_set_show_border`
// adds `.frame` and clearing it removes that (gtknotebook.c:6134-6146), and libadwaita
// styles the class as a plain one-pixel border. Its own docs say the bevel only shows
// when the tabs are not (:6125-6131), because the header's own border covers it.
//
// A11Y: the strip is a `tablist` and each tab a `tab`, which is what the tab widget's
// own role is here; the pages carry `aria-hidden` as they do in a stack.
//
// Events: `notify::<prop>` (CustomEvent, bubbles, detail `{ <prop>: value }`);
// `switch-page` (detail `{ page: index, child }`) is GtkNotebook's own signal
// (gtknotebook.c:1180-1197), emitted BEFORE the switch with the page being switched TO
// — `gtk_notebook_switch_page` emits and the class handler `real_switch_page` performs
// (:5518-5523) — so a handler that vetoes by not drawing is the documented use;
// `page-added` (:1380-1391, emitted at :4129) and `page-removed` (:1358-1369) carry
// `{ position, nPages }`, the two page-list signals the C raises around an insert and a
// remove.
//
// NOT PORTED, and why:
//   · `detachable` (gtknotebook.c:694-702) and the DnD behind it move a page to
//     ANOTHER notebook; the browser's drag is a different protocol, and a notebook
//     with one stack of children has nothing to detach to.
//   · `enable-popup` (:1150-1159) builds a GtkPopoverMenu of the pages when it is set
//     (:6420-6462) and pops it up on right-click (:2684-2692). The flag is read and
//     reflected, and `contextmenu` opens `<div role="listbox">` of the same pages — but
//     it is a DOM listbox, not a GtkPopover.
//   · `scrollable` (:1140-1149) adds GtkScrollbar arrows when the tabs do not fit. The
//     tabs here overflow with `overflow-x: auto`, which scrolls without the two arrow
//     buttons GTK scrolls with.
//   · `group-name` (:1160-1169) groups notebooks for drag and drop, which is the same
//     absent DnD as `detachable`.
//
// Reference: refs/gtk/gtk/gtknotebook.c
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** `GtkPositionType`, spelled as the GIR's enum nicks. `top` is the property default. */
export type NotebookTabPos = 'top' | 'bottom' | 'left' | 'right';

const TAB_POSITIONS: readonly string[] = ['top', 'bottom', 'left', 'right'];

/** The page attributes this element reads off a child (gtknotebook.c:600-695). */
const PAGE_ATTRIBUTES = ['tab-label', 'menu-label', 'tab-fill', 'tab-expand', 'reorderable', 'detachable'];

/** The browser's page descriptor — the stand-in for the `GtkNotebookPage` GObject. */
export interface NotebookPageInfo {
    /** `GtkNotebookPage:tab-label` — the tab's text. `null` when absent. */
    tabLabel: string | null;
    /** `GtkNotebookPage:menu-label` — the text of the menu entry. `null` when absent. */
    menuLabel: string | null;
    /** `GtkNotebookPage:tab-fill` — the tab fills its allocation. Defaults to TRUE. */
    tabFill: boolean;
    /** `GtkNotebookPage:tab-expand` — the tab expands. Defaults to false. */
    tabExpand: boolean;
    /** `GtkNotebookPage:reorderable` — the user may drag the tab. */
    reorderable: boolean;
    /** `GtkNotebookPage:detachable` — read and reflected; the drag itself is not ported. */
    detachable: boolean;
    /** `GtkWidget:visible` on the child, as the DOM's `hidden`. */
    visible: boolean;
    /** `GtkNotebookPage:child`. */
    child: HTMLElement;
}

export class GtkNotebook extends HTMLElement {
    private _current: HTMLElement | null = null;
    private _initialized = false;
    private _initializedChildren = new WeakSet<HTMLElement>();
    private _header!: HTMLDivElement;
    private _tabs!: HTMLDivElement;
    private _observer: MutationObserver | null = null;
    private _tabNodes: HTMLButtonElement[] = [];
    private _menu: HTMLElement | null = null;

    static get observedAttributes() {
        return ['page', 'tab-pos', 'show-tabs', 'show-border', 'scrollable', 'enable-popup', 'group-name'];
    }

    /**
     * `Gtk.Notebook:page` — the index of the current page, `-1` when there is none.
     *
     * LIVE rather than the value last written: `get_property` returns
     * `gtk_notebook_get_current_page (notebook)` (gtknotebook.c:1977-1979), so the
     * attribute is an INPUT and this is the answer — a switch reached by clicking a tab
     * is visible through the property without anything having written it. A negative
     * WRITE means the LAST page (gtknotebook.c:6054).
     */
    get page(): number {
        return this._current ? this._pages().indexOf(this._current) : -1;
    }

    set page(v: number) {
        this.setCurrentPage(v);
    }

    /** `Gtk.Notebook:tab-pos` — which edge the tabs are on. Defaults to `top`. */
    get tabPos(): NotebookTabPos {
        const raw = this.getAttribute('tab-pos');
        return raw !== null && TAB_POSITIONS.includes(raw) ? (raw as NotebookTabPos) : 'top';
    }

    set tabPos(v: NotebookTabPos) {
        this._write('tab-pos', v);
    }

    /** `Gtk.Notebook:show-tabs` — the tab strip itself. Defaults to true. */
    get showTabs(): boolean {
        return this._flag('show-tabs', true);
    }

    set showTabs(v: boolean) {
        this._write('show-tabs', v ? '' : 'false');
    }

    /** `Gtk.Notebook:show-border` — the border around the tab strip. Defaults to true. */
    get showBorder(): boolean {
        return this._flag('show-border', true);
    }

    set showBorder(v: boolean) {
        this._write('show-border', v ? '' : 'false');
    }

    /** `Gtk.Notebook:scrollable` — GTK's scroll arrows. Defaults to false. */
    get scrollable(): boolean {
        return this._flag('scrollable', false);
    }

    set scrollable(v: boolean) {
        this._write('scrollable', v ? '' : 'false');
    }

    /** `Gtk.Notebook:enable-popup` — the right-click page menu. Defaults to false. */
    get enablePopup(): boolean {
        return this._flag('enable-popup', false);
    }

    set enablePopup(v: boolean) {
        this._write('enable-popup', v ? '' : 'false');
    }

    /** `Gtk.Notebook:group-name` — the drag-and-drop group. Defaults to `null`. */
    get groupName(): string | null {
        return this.getAttribute('group-name');
    }

    set groupName(v: string | null) {
        this._write('group-name', v);
    }

    /** The current page's child, or `null` — `gtk_notebook_get_nth_page` at `page`. */
    get currentPage(): HTMLElement | null {
        return this._current;
    }

    /** `gtk_notebook_get_n_pages` as the browser spells it. */
    get nPages(): number {
        return this._pages().length;
    }

    /** `gtk_notebook_get_nth_page` (gtknotebook.c:5956-5977): a child, or null. */
    getNthPage(n: number): HTMLElement | null {
        const pages = this._pages();
        const index = n < 0 ? pages.length - 1 : n;
        return pages[index] ?? null;
    }

    /** `gtk_notebook_page_num` (gtknotebook.c:6006-6020): an index, `-1` when absent. */
    pageNum(child: HTMLElement): number {
        return this._pages().indexOf(child);
    }

    /** The descriptor of one child, `null` when it is not a page of this notebook. */
    getPage(child: HTMLElement): NotebookPageInfo | null {
        return this._pages().includes(child) ? this._page(child) : null;
    }

    /** `By CHILD rather than by index — `gtk_notebook_page_num` for the index and
     * `gtk_notebook_set_current_page` for the switch (gtknotebook.c:6006, :6046). There is
     * no `gtk_notebook_set_page` to transcribe: GTK 4 dropped it. */
    setPage(child: HTMLElement): boolean {
        const index = this._pages().indexOf(child);
        if (index === -1) return false;
        return this.setCurrentPage(index);
    }

    /**
     * `gtk_notebook_next_page` (gtknotebook.c:6070-6088) — which searches with
     * `gtk_notebook_search_page (…, STEP_NEXT, TRUE)`, so a HIDDEN page is stepped over
     * rather than ending the walk, and the end of the notebook is simply nothing
     * (:6079-6080).
     */
    nextPage(): boolean {
        return this._searchPage(1);
    }

    /** `gtk_notebook_prev_page` (gtknotebook.c:6096-6113), the same search backwards. */
    prevPage(): boolean {
        return this._searchPage(-1);
    }

    /**
     * `gtk_notebook_set_current_page` (gtknotebook.c:6046-6060) into
     * `real_switch_page` (gtknotebook.c:5436-5498): a negative index is the last page,
     * an out-of-range one does nothing, and a page whose child is hidden is refused.
     */
    setCurrentPage(index: number): boolean {
        const pages = this._pages();
        const target = index < 0 ? pages.length - 1 : index;
        const child = pages[target];
        if (!child) return false;
        return this._switchTo(child);
    }

    /** `gtk_notebook_append_page` (gtknotebook.c:5807-5870) — the child is the page. */
    appendPage(child: HTMLElement, tabLabel?: string | null): number {
        return this.insertPage(child, -1, tabLabel);
    }

    /**
     * `gtk_notebook_insert_page` (gtknotebook.c:5807-5870). A negative `position` means
     * the end, which is what `append_page` passes.
     */
    insertPage(child: HTMLElement, position: number, tabLabel?: string | null): number {
        const index = position < 0 ? this._pages().length : position;
        if (tabLabel !== undefined && tabLabel !== null) child.setAttribute('tab-label', tabLabel);
        this._initChild(child);
        this.insertBefore(child, this._pages()[index] ?? null);
        this.dispatchEvent(
            new CustomEvent('page-added', { bubbles: true, detail: { position: index, nPages: this._pages().length } }),
        );
        // `if (!gtk_notebook_has_current_page (notebook)) gtk_notebook_switch_page (…)`
        // (gtknotebook.c:4131-4134), so an inserted page only becomes the current one
        // while the notebook has none.
        if (!this._current) this._switchTo(child);
        this._render();
        return index;
    }

    /** `gtk_notebook_remove_page` (gtknotebook.c:5899-5932). */
    removePage(child: HTMLElement): boolean {
        const index = this._pages().indexOf(child);
        if (index === -1) return false;
        if (child === this._current) this._current = null;
        child.remove();
        this.dispatchEvent(
            new CustomEvent('page-removed', {
                bubbles: true,
                detail: { position: index, nPages: this._pages().length },
            }),
        );
        // The current page went away with it, so a neighbour takes over — C searches
        // `STEP_NEXT` and falls back to `STEP_PREV` at the end, both with `find_visible`
        // TRUE, so it is the page that FOLLOWED rather than the first one, and a hidden
        // page is stepped over rather than refused (gtknotebook.c:4281-4290).
        if (!this._current) this._takeOver(index);
        this._render();
        return true;
    }

    /** Rebuild the tabs by hand, for a consumer that mutated a page in place. */
    refresh(): void {
        this._render();
    }

    connectedCallback() {
        if (this._initialized) {
            this._observer = new MutationObserver((records) => this._onMutations(records));
        } else {
            this._initialized = true;
            this._header = document.createElement('div');
            // libadwaita's node tree is `notebook > header > tabs > tab`
            // (refs/libadwaita/src/stylesheet/widgets/_notebook.scss:4-10), so the
            // element builds the same two levels rather than a flat row.
            this._header.className = 'adw-notebook-header';
            this._tabs = document.createElement('div');
            this._tabs.className = 'adw-notebook-tabs';
            this._tabs.setAttribute('role', 'tablist');
            this._header.appendChild(this._tabs);
            for (const child of this._pages()) this._initChild(child);
        }
        if (this._header.parentNode !== this) {
            // The header comes FIRST in the DOM whatever `tab-pos` says — C lays the
            // header out on the edge the tabs are on, which is a rendering decision, not
            // a document-order one (gtknotebook.c:1533-1544: the stack and the tabs are parented to
            // the notebook, and the edge is read at layout time by `get_effective_tab_pos`).
            this.prepend(this._header);
        }
        this._observer?.observe(this, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [...PAGE_ATTRIBUTES, 'hidden'],
        });
        if (!this._current) this._switchTo(this._firstVisible());
        this.addEventListener('contextmenu', this._onContextMenu);
        this._render();
    }

    disconnectedCallback() {
        this._observer?.disconnect();
        this._observer = null;
        this.removeEventListener('contextmenu', this._onContextMenu);
        this._closeMenu();
        // `_initialized` STAYS true: a widget that is removed from the tree keeps the
        // children it had, and a header rebuilt on the way back in would be a second one
        // left behind — which the page list, that filters out the header by identity,
        // would then read as a page.
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'page') {
            // The ATTRIBUTE is the input here — `set_property` is
            // `gtk_notebook_set_current_page (notebook, g_value_get_int (value))`
            // (gtknotebook.c:1940-1942) — and `page` reads the live index, so parsing the
            // raw string is what keeps the two apart.
            const raw = this.getAttribute(name);
            if (raw !== null) this.setCurrentPage(Number.parseInt(raw, 10));
            return;
        }
        this._render();
        this._notify(name);
    }

    /**
     * `switch-page` is emitted BEFORE the switch (gtknotebook.c:5518-5523) and
     * `real_switch_page` runs after it, so a listener sees the page being switched TO
     * while `page` still reads the old one — the order C's own handlers rely on.
     */
    private _switchTo(child: HTMLElement): boolean {
        const pages = this._pages();
        const index = pages.indexOf(child);
        if (index === -1) return false;
        // `!gtk_widget_get_visible (child)` (gtknotebook.c:5444) — the page flag AND
        // the widget's own visibility, which is the DOM's `hidden` here.
        if (!this._page(child).visible) return false;
        if (this._current === child) return false;
        const event = new CustomEvent('switch-page', {
            bubbles: true,
            cancelable: true,
            detail: { page: index, child },
        });
        this.dispatchEvent(event);
        // A handler that stops the emission keeps the switch from happening: `switch-page`
        // is `G_SIGNAL_RUN_LAST`, so `real_switch_page` IS the default handler and
        // `g_signal_stop_emission` from a listener is what holds it back. `preventDefault`
        // is that call's spelling here — cancelling the event, not the propagation, so
        // every other listener still runs.
        if (event.defaultPrevented) return false;
        this._current = child;
        this._render();
        // `g_object_notify_by_pspec (…, PROP_PAGE)` (gtknotebook.c:5497).
        this._notify('page');
        return true;
    }

    private _notify(name: string): void {
        this.dispatchEvent(
            new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: this._property(name) } }),
        );
    }

    private _property(name: string): string | number | boolean | null {
        switch (name) {
            case 'page':
                return this.page;
            case 'tab-pos':
                return this.tabPos;
            case 'show-tabs':
                return this.showTabs;
            case 'show-border':
                return this.showBorder;
            case 'scrollable':
                return this.scrollable;
            case 'enable-popup':
                return this.enablePopup;
            default:
                return this.groupName;
        }
    }

    private _write(name: string, value: string | null): void {
        if (value === null) this.removeAttribute(name);
        else if (this.getAttribute(name) !== value) this.setAttribute(name, value);
    }

    /** A boolean property with a non-false default: absent means the default. */
    private _flag(name: string, fallback: boolean): boolean {
        const raw = this.getAttribute(name);
        if (raw === null) return fallback;
        return raw !== 'false';
    }

    /** The children, in page order — the header is the widget's own, never a page. */
    private _pages(): HTMLElement[] {
        return Array.from(this.children).filter((child) => child !== this._header) as HTMLElement[];
    }

    private _page(child: HTMLElement): NotebookPageInfo {
        return {
            tabLabel: child.getAttribute('tab-label'),
            menuLabel: child.getAttribute('menu-label'),
            // `tab-fill` defaults TRUE and `tab-expand` FALSE (gtknotebook.c:663-681).
            tabFill: child.getAttribute('tab-fill') !== 'false',
            tabExpand: child.hasAttribute('tab-expand'),
            reorderable: child.hasAttribute('reorderable'),
            detachable: child.hasAttribute('detachable'),
            visible: !child.hasAttribute('hidden'),
            child,
        };
    }

    private _initChild(child: HTMLElement): void {
        if (this._initializedChildren.has(child)) return;
        this._initializedChildren.add(child);
        child.classList.add('adw-notebook-page');
    }

    private _firstVisible(): HTMLElement | null {
        return this._pages().find((child) => this._page(child).visible) ?? null;
    }

    /**
     * `gtk_notebook_search_page` with `find_visible` TRUE (gtknotebook.c:4412-4470): walk
     * from the current page in `direction`, skipping every page whose child is hidden, and
     * switch to the first one that takes. Off either end there is nothing, which is the
     * FALSE both `next_page` and `prev_page` return.
     */
    private _searchPage(direction: 1 | -1): boolean {
        const pages = this._pages();
        const start = this._current ? pages.indexOf(this._current) : -1;
        for (let i = start + direction; i >= 0 && i < pages.length; i += direction) {
            if (this._switchTo(pages[i])) return true;
        }
        return false;
    }

    /**
     * The neighbour a REMOVAL hands the notebook to: the pages that followed the removed
     * one, then the pages that came before it — `search_page (…, STEP_NEXT, TRUE)` and
     * then `search_page (…, STEP_PREV, TRUE)` (gtknotebook.c:4281-4282), which is a wrap
     * rather than a one-way walk. `position` is where the removed page WAS.
     */
    private _takeOver(position: number): boolean {
        const pages = this._pages();
        for (const page of [...pages.slice(position), ...pages.slice(0, position)]) {
            if (this._switchTo(page)) return true;
        }
        return false;
    }

    private _onMutations(records: MutationRecord[]): void {
        // THE PAGE AREA ONLY, and the filter is load-bearing rather than tidiness. This
        // observer watches the subtree, and the render pass writes INTO it: `hidden` and
        // `textContent` on the tabs, `replaceChildren` on the strip. `setAttribute` queues a
        // record even when the value is unchanged, and assigning `textContent` always
        // replaces the text node, so a record from the strip went straight back into
        // `_render()` and never stopped — a frozen page rather than a failing test, which is
        // how this presented. `subtree: true` is what makes those records reachable at all;
        // this is what keeps them out. What IS ours is the notebook's own child list — a page
        // in or out — and a page's attributes, which is exactly the two targets below.
        const pages = new Set(this._pages());
        const pageRecords = records.filter(
            (record) => record.target === this || pages.has(record.target as HTMLElement),
        );
        // …and a batch with nothing of ours in it gets NO render pass. That early return is
        // the half that actually stops the feedback: filtering the records only keeps the
        // bookkeeping out, while a `_render()` at the end of EVERY batch rewrote the strip
        // and queued the next one, so the loop kept running on batches already empty.
        if (pageRecords.length === 0) return;
        let added = 0;
        let removed = 0;
        const updated: Element[] = [];
        for (const record of pageRecords) {
            if (record.type === 'childList') {
                for (const node of Array.from(record.removedNodes)) {
                    if (node === this._current) this._current = null;
                    removed += 1;
                }
                for (const node of Array.from(record.addedNodes)) {
                    if (!(node instanceof HTMLElement) || node === this._header) continue;
                    this._initChild(node);
                    added += 1;
                }
                continue;
            }
            const name = record.attributeName;
            if (name === 'hidden') {
                if (!this._current || !this._page(this._current).visible) this._switchTo(this._firstVisible());
                continue;
            }
            if (name && PAGE_ATTRIBUTES.includes(name)) updated.push(record.target as HTMLElement);
        }
        if (added > 0 || removed > 0) {
            this.dispatchEvent(new CustomEvent('items-changed', { bubbles: true, detail: { added, removed } }));
        }
        for (const child of updated) {
            this.dispatchEvent(new CustomEvent('page-updated', { bubbles: true, detail: { child } }));
        }
        this._render();
    }

    /** Which edge the tabs are on, with RTL's left/right swap (gtknotebook.c:1741-1757). */
    private _effectiveTabPos(): NotebookTabPos {
        const pos = this.tabPos;
        if (this.getAttribute('dir') !== 'rtl') return pos;
        if (pos === 'left') return 'right';
        if (pos === 'right') return 'left';
        return pos;
    }

    private _render(): void {
        if (!this._initialized) return;
        const pages = this._pages();
        if (pages.length !== this._tabNodes.length) {
            this._tabs.replaceChildren();
            this._tabNodes = pages.map(() => this._buildTab());
            this._tabs.append(...this._tabNodes);
        }
        const currentIndex = this._current ? pages.indexOf(this._current) : -1;
        // `gtk_notebook_update_labels` numbers the tabs ONE-BASED and only over the
        // VISIBLE ones — `gtk_notebook_search_page (…, STEP_NEXT, FALSE)` steps over a
        // hidden page — and a page with no `tab-label` gets that number AS ITS TEXT rather
        // than no tab at all (gtknotebook.c:4353-4373).
        let pageNumber = 0;
        pages.forEach((page, index) => {
            const tab = this._tabNodes[index];
            if (!tab) return;
            const info = this._page(page);
            const selected = index === currentIndex;
            if (info.visible) pageNumber += 1;
            // The two writes below are GUARDED, and that is not an optimisation: each is a
            // mutation the observer would be handed (`textContent` always replaces the text
            // node, `setAttribute` queues a record even for an unchanged value), so an
            // unguarded write makes a render pass able to trigger the next one. C's own
            // label pass only touches a label whose text differs
            // (`page->default_tab` and `gtk_label_set_text`, gtknotebook.c:4380-4391).
            const text = info.tabLabel ?? `Page ${pageNumber}`;
            if (tab.textContent !== text) tab.textContent = text;
            tab.classList.toggle('active', selected);
            tab.classList.toggle('expand', info.tabExpand);
            tab.classList.toggle('fill', info.tabFill);
            tab.classList.toggle('reorderable', info.reorderable);
            // `gtk_widget_set_visible (page->tab_label, show_tabs &&
            // gtk_widget_get_visible (page->child))` (gtknotebook.c:4117-4118): a hidden
            // page takes its tab with it, which is the other half of why
            // `real_switch_page` refuses a hidden page at all.
            const hidden = !info.visible;
            if (tab.hidden !== hidden) tab.hidden = hidden;
            tab.setAttribute('aria-selected', String(selected));
            page.classList.toggle('visible-page', selected);
            if (selected) page.removeAttribute('aria-hidden');
            else page.setAttribute('aria-hidden', 'true');
        });
        // `gtk_widget_set_visible (header_widget, show_tabs)` (gtknotebook.c:5467).
        const headerHidden = !this.showTabs;
        if (this._header.hidden !== headerHidden) this._header.hidden = headerHidden;
        const tabPos = this._effectiveTabPos();
        if (this.getAttribute('data-tab-pos') !== tabPos) this.setAttribute('data-tab-pos', tabPos);
        // `show-border` IS the `.frame` class in C — `gtk_notebook_set_show_border` adds it
        // and clearing the property removes it (gtknotebook.c:6134-6146) — and this
        // stylesheet already carries libadwaita's rule for the class (`_misc.scss:4-7`,
        // ported whole in `_style_classes.scss`), so this is the same mechanism rather than
        // a private spelling of it.
        this.classList.toggle('frame', this.showBorder);
    }

    private _buildTab(): HTMLButtonElement {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'adw-notebook-tab';
        tab.setAttribute('role', 'tab');
        tab.addEventListener('click', () => {
            const index = this._tabNodes.findIndex((candidate) => candidate === tab);
            if (index === -1) return;
            const page = this._pages()[index];
            if (page) this._switchTo(page);
        });
        return tab;
    }

    /**
     * `enable-popup`'s right-click menu (`gtk_notebook_popup_enable`,
     * gtknotebook.c:6420-6462 builds it and `gtk_notebook_popup_menu` at :2684-2692 pops
     * it up) as a DOM listbox of
     * the same pages. C builds it with `gtk_menu_model` and a GtkPopover; the page set
     * and the selection are the same, the widget is not.
     */
    private readonly _onContextMenu = (event: Event): void => {
        if (!this.enablePopup) return;
        event.preventDefault();
        this._closeMenu();
        const menu = document.createElement('div');
        menu.className = 'adw-notebook-menu';
        menu.setAttribute('role', 'listbox');
        let pageNumber = 0;
        for (const page of this._pages()) {
            const info = this._page(page);
            if (info.visible) pageNumber += 1;
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'adw-notebook-menu-item';
            item.setAttribute('role', 'option');
            // `gtk_notebook_menu_item_create` builds the label from `menu_label`, falls
            // back to the tab label when the tab label IS a GtkLabel, and hides the item
            // for a page whose child is hidden (gtknotebook.c:5624-5649).
            item.textContent = info.menuLabel ?? info.tabLabel ?? `Page ${pageNumber}`;
            item.hidden = !info.visible;
            item.setAttribute('aria-selected', String(page === this._current));
            item.addEventListener('click', () => {
                this._switchTo(page);
                this._closeMenu();
            });
            menu.appendChild(item);
        }
        this.appendChild(menu);
        this._menu = menu;
    };

    private _closeMenu(): void {
        this._menu?.remove();
        this._menu = null;
    }
}

customElements.define('gtk-notebook', GtkNotebook);
