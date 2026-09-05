// <adw-view-stack> — A standalone, named-page CONTENT container: the web
// counterpart of Adw.ViewStack decoupled from any switcher. It holds a set of
// named pages and shows exactly one at a time; a paired <adw-view-switcher-bar>
// (or an adaptive header-bar switcher) binds to it and drives the selection. The
// alternative switchers (<adw-view-switcher>, <adw-inline-view-switcher>) own their
// own pages instead.
//
// The SELECTION itself — the name lookup, the guards on an index change, the
// first-visible-page auto-pick and which paths notify — is HEADLESS and lives in
// `@gjsify/adwaita-core` (ADR 0004) as {@link ViewStackState}, shared with the
// NativeScript twin and specced by the conformance vectors in
// `@gjsify/adwaita-core/conformance`. This element is the DOM half only: it
// turns declared markup into pages, toggles their visibility, reflects the
// selection to an attribute, and re-emits the change as a DOM event.
//
// Pages are declared as <adw-view-stack-page> children with `name`, `title`,
// `icon-name` and `hidden` attributes (their own children become the page body),
// OR added imperatively with `add(content, name, title?, icon?)`. The first
// VISIBLE page is shown automatically.
//
// Attributes:
//   visible-child-name — the name of the page to show. Reading/writing it stays
//     in sync with the `visibleChildName` property so an adaptive layout can
//     drive the stack declaratively (mirrors the Adw.ViewStack GObject prop).
//     An EMPTY value is a legal name lookup, not "no name".
// Properties (mirroring Adw.ViewStack):
//   pages               — readonly page descriptors ({ name, title, icon, content, visible }).
//   visibleChildName    — name of the visible page ('' when nothing is selected).
//   visibleChildIndex   — READ-ONLY report: position of the visible page, -1 for none.
//                         Selecting is `visibleChildName` (ADR 0048).
//   visibleChild        — the visible page's content element (or null).
// Methods:
//   add(content, name, title?, icon?) — append a page; returns its descriptor.
//   addTitled(content, name, title)   — Adw.ViewStack.add_titled convenience.
//   removePage(name)                  — Adw.ViewStack.remove; clears the selection
//                                       when the removed page was the visible one.
//   setPageVisible(name, visible)     — AdwViewStackPage:visible; hiding the visible
//                                       page falls back to the next visible one.
// Events:
//   `notify::visible-child` (CustomEvent, bubbles,
//     detail = { index, name, title, interactive }) whenever the visible page changes,
//     INCLUDING the auto-shown first page — `set_visible_child` notifies there too, and
//     a switcher that is not told needs a manual `refresh()`. `interactive` is false
//     for an auto-pick.
// Reference: refs/libadwaita/src/adw-view-stack.c (AdwViewStack behaviour)
// Reference: packages/nativescript-bridge/adwaita/src/widgets/adw-view-stack.ts (NS twin)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { ViewStackState } from '@gjsify/adwaita-core';
import type { AdwViewStackPageInfo as CorePageInfo, ViewStackStateChange } from '@gjsify/adwaita-core';

export type AdwViewStackPageInfo = CorePageInfo<HTMLElement>;

export class AdwViewStack extends HTMLElement {
    private readonly _state = new ViewStackState<HTMLElement>();
    private _initialized = false;

    static get observedAttributes() {
        return ['visible-child-name'];
    }

    constructor() {
        super();
        // Subscribing touches no attributes and no children, so it is legal in a
        // custom element constructor — unlike anything DOM-shaped.
        this._state.subscribe((change) => this._onStateChange(change));
    }

    get pages(): readonly AdwViewStackPageInfo[] {
        return this._state.pages;
    }

    /**
     * Zero-based position of the visible page, `-1` when nothing is selected.
     *
     * A REPORT, NOT A DOOR (ADR 0048). `Adw.ViewStack` selects by NAME, and an ordinal is
     * derived — an insertion before the visible page increments it, a reorder rewrites it,
     * a removal decrements it. Selecting is {@link visibleChildName}.
     */
    get visibleChildIndex(): number {
        return this._state.visibleIndex;
    }

    /**
     * Show the page at position `n`. Returns whether the selection moved.
     *
     * THE ORDINAL IS A CALL, NOT A PROPERTY (ADR 0048): it resolves against the page list
     * as it is now and keeps nothing, where a held index comes to mean another page after
     * an insert, a reorder or a removal. Port-owned — `refs/libadwaita` gives
     * `AdwViewStack` no ordinal API — and named for the tab view's existing
     * `selectNthPage`. The guard on `n` is the core's and is pinned by the shared vectors.
     */
    selectNthPage(n: number): boolean {
        return this._state.setVisibleIndex(n);
    }

    get visibleChildName(): string {
        return this._state.visibleName;
    }

    set visibleChildName(name: string | null | undefined) {
        this._state.setVisibleName(name);
    }

