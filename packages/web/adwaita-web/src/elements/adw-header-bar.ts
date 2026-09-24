// <adw-header-bar> — Adwaita header bar with centered title and start/end button slots.
//
// The derived centre is an `<adw-window-title>`. That is a DIVERGENCE, and the comment
// here used to claim the opposite — that `Adw.HeaderBar` puts one there. Measured
// against the source: `construct_title_label` (adw-header-bar.c:512) builds a plain
// `gtk_label_new (NULL)` with the `title` class, `single-line-mode` and
// `ellipsize=END`, and `Adw.HeaderBar` has NO `title` property at all — `update_title`
// (:475) resolves one from the navigation page, then the dialog, then the root window,
// then `g_get_application_name`, then `g_get_prgname`. An app that wants a subtitle
// there sets an `AdwWindowTitle` as its title-widget.
//
// The divergence is kept: a declarative surface wants `title=` / `subtitle=` attributes
// rather than a widget handoff, and both renderers already use them. It is recorded as
// `HeaderBarRenderState.derivedSubtitle` in `@gjsify/adwaita-core`, so it is a named
// difference instead of a mistaken claim of fidelity.
//
// It used to be a bare span with
// `textContent = title ?? ''`, and that span carried none of the three rules the
// window title already held in `@gjsify/adwaita-core`: an EMPTY title still
// reserved a blank line, re-setting the same value repainted, and there was no
// subtitle at all. So a header bar could not show what its own NativeScript twin
// could, and the fix is delegation rather than a fourth copy of the derivation.
//
// CORE-VIA: ./adw-window-title.js — the derived centre IS that element, so the three rules run in its WindowTitleState.
//
// Reference: refs/libadwaita/src/adw-header-bar.c
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web.

import { bindSlottedChildren } from '../slotted-children.js';

// Registers <adw-window-title>: the derived centre is one, so importing the bar
// alone must still define it.
import './adw-window-title.js';

export class AdwHeaderBar extends HTMLElement {
    private _initialized = false;
    private _startEl: HTMLDivElement | null = null;
    private _centerEl: HTMLDivElement | null = null;
    private _endEl: HTMLDivElement | null = null;
    /**
     * The derived `<adw-window-title>`, or `null` when a `slot="center"`
     * title-widget took the centre. `Adw.HeaderBar` has the same either/or —
     * `adw_header_bar_set_title_widget` empties the centre bin before installing
     * (adw-header-bar.c:1201) — over a derived `GtkLabel`, not an `AdwWindowTitle`;
     * see the divergence at the top of this file.
     */
    private _titleEl: HTMLElement | null = null;
    /**
     * The `<adw-navigation-page>` this bar sits in, and the observer that follows its
     * title. `update_title` (adw-header-bar.c:488) asks that page FIRST, which is how a
     * bare `Adw.HeaderBar {}` in a `.blp` page shows "Mailboxes" with no title of its own.
     */
    private _page: Element | null = null;
    private _pageObserver: MutationObserver | null = null;

    static get observedAttributes() {
        return ['title', 'subtitle'];
    }

    /** The start (left) section container — append buttons/widgets here. */
    get startSection(): HTMLDivElement | null {
        return this._startEl;
    }

    /** The center (title) section — holds the `title` text or any `slot="center"`
     * widget (the equivalent of Adw.HeaderBar's title-widget, e.g. a URL entry). */
    get centerSection(): HTMLDivElement | null {
        return this._centerEl;
    }

    /** The end (right) section container — append buttons/widgets here. */
    get endSection(): HTMLDivElement | null {
        return this._endEl;
    }

