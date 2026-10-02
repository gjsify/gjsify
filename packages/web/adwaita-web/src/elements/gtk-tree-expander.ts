// <gtk-tree-expander> — the indent + disclosure arrow a tree row wears in front of its
// contents, the web counterpart of `Gtk.TreeExpander`.
//
// THE `Gtk.TreeListRow` IS THREE NUMBERS HERE (ADR 0089). Upstream the expander WATCHES a
// row object a `GtkTreeListModel` produced from a create-model callback — a function from
// an item to its children, called lazily, with the parent chain held by the model.
// Porting the object would mean porting that model, which is the sorting/filtering/
// virtualisation half ADR 0046 § 7 refused for the same reason. What the expander
// actually READS off the row is its depth, whether it can expand and whether it is
// expanded, so those three are the attributes — `depth`, `expandable`, `expanded` — and
// `list-row` has no attribute at all.
//
// WHAT THAT COSTS, stated rather than absorbed: upstream an expander exists BEFORE a row
// is assigned, and `gtk_tree_expander_update_for_list_row` has a whole branch for it that
// unparents every ornament. Here the row IS the attributes, so an expander carrying none
// of them is a root leaf — which is the common authored case — and there is no rowless
// state for that branch to be. `TREE_EXPANDER_LAYOUT_VECTORS` carries the row anyway,
// because the core function still answers it, and the element's own suite says which row
// it therefore cannot drive.
//
// THE NODE ARITHMETIC IS CORE'S (ADR 0004). `treeExpanderLayout` is
// `gtk_tree_expander_update_for_list_row` (gtktreeexpander.c:166-265), including the part
// that is easy to get wrong: with no expander drawn, `indent-for-icon` adds ONE to the
// depth so a leaf lines up with its expandable siblings' content, and the accessible
// level is computed AFTER that increment. `treeExpanderAction` is the shortcut table from
// the same file.
//
// THE CHILD STAYS IN THE LIGHT DOM, so a `.blp`'s `child` property, a slot assignment and
// plain markup are all the same thing: the indents and the expander are INSERTED BEFORE
// it, exactly as `gtk_widget_insert_before (…, self->child)` does, and are removed again
// when the row says they are not needed.
//
// Attributes:
//   hide-expander     — boolean; `Gtk.TreeExpander:hide-expander`.
//   indent-for-depth  — the GIR default is TRUE, so this is the OFF switch: the attribute
//                       is read as `indent-for-depth="false"`, not as a bare flag.
//   indent-for-icon   — the same, and the same default.
//   depth             — the row's depth, 0 at the root (`gtk_tree_list_row_get_depth`).
//   expandable        — boolean; `gtk_tree_list_row_is_expandable`.
//   expanded          — boolean; `Gtk.TreeListRow:expanded`.
// Properties: hideExpander, indentForDepth, indentForIcon, depth, expandable, expanded.
// Events: `notify::expanded` (CustomEvent, bubbles, detail = { expanded }) — every change,
//   programmatic included, which is what `Gtk.TreeListRow` notifies.
// A11Y: `role="button"` with `aria-expanded` and `aria-level`, which is what GTK has used
//   since 4.12 (gtktreeexpander.c:246-266); before that it was `group`.
//
// Reference: refs/gtk/gtk/gtktreeexpander.c:166-265 (the node arithmetic)
// Reference: refs/gtk/gtk/gtktreeexpander.c:654-691 (the shortcuts), :709-734 (drag-hover)
// Reference: refs/libadwaita/src/stylesheet/widgets/_expanders.scss:1-10 (the expander node)
// Reference: refs/libadwaita/src/stylesheet/widgets/_column-view.scss:128-130 (border-spacing)
// Copyright (c) GNOME contributors (GTK/libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    treeExpanderAction,
    treeExpanderExpanded,
    treeExpanderLayout,
    type AdwTreeExpanderLayout,
} from '@gjsify/adwaita-core';

import { createGtkImage } from './gtk-image.js';

/** `TIMEOUT_EXPAND` — how long a drag hovers before the row opens (gtktreeexpander.c:717). */
const TIMEOUT_EXPAND = 500;

export class GtkTreeExpander extends HTMLElement {
    private _ornaments: HTMLElement[] = [];
    private _expandTimer: ReturnType<typeof setTimeout> | null = null;
    private _initialized = false;

    static get observedAttributes() {
        return ['hide-expander', 'indent-for-depth', 'indent-for-icon', 'depth', 'expandable', 'expanded'];
    }

    get hideExpander(): boolean {
        return this.hasAttribute('hide-expander');
    }

    set hideExpander(value: boolean) {
        this.toggleAttribute('hide-expander', !!value);
    }

    /** Default TRUE (gtktreeexpander.c:750), so only the literal `false` turns it off. */
    get indentForDepth(): boolean {
        return this.getAttribute('indent-for-depth') !== 'false';
    }

    set indentForDepth(value: boolean) {
        this.setAttribute('indent-for-depth', String(!!value));
    }

