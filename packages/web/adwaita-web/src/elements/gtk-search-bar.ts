// <gtk-search-bar> — `Gtk.SearchBar`, the strip that reveals a search entry when search starts.
//
// IT IS A REVEALER, AND THE PROPERTY IS THE REVEALER'S. `GtkSearchBar` is
// `searchbar > revealer > box > { child, button.close }` (gtksearchbar.c:66-81,368-390), and
// `search-mode-enabled` IS `reveal-child` on that revealer (gtksearchbar.c:512-517,183-205)
// — the C's own getter reads the revealer, not a flag. So one attribute decides both whether
// the strip is shown and whether the search is on, which is what makes the element's state
// a single boolean.
//
// WHAT TURNS IT ON, all four from the C: `search-mode-enabled` set by the application
// (:512-517), typing into the connected editable (`input-intercepted`, :210-218), Escape on
// a search entry (`stop-search`, :174-177) and the close button (:207-209). TWO things turn
// it off, and the second is the C's own rule: hiding clears the entry's text
// (`reveal_child_changed_cb`, :183-205), so a search that is dismissed leaves nothing behind.
//
// THE ENTRY IS THE CHILD, AND THE C IS EXPLICIT ABOUT WHICH KINDS. `connect_entry` takes any
// `GtkEditable`, and `reveal_child_changed_cb` branches three ways: a `GtkEntry` is focused
// without selecting, a `GtkSearchEntry` is focused outright, and anything else is only
// cleared. A `searchbar` element therefore takes an ordinary editable child — a
// `<gtk-search-entry>` when the port has one, a `<gtk-entry>` today — and focuses it.
//
// `key-capture-widget` is a WIDGET, so it is not an attribute: `keyCaptureWidget` is a
// property, and the element listens on that element in the CAPTURE phase, which is the one
// door GTK opens too ("the events are only 'captured' in the bubble phase",
// gtksearchbar.c:525-540). A printable key then goes into the entry, which is what the C's
// forward does ("the bar will be shown, and the entry populated with the entered text").
//
// A11y: `Gtk.SearchBar` uses `AccessibleRole.search` (gtksearchbar.c:390), so the host says
// so. A collapsed strip is `inert`, which is the CSS-shaped form of GTK not mapping the
// revealer's child at all (:368-390) — without it the entry would stay in the tab order of a
// bar nobody can see.
//
// Reference: refs/gtk/gtk/gtksearchbar.c:66-81 (the node tree and the role), 174-218 (the
//   four ways search starts and the two it stops), 237-390 (the pspecs, the revealer, the
//   close button), 512-556 (search mode, close button, key capture)
// Reference: refs/libadwaita/src/stylesheet/widgets/_toolbars.scss:113-185 (searchbar)
// Copyright (c) The GTK Team, GNOME contributors. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class GtkSearchBar extends HTMLElement {
    private _box!: HTMLDivElement;
    private _center!: HTMLDivElement;
    private _close!: HTMLButtonElement;
    private _initialized = false;
    private _capture: HTMLElement | null = null;
    private readonly _onCapturedKey = (event: KeyboardEvent): void => this._captureKey(event);
    private readonly _onInput = (): void => this._revealFromTyping();

    static get observedAttributes() {
        return ['search-mode-enabled', 'show-close-button'];
    }

    /** `Gtk.SearchBar:search-mode-enabled` — the revealer's `reveal-child`. Defaults FALSE. */
    get searchModeEnabled(): boolean {
        return this.hasAttribute('search-mode-enabled');
    }

    set searchModeEnabled(value: boolean) {
        this.toggleAttribute('search-mode-enabled', !!value);
    }

    /** `Gtk.SearchBar:show-close-button` — the `.close` button at the end of the box. */
    get showCloseButton(): boolean {
        return this.hasAttribute('show-close-button');
    }

    set showCloseButton(value: boolean) {
        this.toggleAttribute('show-close-button', !!value);
    }

    /** `Gtk.SearchBar:key-capture-widget` — where printable keys start a search. */
    get keyCaptureWidget(): HTMLElement | null {
        return this._capture;
    }

    set keyCaptureWidget(widget: HTMLElement | null) {
        if (this._capture === widget) return;
        this._capture?.removeEventListener('keydown', this._onCapturedKey, true);
        this._capture = widget;
        this._capture?.addEventListener('keydown', this._onCapturedKey, true);
    }

    /** The editable the C's `connect_entry` would have bound: the first field inside the bar. */
    get entry(): HTMLInputElement | HTMLTextAreaElement | null {
        return this.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this.setAttribute('role', 'search');

        this._center = document.createElement('div');
        this._center.className = 'adw-search-bar-center';
        // Whatever the author put inside the bar is the child, moved into the box's centre —
        // the `GtkCenterBox` the C builds around it (gtksearchbar.c:378-386).
        this._center.append(...this.childNodes);

        this._close = document.createElement('button');
        this._close.className = 'adw-search-bar-close';
        this._close.type = 'button';
        this._close.setAttribute('aria-label', 'Close search');
        this._close.addEventListener('click', () => (this.searchModeEnabled = false));

        this._box = document.createElement('div');
        this._box.className = 'adw-search-bar-box';
        this._box.append(this._center, this._close);
        this.replaceChildren(this._box);

        // `input-intercepted`: typing into the connected editable reveals the bar
        // (gtksearchbar.c:210-218). Captured, because the editable may be nested two
        // elements deep — a `<gtk-entry>` keeps its own `<input>`.
        this.addEventListener('input', this._onInput);
        this.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') this.searchModeEnabled = false;
        });

        this._render();
    }

    disconnectedCallback() {
        this.keyCaptureWidget = null;
    }

    attributeChangedCallback(name: string, _old: string | null, _value: string | null) {
        if (!this._initialized) return;
        if (name === 'search-mode-enabled') {
            this._applyReveal();
            this.dispatchEvent(
                new CustomEvent('notify::search-mode-enabled', {
                    bubbles: true,
                    detail: { searchModeEnabled: this.searchModeEnabled },
                }),
            );
            return;
        }
        if (name === 'show-close-button') {
            // The C notifies only when the button's visibility ACTUALLY changed
            // (gtksearchbar.c:526-530), and `toggleAttribute` is idempotent, so an unchanged
            // value never reaches here.
            this._render();
            this.dispatchEvent(
                new CustomEvent('notify::show-close-button', {
                    bubbles: true,
                    detail: { showCloseButton: this.showCloseButton },
                }),
            );
        }
    }

    private _render(): void {
        const revealed = this.searchModeEnabled;
        this.classList.toggle('revealed', revealed);
        // A collapsed revealer's child is not mapped in GTK, so it is not focusable there
        // either; `inert` is what says that without taking the strip out of the layout.
        this._box.inert = !revealed;
        this._close.hidden = !this.showCloseButton;
    }

    /**
     * `reveal_child_changed_cb` (gtksearchbar.c:183-205): revealing focuses the entry,
     * hiding clears it. Run on a real CHANGE only — at init the C's own notify fires before
     * the handler is connected, so a child that arrives with the bar is left alone.
     */
    private _applyReveal(): void {
        this._render();
        const entry = this.entry;
        if (entry === null) return;
        if (this.searchModeEnabled) entry.focus();
        else entry.value = '';
    }

    private _revealFromTyping(): void {
        if (this.searchModeEnabled) return;
        this.searchModeEnabled = true;
        this.entry?.focus();
    }

    /**
     * The key-capture path (gtksearchbar.c:525-556): a printable key on the capture widget
     * opens the bar and goes into the entry, which is what forwarding the event does in the C.
     * Modified keys and the functional keys are left alone — GTK forwards them, but a bar
     * that opened on every arrow key would not be a search bar.
     */
    private _captureKey(event: KeyboardEvent): void {
        if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.key.length !== 1) return;
        const entry = this.entry;
        this.searchModeEnabled = true;
        if (entry === null) return;
        event.preventDefault();
        entry.focus();
        const start = entry.selectionStart ?? entry.value.length;
        const end = entry.selectionEnd ?? start;
        entry.setRangeText(event.key, start, end, 'end');
    }
}

customElements.define('gtk-search-bar', GtkSearchBar);