    get visibleChild(): HTMLElement | null {
        return this._state.visiblePage?.content ?? null;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Read the declared selection BEFORE adopting any page: the auto-pick
        // reflects its own name back into this very attribute, which would
        // otherwise overwrite the author's value with page 0's name.
        const initialName = this.getAttribute('visible-child-name');

        // Adopt the declared <adw-view-stack-page> children by APPENDING them, never by
        // replacing the page list: a stack built imperatively before it entered the
        // document (`createElement` → `add()` → `body.append()`) would lose every page
        // it had been given. libadwaita has no parse-once phase that can discard
        // children — the buildable adds them one at a time and `adw_view_stack_add`
        // works at any point in the widget's life.
        for (const pageEl of Array.from(this.querySelectorAll(':scope > adw-view-stack-page')) as HTMLElement[]) {
            // A declared page with no `name` is the page named '': C stores the name
            // verbatim, and an invented `page-<index>` would be addressable by a name the
            // author never wrote.
            const name = pageEl.getAttribute('name') ?? '';
            const element = document.createElement('div');
            element.className = 'adw-view-stack-child';
            element.dataset.name = name;
            for (const child of Array.from(pageEl.childNodes)) element.appendChild(child);

            this._state.addPage({
                name,
                title: pageEl.getAttribute('title'),
                icon: pageEl.getAttribute('icon-name'),
                content: element,
                // `hidden` is the DOM spelling of AdwViewStackPage:visible, which
                // gates the auto-pick and refuses selection.
                visible: !pageEl.hasAttribute('hidden'),
            });
            this.replaceChild(element, pageEl);
        }

        // An explicit `visible-child-name` selects the initial page; only a MISSING
        // attribute falls through to the auto-pick. An empty value is a legal lookup for
        // a page named '' (`g_strcmp0`), so a falsy check here is wrong.
        if (initialName !== null) this._state.setVisibleName(initialName, false);
        this._applyVisibility();
        this._reflectName();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        // Only a REMOVAL is ignored (there is no name to select). An empty value
        // goes through the same lookup as the property setter — the declarative
        // and imperative paths must not disagree on the same input.
        if (name === 'visible-child-name' && value !== null && value !== this._state.visibleName) {
            this._state.setVisibleName(value);
        }
    }

    /**
     * Append a page. It becomes visible when nothing is selected yet, matching
     * `Adw.ViewStack.add()`, and that auto-pick NOTIFIES.
     */
    add(content: HTMLElement, name: string, title?: string, icon?: string): AdwViewStackPageInfo {
        content.classList.add('adw-view-stack-child');
        content.dataset.name = name;
        const page = this._state.addPage({ name, title, icon, content });
        this.appendChild(content);
        this._applyVisibility();
        this._reflectName();
        this._emitItemsChanged();
        return page;
    }

    addTitled(content: HTMLElement, name: string, title: string): AdwViewStackPageInfo {
        return this.add(content, name, title);
    }

    /**
     * Remove the first page named `name` and detach its content. Returns whether
     * anything was removed. When the removed page was the visible one the stack
     * ends up showing NOTHING and emits no event — `stack_remove` clears
     * `visible_child` without re-picking.
     */
    removePage(name: string): boolean {
        const content = this._state.pages[this._state.indexOfName(name)]?.content;
        if (!this._state.removePage(name)) return false;
        content?.remove();
        this._applyVisibility();
        this._reflectName();
        this._emitItemsChanged();
        return true;
    }

    /**
     * Show or hide a page (`AdwViewStackPage:visible`). Returns whether the
     * SELECTION moved: hiding the visible page falls back to the next visible
     * one, and making a page visible while nothing is selected selects it
     * (`update_child_visible`).
     */
    setPageVisible(name: string, visible: boolean): boolean {
        const moved = this._state.setPageVisible(name, visible);
        this._applyVisibility();
        // A visibility flip changes what the pages MODEL reports, which is what
        // `update_bar_revealed` counts — hiding the second-to-last visible page must
        // retract the bar.
        this._emitItemsChanged();
        return moved;
    }

    /**
     * The pages model's `items-changed`: `AdwViewSwitcherBar` re-runs
     * `update_bar_revealed` on it and `AdwViewSwitcher` rebinds its buttons. A listener
     * on `notify::visible-child` alone leaves `revealed` and the button row stale when a
     * page is added or a non-selected one hidden.
     */
    private _emitItemsChanged(): void {
        this.dispatchEvent(new CustomEvent('items-changed', { bubbles: true, detail: { count: this.pages.length } }));
    }

    private _onStateChange(change: ViewStackStateChange<HTMLElement>): void {
        this._applyVisibility();
        this._reflectName();
        this.dispatchEvent(
            new CustomEvent('notify::visible-child', {
                bubbles: true,
                detail: {
                    index: change.index,
                    name: change.name,
                    title: change.title,
                    interactive: change.interactive,
                },
            }),
        );
    }

    private _applyVisibility(): void {
        const selected = this._state.visibleIndex;
        this._state.pages.forEach((page, index) => {
            const element = page.content;
            if (!element) return;
            const isVisible = index === selected;
            element.classList.toggle('active-view', isVisible);
            element.hidden = !isVisible;
        });
    }

    private _reflectName(): void {
        // With nothing selected there is no name to mirror — C's
        // `adw_view_stack_get_visible_child_name` returns NULL, and a missing attribute
        // is the DOM spelling of that. An EMPTY name is still a name and IS reflected: a
        // truthiness guard here stops a stack of nameless pages reflecting at all.
        if (this._state.visibleIndex < 0) {
            this.removeAttribute('visible-child-name');
            return;
        }
        const current = this._state.visibleName;
        if (this.getAttribute('visible-child-name') !== current) {
            this.setAttribute('visible-child-name', current);
        }
    }
}

customElements.define('adw-view-stack', AdwViewStack);
