// <gtk-stack-sidebar> — a vertical list of a <gtk-stack>'s pages, the sidebar
// counterpart of <gtk-stack-switcher>. It is the older of the two: the switcher
// is a row of buttons, this is a listbox of rows, and both bind to a stack's
// `pages` selection model the same way.
//
// IT OWNS NO PAGES. C binds the stack through `set_stack`, reads its `pages`
// model and builds one `GtkListBoxRow` per page (gtkstacksidebar.c:422-448,
// :252-275). `stack` here is an id reference, like `<label for>`, because a
// browser attribute cannot carry a widget — the same spelling
// `<adw-view-switcher-bar>` uses.
//
// WHAT A ROW SHOWS, transcribed from `update_row` (gtkstacksidebar.c:175-197):
// a LABEL and nothing else — `update_row` reads `title`, `needs-attention` and
// `visible` but never `icon-name`, so a page with an icon and no title gets no
// row text at all. The row is visible when the page is visible AND the title is
// non-NULL (`:186`), which is the one place this and the switcher differ: the
// switcher also accepts an icon there (gtkstackswitcher.c:200), the sidebar does
// not. `needs-attention` puts the `.needs-attention` class on the ROW (`:188-191`).
//
// The list carries C's own style classes: `.navigation-sidebar` on the LIST and
// `.sidebar` on the widget (gtkstacksidebar.c:155, :163), and the list's
// accessible label is the translated "Sidebar" (`:157-159`).
//
// THE TWO-WAY BINDING. A selected row selects its page
// (`gtk_stack_sidebar_row_selected`, gtkstacksidebar.c:130-143) and the stack's
// side is `selection_changed_cb`, which selects or unselects the rows in the
// changed range (`:317-338`). A selection change does NOT rebuild — an
// `items-changed` does (`:307-311`) — so the rows survive a page change and keep
// keyboard focus.
//
// A11Y: the list is a `listbox` and each row a `link`, which is what a
// navigable sidebar is; C's row carries `GTK_ACCESSIBLE_RELATION_LABELLED_BY`
// the label (`:262-266`) and the list's own label is "Sidebar".
//
// Events: `notify::stack` (CustomEvent, bubbles, detail `{ stack }`).
//
// Reference: refs/gtk/gtk/gtkstacksidebar.c
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import type { GtkStack } from './gtk-stack.js';

/** The `GtkStackPageInfo` half this element reads — it never looks inside `child`. */
interface SidebarPage {
    name: string;
    title: string | null;
    needsAttention: boolean;
    visible: boolean;
    child: HTMLElement;
}

export class GtkStackSidebar extends HTMLElement {
    private _stack: GtkStack | null = null;
    private _list!: HTMLDivElement;
    private _initialized = false;
    private _rows: HTMLButtonElement[] = [];
    private readonly _onStackChange = (): void => this._rebuild();

    static get observedAttributes() {
        return ['stack'];
    }

    /** `Gtk.StackSidebar:stack` — the stack this sidebar drives, or null. */
    get stack(): GtkStack | null {
        return this._stack;
    }

    set stack(value: GtkStack | string | null) {
        this.setStack(typeof value === 'string' ? this._resolve(value) : value);
    }

    /** Rebuild the rows by hand, for a consumer that mutated a page in place. */
    refresh(): void {
        this._rebuild();
    }

    connectedCallback() {
        if (this._initialized) {
            this._bindStack();
            this._rebuild();
            return;
        }
        this._initialized = true;
        this._list = document.createElement('div');
        this._list.className = 'adw-stack-sidebar-list navigation-sidebar';
        this._list.setAttribute('role', 'listbox');
        // The translated "Sidebar" of gtkstacksidebar.c:157-159.
        this._list.setAttribute('aria-label', 'Sidebar');
        this.replaceChildren(this._list);
        // `.sidebar` is on the widget itself (gtkstacksidebar.c:163).
        this.classList.add('sidebar');

        const ref = this.getAttribute('stack');
        if (ref) {
            this.setStack(this._resolve(ref));
            return;
        }
        this._rebuild();
    }

