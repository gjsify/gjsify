// <adw-toolbar-view> — A content area framed by top and/or bottom bars
// (typically header bars). Mirrors Adw.ToolbarView.
// Slots: slot="top" (top bars, stacked), slot="bottom" (bottom bars), and any
//   remaining children become the scrollable content.
// Attributes: top-bar-style / bottom-bar-style (flat | raised | raised-border),
//   extend-content-to-top-edge, extend-content-to-bottom-edge (boolean).
//
// The four style classes libadwaita derives — `raised` and `border` on a bar box,
// `undershoot-top` / `undershoot-bottom` on the view — come from
// `@gjsify/adwaita-core`'s `toolbarViewClasses`. Neither renderer had any of them,
// so a toolbar view looked identical in all three styles and the scroll fade under
// a flat bar was missing entirely.
//
// The undershoot decision reads the ALLOCATED bar heights, exactly as
// `update_undershoots` reads `gtk_widget_get_height (self->top_bar)` — so the
// classes are recomputed whenever a bar box resizes, not once at connect time.
// The allocation itself stays with the browser: flexbox is the layout manager
// here, and `toolbarViewAllocate` is the specification it is measured against
// (see `@gjsify/adwaita-core/conformance`), not a second layout pass fighting it.
//
// Reference: refs/libadwaita/src/adw-toolbar-view.c (update_undershoots, style setters)
// Reference: refs/libadwaita/src/stylesheet/widgets/_toolbars.scss
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/toolbarview.md
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    ADW_TOOLBAR_BAR_CLASSES,
    ADW_TOOLBAR_VIEW_CLASSES,
    parseToolbarStyle,
    toolbarViewClasses,
} from '@gjsify/adwaita-core';
import { bindEmptySections } from '../empty-sections.js';
import { AdwScrollShading } from '../scroll-shading.js';
import { bindSlotAdoption } from '../slot-adoption.js';

export class AdwToolbarView extends HTMLElement {
    private _topEl!: HTMLDivElement;
    private _contentEl!: HTMLDivElement;
    private _bottomEl!: HTMLDivElement;
    private _initialized = false;
    private _resize: ResizeObserver | null = null;
    /**
     * The scroll indicators for every scroller under this view.
     *
     * Owned HERE and not by a scroller widget, because upstream scopes them here:
     * `toolbarview.undershoot-top scrolledwindow` shades whatever scrolls inside,
     * however deeply nested — a split view's two panes included.
     */
    private _shading: AdwScrollShading | null = null;

    static get observedAttributes() {
        return ['top-bar-style', 'bottom-bar-style', 'extend-content-to-top-edge', 'extend-content-to-bottom-edge'];
    }

    /** The top-bar container — append header bars here imperatively. */
    get topBar(): HTMLDivElement {
        return this._topEl;
    }

    /** The scrollable content container. */
    get contentArea(): HTMLDivElement {
        return this._contentEl;
    }

    /** The bottom-bar container. */
    get bottomBar(): HTMLDivElement {
        return this._bottomEl;
    }

    connectedCallback() {
        if (!this._initialized) {
            this._initialized = true;

            const topChildren = Array.from(this.querySelectorAll(':scope > [slot="top"]'));
            const bottomChildren = Array.from(this.querySelectorAll(':scope > [slot="bottom"]'));
            const contentChildren = Array.from(this.childNodes).filter(
                (n) => !topChildren.includes(n as Element) && !bottomChildren.includes(n as Element),
            );

            this._topEl = document.createElement('div');
            this._topEl.className = 'adw-toolbar-view-top';
            for (const child of topChildren) this._topEl.appendChild(child);

            this._contentEl = document.createElement('div');
            this._contentEl.className = 'adw-toolbar-view-content';
            for (const child of contentChildren) this._contentEl.appendChild(child);

            this._bottomEl = document.createElement('div');
            this._bottomEl.className = 'adw-toolbar-view-bottom';
            for (const child of bottomChildren) this._bottomEl.appendChild(child);

            // A bar appended imperatively — which `topBar` invites — is a childList
            // change, not an attribute one, so the empty/non-empty decision cannot be a
            // one-shot read here. The ResizeObserver below then sees the bar go 0 → 48
            // and the undershoot classes follow on their own.
            bindEmptySections(this._topEl, this._bottomEl);

            this.replaceChildren(this._topEl, this._contentEl, this._bottomEl);
            // Its sibling: `bindEmptySections` keeps the bar's `hidden` flag honest once
            // a child is IN it, and this puts the child there. A late `slot="top"` bar
            // had both problems and only one of them was fixed.
            bindSlotAdoption(this, { top: this._topEl, bottom: this._bottomEl });
        }

        // `update_undershoots` runs from size_allocate, so the classes have to
        // follow the bars' real heights rather than a one-shot read.
        // Before `_syncClasses`, which hands it the two undershoot flags it gates on.
        this._shading = new AdwScrollShading(this._contentEl);
        this._shading.connect();

        this._resize = new ResizeObserver(() => this._syncClasses());
        this._resize.observe(this._topEl);
        this._resize.observe(this._bottomEl);
        this._syncClasses();
    }

    disconnectedCallback() {
        this._resize?.disconnect();
        this._resize = null;
        this._shading?.disconnect();
        this._shading = null;
    }

    attributeChangedCallback() {
        if (this._initialized) this._syncClasses();
    }

    private _syncClasses(): void {
        const { view, topBar, bottomBar } = toolbarViewClasses({
            topBarStyle: parseToolbarStyle(this.getAttribute('top-bar-style')),
            bottomBarStyle: parseToolbarStyle(this.getAttribute('bottom-bar-style')),
            extendContentToTopEdge: this.hasAttribute('extend-content-to-top-edge'),
            extendContentToBottomEdge: this.hasAttribute('extend-content-to-bottom-edge'),
            topBarHeight: this._topEl.offsetHeight,
            bottomBarHeight: this._bottomEl.offsetHeight,
        });

        for (const cls of ADW_TOOLBAR_VIEW_CLASSES) this.classList.toggle(cls, view.includes(cls));
        for (const cls of ADW_TOOLBAR_BAR_CLASSES) {
            this._topEl.classList.toggle(cls, topBar.includes(cls));
            this._bottomEl.classList.toggle(cls, bottomBar.includes(cls));
        }

        // The same two flags reach the scrollers, where the shade is actually
        // drawn — a raised bar brings its own shadow and must not get a second one.
        this._shading?.setUndershootEdges({
            top: view.includes('undershoot-top'),
            bottom: view.includes('undershoot-bottom'),
        });
    }
}

customElements.define('adw-toolbar-view', AdwToolbarView);
