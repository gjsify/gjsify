// <adw-tab-button> — the page COUNTER that stands in for a tab bar: a button showing
// how many pages an `Adw.TabView` holds and whether one of the hidden ones wants
// attention (adw-tab-button.c:19-33). libadwaita pairs it with an `AdwTabOverview`
// action, which is why `clicked` is the signal to listen to and `activate` is the one
// applications must not.
//
// THREE DERIVATIONS, all of them C and all of them small enough to read in the widget:
//
//   · `update_icon` (adw-tab-button.c:102-133): the LABEL is the page count while there
//     are fewer than 100 pages, `small` from ten, and at 100 the label goes away for the
//     overflow glyph. No view at all means the same counter plate with nothing on it.
//   · `update_needs_attention` (adw-tab-button.c:135-161): TRUE when any page that is NOT
//     the selected one has `needs-attention`. C walks the list and breaks on the first
//     hit, so this is a `some` and not a count.
//   · the template (adw-tab-button.ui): a `Gtk.Button` in the `.image-button` style
//     holding an `AdwIndicatorBin` over a `GtkOverlay` — the glyph UNDERNEATH, the count
//     on top.
//
// THE GLYPH IS THE PLATE, and that is what the CSS draws. `adw-tab-counter.svg` is a
// rounded rectangle and nothing else (a 14×14 `rx≈3` rect, `stroke-width: 2`, no fill),
// which is a border and a border-radius; `adw-tab-overflow.svg` is the same rectangle
// with one more decorative mark on it, drawn here as the ellipsis libadwaita puts
// between the two. Both are libadwaita-BUNDLED glyphs (refs/libadwaita/src/icons/), not
// theme names, so neither is in `@gjsify/adwaita-icons` and neither could be compiled
// into the stylesheet — the same case `adw-entry-row.ts`'s pencil is. Neither name is
// emitted through `<gtk-image>`, so neither reaches `check-adwaita-icon-masks.mjs`.
//
// `view` is a widget REFERENCE (`Adw.TabView`), which on this renderer is an element id
// the way `<adw-view-switcher-bar stack>` is one, and both are the same shape of
// divergence: `scripts/generate-adwaita-attribute-comments.mjs`'s `id-reference`
// ledger entry. The property setter takes the element directly for code.
//
// `action-name` / `action-target` are `GtkActionable`'s, forwarded to the inner button
// (adw-tab-button.c:344-386). A browser has no `Gio.Action` to activate, so they are not
// observed — an interface property, absent from `AdwTabButtonProps`' own body, which is
// why KNOWN_GAPS has no entry for them.
//
// A11Y: `role="button"` on the host, over a real `<button>`, so Enter and Space arrive
// through the platform rather than through a key handler of our own.
//
// KNOWN_GAPS: none — `AdwTabButton`'s own scalar surface is empty (`view` is a widget).
//
// Reference: refs/libadwaita/src/adw-tab-button.c (update_icon, update_needs_attention,
//   set_view's four signal connections, class_init's `tabbutton` node + BUTTON role)
// Reference: refs/libadwaita/src/adw-tab-button.ui (button → indicator → overlay)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss:647-663 (`tabbutton`)
// Reference: refs/libadwaita/src/icons/adw-tab-counter.svg, adw-tab-overflow.svg
// Copyright (c) 2019-2022 Alice Mikhaylenko / Purism SPC. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import type { AdwTabView } from './adw-tab-view.js';

/** `update_icon`: a label from ten pages up, because two digits do not fit the plate. */
const SMALL_LABEL_PAGES = 10;
/** `update_icon`: at a hundred pages the count is replaced by the overflow glyph. */
const OVERFLOW_PAGES = 100;
/** What `set_view` connects to: the page list, the selection and each page's attention. */
const VIEW_EVENTS = ['page-attached', 'page-detached', 'page-updated', 'notify::selected-page'] as const;

export class AdwTabButton extends HTMLElement {
    private _button!: HTMLButtonElement;
    private _binEl!: HTMLSpanElement;
    private _labelEl!: HTMLSpanElement;
    private _indicatorEl!: HTMLSpanElement;
    private _view: AdwTabView | null = null;
    private _initialized = false;

    static get observedAttributes() {
        return ['view'];
    }

    /** `Adw.TabButton:view` — the tab view this button counts. */
    get view(): AdwTabView | null {
        return this._view;
    }

    set view(value: AdwTabView | string | null) {
        this.setView(value === null ? null : typeof value === 'string' ? this._resolveView(value) : value);
    }