    disconnectedCallback() {
        this._unbindStack();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized || name !== 'stack') return;
        this.setStack(value === null ? null : this._resolve(value));
    }

    /** Bind to a stack element (or null). Unbinds the previous one, as `set_stack` does. */
    setStack(stack: GtkStack | null): void {
        if (stack === this._stack) return;
        this._unbindStack();
        this._stack = stack;
        this._bindStack();
        this._rebuild();
        this.dispatchEvent(new CustomEvent('notify::stack', { bubbles: true, detail: { stack: this._stack } }));
    }

    private _resolve(id: string | null): GtkStack | null {
        if (!id) return null;
        return (document.getElementById(id) as GtkStack | null) ?? null;
    }

    private _bindStack(): void {
        this._stack?.addEventListener('items-changed', this._onStackChange);
        this._stack?.addEventListener('selection-changed', this._onStackChange);
        this._stack?.addEventListener('page-updated', this._onStackChange);
    }

    private _unbindStack(): void {
        this._stack?.removeEventListener('items-changed', this._onStackChange);
        this._stack?.removeEventListener('selection-changed', this._onStackChange);
        this._stack?.removeEventListener('page-updated', this._onStackChange);
    }

    private _pages(): SidebarPage[] {
        const stack = this._stack as (GtkStack & { pages?: SidebarPage[] }) | null;
        return stack?.pages ?? [];
    }

    /**
     * `update_row`'s visibility rule (gtkstacksidebar.c:186): the page is visible AND
     * carries a title. There is no icon fallback — `update_row` never reads `icon-name`,
     * which is the one rule where this sidebar and the switcher disagree.
     */
    private _visible(page: SidebarPage): boolean {
        return page.visible && page.title !== null;
    }

    private _selectedIndex(): number {
        const pages = this._pages();
        const name = this._stack?.visibleChildName ?? null;
        return name === null ? -1 : pages.findIndex((page) => page.name === name);
    }

    /**
     * An `items-changed` rebuilds the list wholesale (gtkstacksidebar.c:307-311) and a
     * `selection-changed` does not (:317-338), so the rows are recreated ONLY when the
     * page COUNT moves.
     */
    private _rebuild(): void {
        if (!this._initialized) return;
        const pages = this._pages();
        if (pages.length !== this._rows.length) {
            this._list.replaceChildren();
            this._rows = pages.map(() => this._buildRow());
            this._list.append(...this._rows);
        }
        const selected = this._selectedIndex();
        pages.forEach((page, index) => {
            const row = this._rows[index];
            if (!row) return;
            const label = row.querySelector('.adw-stack-sidebar-title');
            if (label) label.textContent = page.title ?? '';
            row.hidden = !this._visible(page);
            row.classList.toggle('needs-attention', page.needsAttention);
            row.classList.toggle('selected', index === selected);
            row.setAttribute('aria-selected', String(index === selected));
        });
    }

    private _buildRow(): HTMLButtonElement {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'adw-stack-sidebar-row';
        // A navigable sidebar row is a LINK, which is what a `GtkListBoxRow` with an
        // activatable child presents as; the label is what names it (gtkstacksidebar.c:262).
        row.setAttribute('role', 'link');
        const label = document.createElement('span');
        label.className = 'adw-stack-sidebar-title';
        row.appendChild(label);
        row.addEventListener('click', () => this._onRowActivated(row));
        return row;
    }

    /**
     * `gtk_stack_sidebar_row_selected` (gtkstacksidebar.c:130-143): a selected row
     * selects its page. An UNSELECTION is not driven from here — the model is the
     * authority, exactly as in the switcher.
     */
    private _onRowActivated(row: HTMLButtonElement): void {
        const index = this._rows.findIndex((candidate) => candidate === row);
        if (index === -1) return;
        const page = this._pages()[index];
        if (!page) return;
        if (this._stack?.isSelected(page.child)) return;
        this._stack?.setVisibleChild(page.child);
    }
}

customElements.define('gtk-stack-sidebar', GtkStackSidebar);