    connectedCallback() {
        if (this._initialized) {
            this._followPage();
            this._renderTitle();
            return;
        }
        this._initialized = true;

        this._startEl = document.createElement('div');
        this._startEl.className = 'adw-header-bar-start';

        this._centerEl = document.createElement('div');
        this._centerEl.className = 'adw-header-bar-center';

        this._endEl = document.createElement('div');
        this._endEl.className = 'adw-header-bar-end';

        // All three slots stay LIVE: a button appended with `slot="end"` after connect used
        // to sit outside the end section, and `adw-header-bar.spec.ts` carried the
        // workaround ("appended LAST") as a house rule. `src/slotted-children.ts` has the
        // incident. The `onAdopt` hook keeps the title-widget either/or true afterwards —
        // a centre widget that arrives late replaces the derived title, as setting
        // `Adw.HeaderBar:title-widget` at any point does.
        bindSlottedChildren(
            this,
            [
                { name: 'start', into: this._startEl },
                { name: 'center', into: this._centerEl },
                // The SAME destination under the name GTK writes it at. This section has
                // always documented itself as "the equivalent of Adw.HeaderBar's
                // title-widget"; a tree authored at the property position (a Blueprint
                // `title-widget: …`) carried exactly that name, found no destination for it
                // and stayed a stray sibling — after which this element derived its own
                // title into the centre, so the authored one was gone from the document.
                // `center` stays because it is what this package published and what the
                // gallery's own fences are written in.
                { name: 'title-widget', into: this._centerEl },
                { name: 'end', into: this._endEl },
            ],
            (_node, slot) => {
                if ('into' in slot && slot.into === this._centerEl) this._dropDerivedTitle();
            },
        ).install(this._startEl, this._centerEl, this._endEl);

        // Derived only when the centre is still free — the same either/or as
        // `Adw.HeaderBar`, which runs `construct_title_label` exactly while no
        // title-widget holds the centre (adw-header-bar.c:1211). What it builds there is
        // a `GtkLabel`; this is the documented `<adw-window-title>` divergence.
        if (this._centerEl.childElementCount === 0) {
            this._titleEl = document.createElement('adw-window-title');
            this._titleEl.className = 'adw-header-bar-title';
            this._centerEl.appendChild(this._titleEl);
        }
        this._followPage();
        this._renderTitle();
    }

    disconnectedCallback() {
        this._pageObserver?.disconnect();
        this._pageObserver = null;
        this._page = null;
    }

    /**
     * Find the enclosing navigation page and re-render when its title moves, as GTK does:
     * `root` looks the ancestor up (adw-header-bar.c:586) and a `notify::title` on it re-runs
     * `update_title`. Looked up on every connect, since a bar moved into another page has a
     * new ancestor, which is why C does it in `root` and drops it in `unroot`.
     */
    private _followPage() {
        this._page = this.closest('adw-navigation-page');
        if (this._page === null) return;
        this._pageObserver ??= new MutationObserver(() => this._renderTitle());
        this._pageObserver.observe(this._page, { attributes: true, attributeFilter: ['title'] });
    }

    /**
     * `title` used to be read ONCE, in `connectedCallback`, so every later write
     * was a silent no-op — a header bar whose title tracked the open document
     * kept whatever it was created with. `Adw.HeaderBar` never reads its title once
     * either: it has no `title` property at all, and re-runs `update_title`
     * (adw-header-bar.c:475) on every ancestor change that could move the answer.
     */
    attributeChangedCallback() {
        if (this._initialized) this._renderTitle();
    }

    /**
     * Give the centre up to a title-widget. `adw_header_bar_set_title_widget` empties the
     * centre bin and drops its derived label (adw-header-bar.c:1201, :1209) rather than
     * stacking the two, so the late case has to remove ours too — a bar showing both would
     * be a shape neither GTK nor the declared markup can produce.
     *
     * NOT SYMMETRIC HERE, AND KNOWN: C rebuilds the label the moment the title-widget goes
     * away (:1211); nothing in this element brings the derived centre back, so a bar that
     * gave it up has given it up for good. `HeaderBarState` in `@gjsify/adwaita-core` holds
     * the rebuild, and this element adopting it is the rewiring tracked in #1343.
     */
    private _dropDerivedTitle() {
        this._titleEl?.remove();
        this._titleEl = null;
    }

    private _renderTitle() {
        // A `slot="center"` widget replaced the derived title, so there is
        // nothing for the attribute to write to — the same either/or as
        // `Adw.HeaderBar:title-widget`.
        if (!this._titleEl) return;
        // Forwarded as ATTRIBUTES, so the window title's own change detection and
        // empty-string collapse do the work. Removing rather than writing `''`
        // keeps "unset" distinguishable from "set to empty" on the child.
        for (const name of ['title', 'subtitle']) {
            // The bar's own `title` is this port's declarative divergence (see the header) and
            // wins; without one, the page's title is the first answer `update_title` has.
            const value =
                this.getAttribute(name) ?? (name === 'title' ? (this._page?.getAttribute('title') ?? null) : null);
            if (value === null) this._titleEl.removeAttribute(name);
            else this._titleEl.setAttribute(name, value);
        }
    }
}

customElements.define('adw-header-bar', AdwHeaderBar);
