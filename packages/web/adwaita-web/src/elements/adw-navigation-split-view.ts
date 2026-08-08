// <adw-navigation-split-view> — A docked sidebar beside content. Both panes are
// visible when expanded; when `collapsed` it shows one pane at a time
// (`show-content` decides which), mirroring Adw.NavigationSplitView's
// push-navigation on narrow widths.
// Attributes: collapsed, show-content, min-sidebar-width, max-sidebar-width,
//   breakpoint (an Adwaita condition, e.g. "max-width: 720px", that collapses
//   the view by itself — the counterpart to an Adw.Breakpoint add_setter()).
// Slots: slot="sidebar", slot="content".
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/navigationsplitview.md
// Reference: refs/libadwaita/src/stylesheet/widgets/_sidebars.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { bindBreakpointSetter } from '../breakpoints.js';

export class AdwNavigationSplitView extends HTMLElement {
    private _sidebarEl!: HTMLDivElement;
    private _contentEl!: HTMLDivElement;
    private _initialized = false;
    private _disposeBreakpoint: (() => void) | undefined;

    static get observedAttributes() {
        return ['collapsed', 'show-content', 'min-sidebar-width', 'max-sidebar-width', 'breakpoint'];
    }

    get collapsed(): boolean {
        return this.hasAttribute('collapsed');
    }

    set collapsed(v: boolean) {
        this.toggleAttribute('collapsed', v);
    }

    /** When collapsed, whether the content pane (true) or sidebar (false) shows. */
    get showContent(): boolean {
        return this.hasAttribute('show-content');
    }

    set showContent(v: boolean) {
        this.toggleAttribute('show-content', v);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        const sidebarChildren = Array.from(this.querySelectorAll(':scope > [slot="sidebar"]'));
        const contentChildren = Array.from(this.querySelectorAll(':scope > [slot="content"]'));

        this._sidebarEl = document.createElement('div');
        this._sidebarEl.className = 'adw-nsv-sidebar';
        for (const child of sidebarChildren) this._sidebarEl.appendChild(child);

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-nsv-content';
        for (const child of contentChildren) this._contentEl.appendChild(child);

        this.replaceChildren(this._sidebarEl, this._contentEl);
        this._syncWidth();
        this._syncClasses();
        this._syncBreakpoint();
    }

    disconnectedCallback() {
        this._disposeBreakpoint?.();
        this._disposeBreakpoint = undefined;
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'breakpoint') this._syncBreakpoint();
        else if (name === 'min-sidebar-width' || name === 'max-sidebar-width') this._syncWidth();
        else {
            this._syncClasses();
            // Collapsing flips whether the sidebar is width-capped, so re-apply.
            this._syncWidth();
        }
    }

    private _syncWidth() {
        // When collapsed the visible pane fills the whole view, so the sidebar's
        // min/max width caps must not apply (an inline cap would otherwise win
        // over any stylesheet rule and leave a dead strip beside the pane).
        if (this.collapsed) {
            this._sidebarEl.style.minWidth = '';
            this._sidebarEl.style.maxWidth = '';
            return;
        }
        const min = this.getAttribute('min-sidebar-width');
        const max = this.getAttribute('max-sidebar-width');
        this._sidebarEl.style.minWidth = min ? `${parseFloat(min)}px` : '';
        this._sidebarEl.style.maxWidth = max ? `${parseFloat(max)}px` : '';
    }

    private _syncClasses() {
        this.classList.toggle('collapsed', this.collapsed);
        this.classList.toggle('show-content', this.showContent);
    }

    /** (Re)bind the `breakpoint` condition to `collapsed`. */
    private _syncBreakpoint() {
        this._disposeBreakpoint?.();
        this._disposeBreakpoint = bindBreakpointSetter(this, this.getAttribute('breakpoint'), (active) => {
            this.collapsed = active;
        });
    }
}

customElements.define('adw-navigation-split-view', AdwNavigationSplitView);
