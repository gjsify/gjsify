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

import { DEFAULT_MAX_SIDEBAR_WIDTH, DEFAULT_MIN_SIDEBAR_WIDTH, resolveSidebarBounds } from '@gjsify/adwaita-core';

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
        // An ABSENT attribute used to mean "no bound at all", where
        // Adw.NavigationSplitView always has 180 / 280
        // (adw-navigation-split-view.c min-sidebar-width / max-sidebar-width).
        // The core also normalises the pair — libadwaita never lets max fall
        // below min, and CSS resolves that conflict the other way round.
        const bounds = resolveSidebarBounds(
            {
                minSidebarWidth: this._widthAttr('min-sidebar-width', DEFAULT_MIN_SIDEBAR_WIDTH),
                maxSidebarWidth: this._widthAttr('max-sidebar-width', DEFAULT_MAX_SIDEBAR_WIDTH),
            },
            0,
            { ceil: true },
        );
        this._sidebarEl.style.minWidth = `${bounds.min}px`;
        this._sidebarEl.style.maxWidth = `${bounds.max}px`;
    }

    /** A pixel attribute, falling back to the widget's own default. */
    private _widthAttr(name: string, fallback: number): number {
        const raw = this.getAttribute(name);
        if (raw === null) return fallback;
        const value = parseFloat(raw);
        return Number.isFinite(value) ? value : fallback;
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
