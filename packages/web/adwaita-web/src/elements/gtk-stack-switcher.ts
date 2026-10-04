// <gtk-stack-switcher> — a row of linked toggle buttons, one per page of a
// <gtk-stack>, that switches between them. It is the tab strip `Adw.TabView`
// supersedes, and the widget `Adw.ViewSwitcher` wraps.
//
// IT OWNS NO PAGES. C binds the stack through `set_stack`, reads its `pages`
// selection model and builds one `GtkToggleButton` per page
// (gtkstackswitcher.c:428-445, :268-275). `stack` here is an id reference, like
// `<label for>`, because a browser attribute cannot carry a widget — the same
// spelling `<adw-view-switcher-bar>` already uses.
//
// WHAT A BUTTON SHOWS, transcribed from `rebuild_child` + `update_button`
// (gtkstackswitcher.c:137-207):
//   icon-name set    → an icon child, and the SWITCHER takes the title as its
//                      tooltip (:146-147). The button wears `image-button`.
//   title set        → a label child with `use_underline` (:161-166), the
//                      tooltip is CLEARED (:168), and the button wears
//                      `text-button`.
//   neither          → NO child at all, and the button is hidden: a row is
//                      visible when the page is visible AND carries a title or an
//                      icon (`:200`).
// `needs-attention` puts the `.needs-attention` class on the button (:203-206).
//
// THE TWO-WAY BINDING. A button's activation selects the page
// (`on_button_toggled`, gtkstackswitcher.c:113-133) — and DEACTIVATION is undone
// from the model, so a user cannot deselect the current page by clicking it
// (:126-131). The stack's side is `selection_changed_cb`, which re-marks the
// buttons in the changed range (:359-381) and never rebuilds them, which is why
// this element keeps its button nodes across a selection change and only rebuilds
// them on `items-changed` (:347-355).
//
// A11Y: each button is `role="tab"` with `aria-selected`, the role C installs on
// the toggle (gtkstackswitcher.c:279), and the row is a `tablist` — the C side is
// a GtkBoxLayout of toggles with no list role of its own.
//
// `stack` is READ-ONLY from the browser's side in the sense that C has it, but the
// property is writable there and so it is here: `setStack()` rebinds and
// `stack="<id>"` names a stack in markup. `set_stack` on the SAME stack is a
// no-op that does not notify (gtkstackswitcher.c:430-432).
//
// Events: `notify::stack` and `notify::orientation` (CustomEvent, bubbles,
// detail `{ <prop>: value }`).
//
// Reference: refs/gtk/gtk/gtkstackswitcher.c
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { normalizeBoxOrientation, type BoxOrientation } from '@gjsify/adwaita-core';

import type { GtkStack } from './gtk-stack.js';

/** The `GtkStackPageInfo` half this element reads — it never looks inside `child`. */
interface SwitcherPage {
    name: string;
    title: string | null;
    iconName: string | null;
    needsAttention: boolean;
    visible: boolean;
    child: HTMLElement;
}

/** One button and the nodes it paints, kept across selection changes. */
interface SwitcherButton {
    button: HTMLButtonElement;
    label: HTMLSpanElement;
    icon: HTMLElement;
}

export class GtkStackSwitcher extends HTMLElement {
    private _stack: GtkStack | null = null;
    private _initialized = false;
    private _nodes: SwitcherButton[] = [];
    private readonly _onStackChange = (): void => this._rebuild();

    static get observedAttributes() {
        return ['stack', 'orientation'];
    }

    /** `Gtk.StackSwitcher:stack` — the stack this switcher drives, or null. */
    get stack(): GtkStack | null {
        return this._stack;
    }

    set stack(value: GtkStack | string | null) {
        this.setStack(typeof value === 'string' ? this._resolve(value) : value);
    }

    /** `GtkOrientable:orientation` (gtkstackswitcher.c:47). */
    get orientation(): BoxOrientation {
        return normalizeBoxOrientation(this.getAttribute('orientation'));
    }

    set orientation(v: BoxOrientation) {
        if (this.getAttribute('orientation') === v) return;
        this.setAttribute('orientation', v);
    }

    /**
     * Rebuild the buttons by hand, for a consumer that mutated a page in place. Not
     * the only path: the stack emits `page-updated` and `items-changed`, and this
     * element binds both, which is the mechanism C uses (`:311-321`, `:347-355`).
     */
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
        this.setAttribute('role', 'tablist');
        // `.linked` is what C puts on the switcher itself (gtkstackswitcher.c:49-57),
        // and the stylesheet reads it to join the buttons into one control.
        this.classList.add('linked');
        // Resolve the id reference now the element is in the document.
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
        if (!this._initialized) return;
        if (name === 'orientation') {
            // `gtk_stack_switcher_set_orientation` re-lays-out the box, so the buttons
            // are kept and the STYLESHEET turns them (gtkstackswitcher.c:500-513).
            this._render();
            this.dispatchEvent(
                new CustomEvent('notify::orientation', { bubbles: true, detail: { orientation: this.orientation } }),
            );
            return;
        }
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