    /** `adw_tab_button_set_view`: rebind, then re-derive the icon and the indicator. */
    setView(view: AdwTabView | null): void {
        if (this._view === view) return;
        this._unbindView();
        this._view = view;
        this._bindView();
        this._render();
        this.dispatchEvent(new CustomEvent('notify::view', { bubbles: true, detail: { view } }));
    }

    connectedCallback() {
        if (this._initialized) {
            // Re-entering a document: `disconnectedCallback` dropped the listeners, so a
            // button that was merely MOVED has to get them back here or it stops noticing
            // pages.
            this._bindView();
            this._render();
            return;
        }
        this._initialized = true;

        this._button = document.createElement('button');
        this._button.type = 'button';
        this._button.className = 'adw-button image-button';
        this._button.title = 'View Open Tabs';

        // adw-tab-button.ui, node for node: a button holding an `AdwIndicatorBin`, whose
        // child is a `GtkOverlay` — the glyph UNDERNEATH and the count ON TOP — with the
        // bin's own indicator beside it.
        this._binEl = document.createElement('span');
        this._binEl.className = 'adw-tab-button-indicatorbin';

        const plate = document.createElement('span');
        plate.className = 'adw-tab-button-plate';

        this._labelEl = document.createElement('span');
        this._labelEl.className = 'adw-tab-button-label numeric';

        this._indicatorEl = document.createElement('span');
        this._indicatorEl.className = 'adw-tab-button-indicator';

        this._binEl.append(plate, this._labelEl);
        this._button.append(this._binEl, this._indicatorEl);
        this.replaceChildren(this._button);
        this.setAttribute('role', 'button');

        // `clicked_cb`: the inner button's `clicked`, re-emitted as this widget's own
        // signal. The DOM's click already bubbles, so a listener on the host sees it;
        // dispatching it again would double-fire one press.
        const ref = this.getAttribute('view');
        this.setView(ref === null ? null : this._resolveView(ref));
        this._bindView();
        this._render();
    }

    disconnectedCallback() {
        this._unbindView();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized || name !== 'view') return;
        this.setView(value === null ? null : this._resolveView(value));
    }

    private _resolveView(ref: string): AdwTabView | null {
        // Resolved NOW, because the view is normally earlier in the document (content
        // above the chrome), which is the same reason `<adw-view-switcher-bar>` resolves
        // its `stack` on connect rather than on the first attribute write.
        return (document.getElementById(ref) as AdwTabView | null) ?? null;
    }

    private _onViewChange = (): void => this._render();

    /**
     * `set_view`'s four connections (adw-tab-button.c:`set_view`), as the view's own events.
     *
     * `notify::n-pages`, `page-attached` and `page-detached` all arrive as `page-attached`
     * / `page-detached`; `notify::selected-page` is itself; and what C reads off each PAGE
     * (`notify::needs-attention`) reaches the view as `page-updated`, whichever page it
     * is on and whether an attribute or `setPageNeedsAttention` changed it.
     */
    private _bindView(): void {
        this._unbindView();
        for (const type of VIEW_EVENTS) this._view?.addEventListener(type, this._onViewChange);
    }

    private _unbindView(): void {
        for (const type of VIEW_EVENTS) this._view?.removeEventListener(type, this._onViewChange);
    }

    /** `update_icon` and `update_needs_attention`, in that order. */
    private _render(): void {
        const view = this._view;
        const nPages = view?.nPages ?? 0;
        const displayLabel = nPages < OVERFLOW_PAGES;

        this._labelEl.textContent = displayLabel ? String(nPages) : '';
        this._labelEl.hidden = !displayLabel;
        // `small_label = n_pages >= 10` — the label's own class, and the stylesheet
        // takes `font-size: 8px` off it against 10.5px without it.
        this._labelEl.classList.toggle('small', nPages >= SMALL_LABEL_PAGES);
        // The overflow glyph replaces the label, so the bin is what carries which of the
        // two the plate is drawing.
        this._binEl.classList.toggle('overflow', !displayLabel);

        const selectedId = view?.selectedId ?? null;
        const needsAttention = view?.pages.some((page) => page.needsAttention && page.id !== selectedId) ?? false;
        this._indicatorEl.classList.toggle('needs-attention', needsAttention);
        this._indicatorEl.hidden = !needsAttention;
        this._button.setAttribute('aria-label', `View Open Tabs (${nPages})`);
    }
}

customElements.define('adw-tab-button', AdwTabButton);
