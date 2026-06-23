// <adw-expander-row> — A boxed-list row that discloses nested rows when expanded,
// with an optional enable switch. Mirrors Adw.ExpanderRow.
// Attributes: title, subtitle, expanded (boolean), enable-expansion (boolean),
//   show-enable-switch (boolean).
// Slots: any child <adw-*-row> is moved into the disclosed content listbox.
// Properties: expanded, enableExpansion (get/set, reflect to attributes).
// Events: notify::expanded (CustomEvent), notify::enable-expansion (CustomEvent)
//   — mirror Adw.ExpanderRow's GObject signal names so the same code path drives
//   both the web and GTK renderers.
// Reference: refs/adwaita-web/adwaita-web/scss/_expander_row.scss
// Reference: refs/libadwaita/src/stylesheet/widgets/_expander-row.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class AdwExpanderRow extends HTMLElement {
    private _headerEl!: HTMLDivElement;
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    private _enableSwitch!: HTMLInputElement;
    private _enableLabel!: HTMLLabelElement;
    private _chevronEl!: HTMLSpanElement;
    private _contentEl!: HTMLDivElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'subtitle', 'expanded', 'enable-expansion', 'show-enable-switch'];
    }

    get expanded(): boolean {
        return this.hasAttribute('expanded');
    }

    set expanded(value: boolean) {
        if (value) this.setAttribute('expanded', '');
        else this.removeAttribute('expanded');
    }

    get enableExpansion(): boolean {
        return !this.hasAttribute('enable-expansion') || this.getAttribute('enable-expansion') !== 'false';
    }

    set enableExpansion(value: boolean) {
        this.setAttribute('enable-expansion', value ? 'true' : 'false');
    }

    /** The disclosed content section — append nested rows here imperatively. */
    get contentSection(): HTMLDivElement {
        return this._contentEl;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Any pre-existing children are the nested rows to disclose.
        const rows = Array.from(this.childNodes);

        // Header row — looks like an action row: a text column, an optional
        // enable switch, and the disclosure chevron.
        this._headerEl = document.createElement('div');
        this._headerEl.className = 'adw-expander-row-header';

        const textEl = document.createElement('div');
        textEl.className = 'adw-row-text';
        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';
        this._subtitleEl = document.createElement('span');
        this._subtitleEl.className = 'adw-row-subtitle';
        textEl.append(this._titleEl, this._subtitleEl);

        // Optional enable switch (the same toggle Adw.ExpanderRow shows when
        // show-enable-switch is set). Clicking it does NOT toggle the disclosure.
        this._enableLabel = document.createElement('label');
        this._enableLabel.className = 'adw-switch adw-expander-row-enable-switch';
        this._enableSwitch = document.createElement('input');
        this._enableSwitch.type = 'checkbox';
        this._enableSwitch.checked = this.enableExpansion;
        const slider = document.createElement('span');
        slider.className = 'adw-switch-slider';
        this._enableLabel.append(this._enableSwitch, slider);

        this._chevronEl = document.createElement('span');
        this._chevronEl.className = 'adw-icon adw-icon--go-down adw-expander-row-chevron';

        this._headerEl.append(textEl, this._enableLabel, this._chevronEl);

        // Disclosed content — a nested listbox holding the rows.
        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-expander-row-content';
        for (const row of rows) this._contentEl.appendChild(row);

        this.replaceChildren(this._headerEl, this._contentEl);

        this._headerEl.addEventListener('click', (event) => {
            // Clicks on the enable switch toggle expansion-enable, not disclosure.
            if (this._enableLabel.contains(event.target as Node)) return;
            this.expanded = !this.expanded;
            this.dispatchEvent(
                new CustomEvent('notify::expanded', { bubbles: true, detail: { expanded: this.expanded } }),
            );
        });

        this._enableSwitch.addEventListener('change', () => {
            this.setAttribute('enable-expansion', this._enableSwitch.checked ? 'true' : 'false');
            this.dispatchEvent(
                new CustomEvent('notify::enable-expansion', {
                    bubbles: true,
                    detail: { enableExpansion: this._enableSwitch.checked },
                }),
            );
        });

        this._render();
    }

    attributeChangedCallback() {
        if (this._initialized) this._render();
    }

    private _render() {
        const title = this.getAttribute('title') ?? '';
        const subtitle = this.getAttribute('subtitle') ?? '';
        this._titleEl.textContent = title;
        this._subtitleEl.textContent = subtitle;
        this._subtitleEl.hidden = subtitle.length === 0;

        const showSwitch = this.hasAttribute('show-enable-switch');
        this._enableLabel.hidden = !showSwitch;
        this._enableSwitch.checked = this.enableExpansion;

        this.classList.toggle('expanded', this.expanded);
        this._contentEl.classList.toggle('expanded', this.expanded);
    }
}

customElements.define('adw-expander-row', AdwExpanderRow);
