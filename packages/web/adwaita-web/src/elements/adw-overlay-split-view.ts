// <adw-overlay-split-view> — Responsive sidebar that docks or overlays content.
// Reference: Adw.OverlaySplitView from libadwaita.
// Docs: refs/adwaita-web/adwaita-web/docs/widgets/overlaysplitview.md

export class AdwOverlaySplitView extends HTMLElement {
    private _initialized = false;
    private _sidebarEl!: HTMLDivElement;
    private _contentEl!: HTMLDivElement;
    private _backdropEl!: HTMLDivElement;

    static get observedAttributes() {
        return ['show-sidebar', 'collapsed', 'sidebar-position', 'min-sidebar-width', 'max-sidebar-width', 'sidebar-width-fraction'];
    }

    get showSidebar(): boolean {
        return this.hasAttribute('show-sidebar');
    }

    set showSidebar(v: boolean) {
        if (v) this.setAttribute('show-sidebar', '');
        else this.removeAttribute('show-sidebar');
    }

    get collapsed(): boolean {
        return this.hasAttribute('collapsed');
    }

    set collapsed(v: boolean) {
        if (v) this.setAttribute('collapsed', '');
        else this.removeAttribute('collapsed');
    }

    get minSidebarWidth(): number {
        return parseFloat(this.getAttribute('min-sidebar-width') || '280');
    }

    get maxSidebarWidth(): number {
        return parseFloat(this.getAttribute('max-sidebar-width') || '400');
    }

    get sidebarWidthFraction(): number {
        return parseFloat(this.getAttribute('sidebar-width-fraction') || '0.30');
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Capture slotted children before rebuilding DOM
        const sidebarChildren = Array.from(this.querySelectorAll('[slot="sidebar"]'));
        const contentChildren = Array.from(this.querySelectorAll('[slot="content"]'));
        // Any remaining unslotted children go to content
        const unslotted = Array.from(this.childNodes).filter(
            n => !sidebarChildren.includes(n as Element) && !contentChildren.includes(n as Element),
        );

        // Clear children safely
        this.replaceChildren();

        // Sidebar container
        this._sidebarEl = document.createElement('div');
        this._sidebarEl.className = 'adw-osv-sidebar';
        sidebarChildren.forEach(c => this._sidebarEl.appendChild(c));

        // Content container
        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-osv-content';
        contentChildren.forEach(c => this._contentEl.appendChild(c));
        unslotted.forEach(c => this._contentEl.appendChild(c));

        // Backdrop for overlay dismiss
        this._backdropEl = document.createElement('div');
        this._backdropEl.className = 'adw-osv-backdrop';
        this._backdropEl.addEventListener('click', () => this.hideSidebar());

        this.append(this._sidebarEl, this._contentEl, this._backdropEl);

        // Apply initial state
        this._syncClasses();
        this._syncSidebarWidth();
    }

    attributeChangedCallback(_name: string, _old: string | null, _val: string | null) {
        if (!this._initialized) return;
        this._syncClasses();
        if (_name === 'min-sidebar-width' || _name === 'max-sidebar-width' || _name === 'sidebar-width-fraction') {
            this._syncSidebarWidth();
        }
    }

    openSidebar() {
        this.showSidebar = true;
        this.dispatchEvent(new CustomEvent('sidebar-toggled', { detail: { isVisible: true } }));
    }

    hideSidebar() {
        this.showSidebar = false;
        this.dispatchEvent(new CustomEvent('sidebar-toggled', { detail: { isVisible: false } }));
    }

    toggleSidebar() {
        this.showSidebar = !this.showSidebar;
        this.dispatchEvent(new CustomEvent('sidebar-toggled', {
            detail: { isVisible: this.showSidebar },
        }));
    }

    private _syncClasses() {
        this.classList.toggle('collapsed', this.collapsed);
        this.classList.toggle('show-sidebar', this.showSidebar);
        const pos = this.getAttribute('sidebar-position') || 'start';
        this.classList.toggle('sidebar-start', pos === 'start');
        this.classList.toggle('sidebar-end', pos === 'end');

        // In docked mode, use negative margin to collapse sidebar space
        // while keeping the sidebar's intrinsic width (slide animation).
        if (this._sidebarEl && !this.collapsed) {
            if (!this.showSidebar) {
                const w = this._sidebarEl.offsetWidth;
                this._sidebarEl.style.marginRight = `-${w}px`;
            } else {
                this._sidebarEl.style.marginRight = '';
            }
        }
    }

    private _syncSidebarWidth() {
        if (!this._sidebarEl) return;
        this._sidebarEl.style.minWidth = `${this.minSidebarWidth}px`;
        this._sidebarEl.style.maxWidth = `${this.maxSidebarWidth}px`;
        this._sidebarEl.style.width = `${this.sidebarWidthFraction * 100}%`;
    }
}

customElements.define('adw-overlay-split-view', AdwOverlaySplitView);
