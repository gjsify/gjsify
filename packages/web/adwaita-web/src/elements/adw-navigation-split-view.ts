// <adw-navigation-split-view> — A docked sidebar beside content. Both panes are
// visible when expanded; when `collapsed` it shows one pane at a time
// (`show-content` decides which), mirroring Adw.NavigationSplitView's
// push-navigation on narrow widths.
// Attributes: collapsed, show-content, min-sidebar-width, max-sidebar-width.
// Slots: slot="sidebar", slot="content".
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/navigationsplitview.md
// Reference: refs/libadwaita/src/stylesheet/widgets/_sidebars.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class AdwNavigationSplitView extends HTMLElement {
    private _sidebarEl!: HTMLDivElement;
    private _contentEl!: HTMLDivElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['collapsed', 'show-content', 'min-sidebar-width', 'max-sidebar-width'];
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
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'min-sidebar-width' || name === 'max-sidebar-width') this._syncWidth();
        else this._syncClasses();
    }

    private _syncWidth() {
        const min = this.getAttribute('min-sidebar-width');
        const max = this.getAttribute('max-sidebar-width');
        if (min) this._sidebarEl.style.minWidth = `${parseFloat(min)}px`;
        if (max) this._sidebarEl.style.maxWidth = `${parseFloat(max)}px`;
    }

    private _syncClasses() {
        this.classList.toggle('collapsed', this.collapsed);
        this.classList.toggle('show-content', this.showContent);
    }
}

customElements.define('adw-navigation-split-view', AdwNavigationSplitView);
