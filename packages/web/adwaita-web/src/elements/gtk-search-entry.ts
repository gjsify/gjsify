// <gtk-search-entry> — a field for typing a query: a magnifying-glass leading while it is
// empty, a clear button trailing once it is not, and a signal that waits until the user
// STOPS typing.
//
// THE DELAY IS THE POINT, and it is a property: `search-delay` is 150 ms by default
// (gtksearchentry.c:539-542, and `gtk_search_entry_init` sets the same, :847) and
// `search-changed` fires once it has elapsed. C's `gtk_search_entry_changed` has one
// asymmetry that is easy to lose — going EMPTY fires IMMEDIATELY and cancels any pending
// timeout (:785-792), because an empty query is not a filter and waiting would make the
// results flash. Only a non-empty change is queued, and each keystroke REPLACES the queue
// (`reset_timeout`, :765-774).
//
// `Gtk.SearchEntry` is not a `Gtk.Entry` in C either (a sibling implementing `GtkEditable`),
// and it EXTENDS `<gtk-entry>` here for the same reason `<gtk-password-entry>` does: the
// browser has one `<input>` and `GtkEntry` owns it.
//
// KEYS: <kbd>Enter</kbd> is `activate`, <kbd>Escape</kbd> is `stop-search`,
// <kbd>Ctrl</kbd>+<kbd>g</kbd> is `next-match` and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>g</kbd>
// is `previous-match` — C's own default bindings (gtksearchentry.c:687-701). They are
// keybinding SIGNALS, so they are dispatched as events for a host to handle rather than
// acted on here.
//
// NOT PORTED: `key-capture-widget` (a `Gtk.Widget`, so a slot rather than an attribute, and
// only meaningful inside a `Gtk.SearchBar` this renderer has no concept of);
// `input-purpose` / `input-hints` / `activates-default` are in `KNOWN_GAPS`.
//
// A11Y: `Gtk.AccessibleRole.search_box` (gtksearchentry.c:704) is `role="searchbox"`.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_entries.scss:1-96 (entry.search)
// Reference: refs/gtk/gtk/gtksearchentry.c (properties, signals, bindings, changed, init)
// Copyright (c) GNOME contributors (libadwaita, GTK). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { createGtkImage, type GtkImage } from './gtk-image.js';

import { GtkEntry } from './gtk-entry.js';

/** `GtkSearchEntry:search-delay`'s default, in ms (gtksearchentry.c:539-542). */
const DEFAULT_SEARCH_DELAY = 150;

export class GtkSearchEntry extends GtkEntry {
    private _searchIcon!: GtkImage;
    private _clear!: HTMLButtonElement;
    private _clearIcon!: GtkImage;
    private _timeout: number | null = null;

    static get observedAttributes(): string[] {
        return [...GtkEntry.observedAttributes, 'search-delay'];
    }

    /** `GtkSearchEntry:search-delay` — ms from the last keypress to `search-changed`. */
    get searchDelay(): number {
        const declared = Number.parseInt(this.getAttribute('search-delay') ?? '', 10);
        return Number.isFinite(declared) && declared >= 0 ? declared : DEFAULT_SEARCH_DELAY;
    }

    set searchDelay(value: number) {
        this.setAttribute('search-delay', String(value));
    }

    /** Whether there is text, which is what decides the two icons. */
    private get _empty(): boolean {
        return this._input ? this._input.value === '' : this.getAttribute('value') === '';
    }

    override connectedCallback(): void {
        super.connectedCallback();

        // C's `gtk_search_entry_init` search icon: presentational, always leading.
        this._searchIcon = createGtkImage('system-search-symbolic', 'adw-search-entry-icon');

        // `gtk_icon_release` empties the field (gtksearchentry.c:747-752).
        this._clear = document.createElement('button');
        this._clear.type = 'button';
        this._clear.className = 'adw-button flat circular icon-only adw-search-entry-clear';
        this._clearIcon = createGtkImage('edit-clear-symbolic', 'adw-search-entry-clear-icon');
        this._clear.append(this._clearIcon);
        this._clear.title = 'Clear Entry';
        this._clear.setAttribute('aria-label', 'Clear Entry');
        this._clear.addEventListener('click', () => {
            this._input.value = '';
            this._onChanged();
            this._input.focus();
        });
        this._clear.addEventListener('mousedown', (event) => event.preventDefault());

        this.replaceChildren(this._searchIcon, this._input, this._clear);
        this.setAttribute('role', 'searchbox');

        this._input.addEventListener('input', () => this._onChanged());
        this._input.addEventListener('keydown', (event) => this._onKeyDown(event));
        this._render();
    }

    override attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void {
        super.attributeChangedCallback(name, oldValue, value);
        // A pending timeout belongs to the delay that is being replaced: C's setter only
        // notifies, and the NEXT change queues against the new one — but a timeout armed
        // under the old delay must not fire on the new one, so it is dropped here.
        if (name === 'search-delay' && this._clear) this._cancel();
    }

    override disconnectedCallback(): void {
        this._cancel();
        super.disconnectedCallback();
    }

    /**
     * `gtk_search_entry_changed` (gtksearchentry.c:776-803) over `reset_timeout`.
     *
     * Empty is immediate and cancels; non-empty replaces the queue. `clearTimeout` before
     * arming is `reset_timeout`'s `g_source_remove`, and without it two keystrokes would
     * fire the signal twice.
     */
    private _onChanged(): void {
        this._cancel();
        if (this._empty) {
            this._render();
            this.dispatchEvent(new CustomEvent('search-changed', { bubbles: true, detail: { value: '' } }));
            return;
        }
        this._render();
        const delay = this.searchDelay;
        // `g_timeout_add (0, …)` is an idle, not a no-op: it runs on the next iteration of
        // the main loop, which is one turn of the event loop and not "immediately".
        this._timeout = window.setTimeout(() => {
            this._timeout = null;
            this.dispatchEvent(
                new CustomEvent('search-changed', { bubbles: true, detail: { value: this._input.value } }),
            );
        }, delay);
    }

    private _cancel(): void {
        if (this._timeout === null) return;
        clearTimeout(this._timeout);
        this._timeout = null;
    }

    private _onKeyDown(event: KeyboardEvent): void {
        switch (event.key) {
            // `activate` is NOT handled here: `<gtk-entry>` already dispatches it on Enter,
            // and C binds the same `activate` SIGNAL the inner `Gtk.Text` raises
            // (activate_cb, gtksearchentry.c:816-821) — one signal, one dispatch.
            case 'Escape':
                event.preventDefault();
                this.dispatchEvent(new CustomEvent('stop-search', { bubbles: true }));
                break;
            case 'g':
                // C binds these on Apple to Meta and elsewhere to Control
                // (gtksearchentry.c:678-696); a browser reports neither as `ctrlKey` on
                // macOS, so both are accepted and the host decides which one it meant.
                if (!event.ctrlKey && !event.metaKey) return;
                event.preventDefault();
                this.dispatchEvent(
                    new CustomEvent(event.shiftKey ? 'previous-match' : 'next-match', { bubbles: true }),
                );
                break;
            default:
                return;
        }
    }

    private _render(): void {
        if (!this._clear) return;
        // C toggles the CLEAR icon's visibility on the text; the search icon is always
        // present and purely presentational.
        this._clear.hidden = this._empty;
    }
}

customElements.define('gtk-search-entry', GtkSearchEntry);
