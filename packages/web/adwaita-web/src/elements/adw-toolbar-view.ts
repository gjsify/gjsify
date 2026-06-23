// <adw-toolbar-view> — A content area framed by flat top and/or bottom bars
// (typically header bars). Mirrors Adw.ToolbarView.
// Slots: slot="top" (top bars, stacked), slot="bottom" (bottom bars), and any
//   remaining children become the scrollable content.
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/toolbarview.md
// Reference: refs/libadwaita/src/stylesheet/widgets/_toolbars.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class AdwToolbarView extends HTMLElement {
    private _topEl!: HTMLDivElement;
    private _contentEl!: HTMLDivElement;
    private _bottomEl!: HTMLDivElement;
    private _initialized = false;

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
        if (this._initialized) return;
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

        this._topEl.hidden = this._topEl.childElementCount === 0;
        this._bottomEl.hidden = this._bottomEl.childElementCount === 0;

        this.replaceChildren(this._topEl, this._contentEl, this._bottomEl);
    }
}

customElements.define('adw-toolbar-view', AdwToolbarView);
