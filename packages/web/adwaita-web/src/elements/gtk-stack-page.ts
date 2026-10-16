// <gtk-stack-page> — the page record a `<gtk-stack>` is AUTHORED with.
//
// NOT A WIDGET, AS UPSTREAM. `GtkStackPage` descends from `GObject.Object` (gtkstack.c:212-233):
// it carries a page's `name`, `title`, `icon-name` and attention state beside the `child` that IS
// the page. A Blueprint spells it `Stack { StackPage { name: "debugger"; child: … } }`, and
// without an element for it the shared-tree builder refused every such `.blp`.
//
// THE STACK ADOPTS IT AND KEEPS NO RECORD, the shape `<adw-view-stack>` gives
// `<adw-view-stack-page>`: `<gtk-stack>` already reads a page's six properties as attributes on
// its CHILD (see `gtk-stack.ts`), so adopting a record copies them onto the child and puts the
// child where the record was. The record leaves the tree, which is the browser half of what
// `@gjsify/adwaita-nativescript`'s `stack-page.ts` refuses after adoption: a write to a record
// the stack no longer reads would be a silent no-op.
//   name / title / icon-name / needs-attention / use-underline — the same attributes
//   visible — the DOM's own `hidden`, as on the child (`GtkStackPage:visible`, gtkstack.c:567)
//   child   — the slot `child`, or the record's one element child (a bare child IS the page)
//
// Reference: refs/gtk/gtk/gtkstack.c (GtkStackPage)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { bindSlottedChildren } from '../slotted-children.js';

/** The attributes a record hands to its child on adoption — `GtkStackPage`'s string/boolean properties. */
export const STACK_PAGE_ATTRIBUTES = ['name', 'title', 'icon-name', 'needs-attention', 'use-underline'] as const;

export class GtkStackPage extends HTMLElement {
    static get observedAttributes() {
        return [...STACK_PAGE_ATTRIBUTES];
    }

    /** `GtkStackPage:name` — what `visible-child-name` selects by. */
    get name(): string {
        return this.getAttribute('name') ?? '';
    }

    set name(value: string | null) {
        if (value === null) this.removeAttribute('name');
        else this.setAttribute('name', value);
    }

    // `GtkStackPage:title` is `HTMLElement.title`, which already reflects the `title` attribute.

    /** `GtkStackPage:icon-name`. */
    get iconName(): string | null {
        return this.getAttribute('icon-name');
    }

    set iconName(value: string | null) {
        if (value === null) this.removeAttribute('icon-name');
        else this.setAttribute('icon-name', value);
    }

    /** `GtkStackPage:needs-attention`. */
    get needsAttention(): boolean {
        return this.hasAttribute('needs-attention');
    }

    set needsAttention(value: boolean) {
        this.toggleAttribute('needs-attention', !!value);
    }

    /** `GtkStackPage:use-underline`. */
    get useUnderline(): boolean {
        return this.hasAttribute('use-underline');
    }

    set useUnderline(value: boolean) {
        this.toggleAttribute('use-underline', !!value);
    }

    /** `GtkStackPage:visible` — `hidden`, as on the child the stack reads it from. */
    get visible(): boolean {
        return !this.hasAttribute('hidden');
    }

    set visible(value: boolean) {
        this.toggleAttribute('hidden', !value);
    }

    /** `GtkStackPage:child` — the element the stack shows for this page, while not yet adopted. */
    get child(): HTMLElement | null {
        return pageChildOf(this);
    }

    connectedCallback(): void {
        // `child:` in a `.blp` authors `slot="child"`, and the mount refuses a name this element
        // never declared. The stack adopts on ITS connect, which runs first, so by now this
        // record is usually detached; enrolling the name is all that is left to do.
        bindSlottedChildren(this, [{ name: 'child', into: this }]);
    }
}

/**
 * The one element a record holds: its `slot="child"` child or its only element child. A record
 * with none, or with more than one, is refused by name — GtkStackPage has exactly one `child`.
 */
export function pageChildOf(page: HTMLElement): HTMLElement | null {
    const elements = Array.from(page.children) as HTMLElement[];
    const slotted = elements.filter((child) => child.getAttribute('slot') === 'child');
    const candidates = slotted.length > 0 ? slotted : elements;
    if (candidates.length > 1) {
        throw new Error(
            `<gtk-stack-page name="${page.getAttribute('name') ?? ''}"> holds ${candidates.length} children, ` +
                'and a GtkStackPage has one `child`.',
        );
    }
    return candidates[0] ?? null;
}

customElements.define('gtk-stack-page', GtkStackPage);