    /** Default TRUE (gtktreeexpander.c:749), read the same way as `indent-for-depth`. */
    get indentForIcon(): boolean {
        return this.getAttribute('indent-for-icon') !== 'false';
    }

    set indentForIcon(value: boolean) {
        this.setAttribute('indent-for-icon', String(!!value));
    }

    /** The row's depth — 0 at the root, as `gtk_tree_list_row_get_depth` reports it. */
    get depth(): number {
        const parsed = Number.parseInt(this.getAttribute('depth') ?? '', 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    set depth(value: number) {
        this.setAttribute('depth', String(value));
    }

    get expandable(): boolean {
        return this.hasAttribute('expandable');
    }

    set expandable(value: boolean) {
        this.toggleAttribute('expandable', !!value);
    }

    get expanded(): boolean {
        return this.hasAttribute('expanded');
    }

    set expanded(value: boolean) {
        this.toggleAttribute('expanded', !!value);
    }

    /** What this expander draws, as counts — `treeExpanderLayout`'s answer for it. */
    get layout(): AdwTreeExpanderLayout {
        return treeExpanderLayout(
            { depth: this.depth, expandable: this.expandable, expanded: this.expanded },
            {
                hideExpander: this.hideExpander,
                indentForDepth: this.indentForDepth,
                indentForIcon: this.indentForIcon,
            },
        );
    }

    connectedCallback() {
        if (!this._initialized) {
            this._initialized = true;
            if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
            this._wire();
        }
        this.setAttribute('role', 'button');
        this._render();
    }

    /** The listeners, installed once — they sit on the element, so a re-parent keeps them. */
    private _wire(): void {
        this.addEventListener('keydown', (event) => {
            const action = treeExpanderAction(event.key, {
                ctrlKey: event.ctrlKey,
                shiftKey: event.shiftKey,
                rtl: globalThis.getComputedStyle(this).direction === 'rtl',
            });
            if (action === 'none') return;
            event.preventDefault();
            this.expanded = treeExpanderExpanded(this.expanded, action);
        });

        // A drag that rests over a collapsed row opens it, so a drop can reach a child
        // the tree has not shown yet (gtktreeexpander.c:719-745).
        this.addEventListener('dragenter', () => {
            if (this.expanded || this._expandTimer !== null) return;
            this._expandTimer = setTimeout(() => {
                this._expandTimer = null;
                this.expanded = true;
            }, TIMEOUT_EXPAND);
        });
        for (const name of ['dragleave', 'drop']) {
            this.addEventListener(name, () => this._cancelExpandTimer());
        }
    }

    disconnectedCallback() {
        // Cleanup beside creation: `gtk_tree_expander_dispose` clears the same timer, and
        // a pending one here would expand a row that is no longer in the document.
        this._cancelExpandTimer();
    }

    attributeChangedCallback(name?: string) {
        if (!this._initialized) return;
        this._render();
        if (name === 'expanded') {
            this.dispatchEvent(
                new CustomEvent('notify::expanded', { bubbles: true, detail: { expanded: this.expanded } }),
            );
        }
    }

    private _cancelExpandTimer(): void {
        if (this._expandTimer === null) return;
        clearTimeout(this._expandTimer);
        this._expandTimer = null;
    }

    /**
     * Rebuild the indents and the expander in front of the child.
     *
     * Every ornament is dropped and rebuilt rather than diffed: there are at most
     * depth + 1 of them, they hold no state and no focus, and a diff over two kinds of
     * node is where the leaf/expandable transition would go wrong.
     */
    private _render(): void {
        for (const ornament of this._ornaments) ornament.remove();
        this._ornaments = [];

        const layout = this.layout;
        const before = this.firstChild;
        for (let i = 0; i < layout.indents; i++) {
            const indent = document.createElement('span');
            indent.className = 'adw-tree-expander-indent';
            indent.setAttribute('aria-hidden', 'true');
            this.insertBefore(indent, before);
            this._ornaments.push(indent);
        }

        if (layout.expander === 'none') {
            this.removeAttribute('aria-expanded');
        } else {
            // libadwaita's `expander` node is `pan-end-symbolic`, turning to
            // `pan-down-symbolic` when `:checked` (_expanders.scss:1-10). This package's
            // icon subset carries `go-next`, and `.expanded` rotates it a quarter turn —
            // the substitution `<adw-expander-row>` already makes for its chevron.
            const icon = createGtkImage('go-next', 'adw-tree-expander-icon');
            icon.classList.toggle('expanded', layout.expander === 'expanded');
            icon.addEventListener('click', (event) => {
                // The gesture is on the ICON upstream, not on the whole widget: the rest
                // of the row belongs to the list view's own click.
                event.stopPropagation();
                this.expanded = !this.expanded;
            });
            this.insertBefore(icon, before);
            this._ornaments.push(icon);
            this.setAttribute('aria-expanded', String(layout.expander === 'expanded'));
        }

        this.setAttribute('aria-level', String(layout.level));
    }
}

customElements.define('gtk-tree-expander', GtkTreeExpander);