    /**
     * A button is visible when its page is visible AND the page carries a title or an
     * icon (gtkstackswitcher.c:200). `visible` false must hide the row, and an absent
     * title with no icon leaves the button childless — `rebuild_child` builds nothing
     * for it (`:158-176`).
     */
    private _visible(page: SwitcherPage): boolean {
        return page.visible && (page.title !== null || page.iconName !== null);
    }

    /**
     * The pages, in the order the stack holds them. A stack that is not upgraded has no
     * `pages` getter, which is why it is read defensively.
     */
    private _pages(): SwitcherPage[] {
        const stack = this._stack as (GtkStack & { pages?: SwitcherPage[] }) | null;
        return stack?.pages ?? [];
    }

    /** Which page the stack has selected, by position, `-1` for none. */
    private _selectedIndex(): number {
        const pages = this._pages();
        const name = this._stack?.visibleChildName ?? null;
        return name === null ? -1 : pages.findIndex((page) => page.name === name);
    }

    /**
     * `items_changed_cb` rebuilds everything (gtkstackswitcher.c:347-355) and a
     * `selection_changed_cb` does not — so the nodes are recreated ONLY when the page
     * COUNT moves, and a selection change re-marks them in place (:359-381). Replacing
     * a button mid-interaction would also drop keyboard focus.
     */
    private _rebuild(): void {
        if (!this._initialized) return;
        const pages = this._pages();
        if (pages.length !== this._nodes.length) {
            this.replaceChildren();
            this._nodes = pages.map(() => this._buildButton());
            this.append(...this._nodes.map((nodes) => nodes.button));
        }
        const selected = this._selectedIndex();
        pages.forEach((page, index) => {
            const nodes = this._nodes[index];
            if (!nodes) return;
            nodes.button.hidden = !this._visible(page);
            nodes.button.classList.toggle('active', index === selected);
            nodes.button.setAttribute('aria-selected', String(index === selected));
            nodes.button.classList.toggle('needs-attention', page.needsAttention);

            // `rebuild_child`'s two branches (gtkstackswitcher.c:139-176): an icon wins
            // and the button becomes `image-button`; a title alone makes it a
            // `text-button` with a label child; neither leaves it empty.
            const hasIcon = page.iconName !== null;
            const hasTitle = page.title !== null;
            nodes.icon.hidden = !hasIcon;
            nodes.label.hidden = !hasTitle;
            nodes.label.textContent = page.title ?? '';
            nodes.button.dataset.buttonMode = hasIcon ? (hasTitle ? 'both' : 'icon') : 'text';
            if (hasIcon) {
                nodes.icon.setAttribute('icon-name', page.iconName as string);
                // The tooltip goes on the SWITCHER, not the button (gtkstackswitcher.c:146).
                this.title = page.title ?? '';
            } else {
                nodes.icon.removeAttribute('icon-name');
                // A title-only button CLEARS it (gtkstackswitcher.c:168).
                this.removeAttribute('title');
            }
        });
        this._render();
    }

    private _buildButton(): SwitcherButton {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'adw-stack-switcher-button';
        button.setAttribute('role', 'tab');
        const icon = document.createElement('span');
        icon.className = 'adw-stack-switcher-icon';
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'adw-stack-switcher-title';
        button.append(icon, label);
        // `on_button_toggled` (gtkstackswitcher.c:113-133): an activation selects the
        // page, and a DEACTIVATION is taken back from the stack — so the current page
        // cannot be deselected by clicking its own button.
        button.addEventListener('click', () => this._onToggled(button));
        return { button, label, icon };
    }

    private _onToggled(button: HTMLButtonElement): void {
        const index = this._nodes.findIndex((nodes) => nodes.button === button);
        if (index === -1) return;
        const page = this._pages()[index];
        if (!page) return;
        if (this._stack?.isSelected(page.child)) return;
        this._stack?.setVisibleChild(page.child);
    }

    /**
     * The orientation attribute is the GIR property's own spelling (gtkstackswitcher.c:47)
     * and the stylesheet selects on it directly, so there is nothing to mirror onto a
     * second attribute; this hook exists so the render pass has one entry point.
     */
    private _render(): void {
        this.setAttribute('aria-orientation', this.orientation);
    }
}

customElements.define('gtk-stack-switcher', GtkStackSwitcher);
