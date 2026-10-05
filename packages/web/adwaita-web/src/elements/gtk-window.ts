// <gtk-window> — a window, IN PAGE. This is a FRAME, not a toplevel: a rounded, shadowed box
// with a titlebar strip at the top, the window's content below it, and the same window
// properties `<gtk-window-controls>` reads to decide which frame buttons to draw.
//
// SAYING THAT PLAINLY, because the element's name promises something the page cannot be. A
// browser document has no `GtkWindow`, no `GdkToplevel`, no window manager and no place to
// map one; what a page can draw is the DECORATION of a window and honour the properties that
// decide what that decoration shows. So: no `move()`, no `resize()`, no real `is-active`, and
// a close button that hides or detaches a box rather than a surface the compositor owns.
// Everything else below is ported from `gtkwindow.c`.
//
// THE TREE. `Gtk.Window` is a `GtkBin` with a `child` and, since 4.6, a `titlebar`
// (gtkwindow.c:1128, :1138), and libadwaita paints `window { &.csd { … } }` around it
// (refs/libadwaita/src/stylesheet/widgets/_window.scss:1-31). This element therefore builds
//
//   <gtk-window>
//     ├── div.adw-gtk-window-titlebar   — the `titlebar`, or the server-side decoration
//     │                                 a `Gtk.Window` without one would get from the WM
//     └── div.adw-gtk-window-content    — everything else, in document order
//
// and `decorated="false"` drops the first, which is what `gtk_window_set_decorated` means
// (:1014). A `titlebar` SLOT is how the property is written in markup; with none, the strip
// holds the two `<gtk-window-controls>` and the window's own title — GTK's SSD shape, which
// is exactly the thing a page has to draw for itself.
//
// WHAT THE FRAME PROPERTIES DO, EACH AT ITS OWN SOURCE LINE:
//   `title`          — read by a header bar's `update_title` (gtkheaderbar.c:250-271) and
//                      written into the strip's title when there is no titlebar (:873).
//   `deletable`      — no close button when false (:1024); `gtk_window_close` (:1274).
//   `resizable`      — no maximize button when false (:893).
//   `maximized`      — the restore glyph instead of the maximize one, and the square-cornered
//                      `&.maximized` frame libadwaita draws (_window.scss:66-72, :1044).
//   `fullscreened`   — the same square corners from the other side (_window.scss:67, :1060).
//   `modal` / `transient-for` — the sovereignty test: neither means the window owns an icon
//                      and a minimize button (gtkwindowcontrols.c:272-273, :299, :318).
//   `icon-name`      — the icon at the head of the start controls (:982).
//   `hide-on-close`  — the two branches of the close button's default handler (:945,
//                      `gtk_window_close` :1274-1287): hide, or destroy. `close-request` is
//                      emitted first and is CANCELLED by a handler that takes over (:1200-1224).
//   `default-width` / `default-height` — the size a window opens at (:913-930).
//
// THE CLOSE BUTTON. GTK's window controls activate the `window.close` action, which
// `Gtk.Window` answers with `gtk_window_close` (:1274-1287): emit `close-request`, and if
// nothing handled it, HIDE the window when `hide-on-close` is set and DESTROY it otherwise.
// That is the whole of the default, and it is what this element does — except that "destroy"
// detaches the frame from the page rather than unref'ing a toplevel, which is the one
// difference a reader of the DOM can see.
//
// NOT PORTED, and why — these are the KNOWN_GAPS of this element:
//   `application`, `child`, `default-widget`, `display`, `focus-widget` — WIDGET- or
//     DISPLAY-typed, so a slot or an id here rather than an attribute; `child` and
//     `titlebar` ARE slots and `transient-for` only has to be PRESENT.
//   `destroy-with-parent` — a DOM node has no destroy, and a page has no parent to destroy.
//   `focus-visible`, `mnemonics-visible` — GTK maintains both from user input and the GIR
//     says an application must not set them (:969, :956).
//   `gravity` — which point stays fixed while the window is resized PROGRAMMATICALLY (:1163);
//     a browser box is laid out, never resized that way.
//   `handle-menubar-accel` — F10 activating a menubar, which is `<gtk-application-window>`'s
//     business and needs the `Gio.MenuModel` it is built from (:1150).
//   `startup-id` — write-only, and written by the launcher that started the application (:883).
//
// Events: `notify::<prop>` (CustomEvent, bubbles, detail `{ <prop>: value }`) on every real
// change, and `close-request` (CustomEvent, bubbles, CANCELLED, no detail), which is
// `Gtk.Window::close-request`.
//
// Reference: refs/gtk/gtk/gtkwindow.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_window.scss (GtkWindow)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { bindSlottedChildren, type AdwSlot } from '../slotted-children.js';

// Registers <gtk-window-controls>: a frame with no titlebar of its own draws the two of them
// a server-side decoration would have, so importing the window alone must define them.
import './gtk-window-controls.js';
import type { WindowAction } from './gtk-window-controls.js';

export class GtkWindow extends HTMLElement {
    private _initialized = false;
    /** The `titlebar` strip — `protected` so a subclass can place its own strips around it. */
    protected _titlebar!: HTMLDivElement;
    /** Every child the window has no slot name for. */
    protected _content!: HTMLDivElement;
    /** The SSD controls the strip draws when the window has no titlebar of its own. */
    private _startControls: HTMLElement | null = null;
    private _endControls: HTMLElement | null = null;
    /** The window's own title in the strip, or `null` when a titlebar holds it. */
    private _titleLabel: HTMLElement | null = null;
    /** Watches the strip for an author's titlebar arriving after the build. */
    private _titlebarObserver: MutationObserver | null = null;

    static get observedAttributes() {
        return [
            'decorated',
            'default-width',
            'default-height',
            'deletable',
            'fullscreened',
            'hide-on-close',
            'icon-name',
            'maximized',
            'modal',
            'resizable',
            'title',
            'transient-for',
        ];
    }

    /**
     * `Gtk.Window:title` — the window's title.
     *
     * The getter answers `''` for no title, not `null`: a `string | null` getter is not assignable to
     * `HTMLElement.title`, and the emitted `.d.ts` then fails every consumer that does not set
     * `skipLibCheck`. The setter still takes `null` to clear it, as GTK does.
     */
    get title(): string {
        return this.getAttribute('title') ?? '';
    }

    set title(value: string | null) {
        this._write('title', value);
    }

    /** `Gtk.Window:decorated` — whether the frame and its titlebar strip are drawn at all. */
    get decorated(): boolean {
        return this._onByDefault('decorated');
    }

    set decorated(value: boolean) {
        this._write('decorated', String(value));
    }

    /** `Gtk.Window:maximized` — square corners and the restore glyph. */
    get maximized(): boolean {
        return this._offByDefault('maximized');
    }

    set maximized(value: boolean) {
        this._write('maximized', String(value));
    }

    /** `Gtk.Window:resizable` — whether the maximize button may appear. */
    get resizable(): boolean {
        return this._onByDefault('resizable');
    }

    set resizable(value: boolean) {
        this._write('resizable', String(value));
    }

    /** `Gtk.Window:deletable` — whether the close button may appear. */
    get deletable(): boolean {
        return this._onByDefault('deletable');
    }

    set deletable(value: boolean) {
        this._write('deletable', String(value));
    }

    /**
     * `setAttribute` for a write that changes nothing. Every GObject setter here returns
     * early when the value is already right (gtkwindow.c:1015-1017, :1045-1046, :894-895),
     * and a boolean property whose value did not move must not notify.
     */
    protected _write(name: string, value: string | null): void {
        if (value === null) this.removeAttribute(name);
        else if (this.getAttribute(name) !== value) this.setAttribute(name, value);
    }

    /**
     * The two default polarities, because one of them is wrong for half of this widget.
     *
     * `decorated`, `resizable` and `deletable` default TRUE (gtkwindow.c:1014, :893, :1024)
     * and `maximized`, `fullscreened`, `modal` and `hide-on-close` default FALSE (:1044,
     * :1060, :903, :945). Reading them all through one helper is how a bare `<gtk-window>`
     * ended up wearing `.maximized` and `.fullscreen` — square corners and no shadow, on a
     * window that had never been maximized.
     */
    private _onByDefault(name: string): boolean {
        return this.getAttribute(name) !== 'false';
    }

    private _offByDefault(name: string): boolean {
        return this.hasAttribute(name);
    }

    connectedCallback() {
        if (this._initialized) {
            this._watchTitlebar();
            this._render();
            return;
        }
        this._initialized = true;

        this._titlebar = document.createElement('div');
        this._titlebar.className = 'adw-gtk-window-titlebar';
        this._content = document.createElement('div');
        this._content.className = 'adw-gtk-window-content';

        bindSlottedChildren(this, [
            { name: 'titlebar', into: this._titlebar },
            ...this.extraSlots(),
            { into: this._content },
        ]).install(...this.strips());

        // The `window.close` action the frame controls activate, answered by the window
        // itself — `gtk_window_close` (gtkwindow.c:1274-1287). Left armed for the life of the
        // element: it is a listener ON this, not a binding reaching outside it, so a move
        // between parents costs nothing and nothing has to be re-armed.
        this.addEventListener('window-action', (event) => this._onWindowAction(event));

        this._watchTitlebar();
        this._render();
    }

    disconnectedCallback() {
        this._titlebarObserver?.disconnect();
        this._titlebarObserver = null;
    }

    /**
     * A `slot="titlebar"` child adopted AFTER the build has to take the strip over from the
     * server-side decoration, and `_render` is the one that notices — nothing else here runs
     * when a child lands. Observed on `_titlebar`, which is where the adopted child goes,
     * because `bindSlottedChildren` already watches the host for it.
     *
     * Re-established on every connect, so a window moved between parents keeps it.
     */
    private _watchTitlebar(): void {
        this._titlebarObserver?.disconnect();
        this._titlebarObserver = new MutationObserver(() => this._render());
        this._titlebarObserver.observe(this._titlebar, { childList: true });
    }

    /**
     * The strips the frame is built from, in order. A subclass with a strip of its own —
     * `<gtk-application-window>`'s menubar — adds it here, which is the only reason this pair
     * exists: `install()` takes the structure and the slots at once, and the ORDER is that
     * call's invariant (see `slotted-children.ts`).
     */
    protected strips(): Node[] {
        return [this._titlebar, this._content];
    }

    /** The slots a subclass adds beside `titlebar`; none by default. */
    protected extraSlots(): AdwSlot[] {
        return [];
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        this._render();
        this.dispatchEvent(
            new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: this._property(name) } }),
        );
    }

    private _property(name: string): boolean | number | string | null {
        if (name === 'default-width' || name === 'default-height') {
            const raw = Number.parseFloat(this.getAttribute(name) ?? '');
            return Number.isFinite(raw) ? raw : null;
        }
        if (name === 'title' || name === 'icon-name' || name === 'transient-for') return this.getAttribute(name);
        if (name === 'decorated' || name === 'resizable' || name === 'deletable') return this._onByDefault(name);
        return this._offByDefault(name);
    }

    private _render(): void {
        // `gtk_window_set_decorated` (gtkwindow.c:1014): no frame, no titlebar strip, and so
        // nothing for the frame controls to hang in — a bar alone would still draw them.
        this._titlebar.hidden = !this.decorated;
        // `_window.scss:66-72` — maximized and fullscreen are the two states that square the
        // frame off and drop its shadow.
        this.classList.toggle('maximized', this.decorated && this.maximized);
        this.classList.toggle('fullscreen', this.decorated && this._offByDefault('fullscreened'));

        const width = Number.parseFloat(this.getAttribute('default-width') ?? '');
        const height = Number.parseFloat(this.getAttribute('default-height') ?? '');
        for (const [axis, value] of [
            ['width', width],
            ['height', height],
        ] as const) {
            if (Number.isFinite(value) && value > 0) this.style.setProperty(axis, `${value}px`);
            else this.style.removeProperty(axis);
        }

        const title = this.getAttribute('title');
        if (title === null) this.removeAttribute('aria-label');
        else this.setAttribute('aria-label', title);
        this._renderTitlebar();
    }

    /**
     * The strip, in the two shapes a window can be in. With a `titlebar` child the strip
     * holds exactly that — GTK hands the whole titlebar to the bar, decorations and all. With
     * none it holds the two `<gtk-window-controls>` and the window's title, which is the
     * server-side decoration GTK would otherwise have asked the window manager to draw and
     * which a page has to draw for itself.
     */
    private _renderTitlebar(): void {
        // The strip's OWN nodes do not count as an authored titlebar. `connectedCallback`
        // re-runs `_render()` on every connect, and a check on `childElementCount` alone
        // read the three SSD children this method had just built as somebody else's titlebar
        // and removed them — so a window that had been moved between parents came back with an
        // empty titlebar while a freshly built one kept its frame buttons.
        const authored = [...this._titlebar.children].some(
            (child) => child !== this._startControls && child !== this._endControls && child !== this._titleLabel,
        );
        if (authored) {
            for (const own of [this._startControls, this._endControls, this._titleLabel]) own?.remove();
            this._startControls = null;
            this._endControls = null;
            this._titleLabel = null;
            return;
        }
        if (!this.decorated) return;

        if (this._startControls === null) {
            this._startControls = document.createElement('gtk-window-controls');
            this._startControls.setAttribute('side', 'start');
            this._endControls = document.createElement('gtk-window-controls');
            this._endControls.setAttribute('side', 'end');
            this._titleLabel = document.createElement('span');
            this._titleLabel.className = 'adw-gtk-window-title';
            this._titlebar.append(this._startControls, this._titleLabel, this._endControls);
        }
        const title = this.getAttribute('title');
        if (title === null) this._titleLabel?.removeAttribute('title');
        else this._titleLabel?.setAttribute('title', title ?? '');
    }

    /** The frame controls' `GtkActionable` names, answered here — gtkwindow.c:1274-1287. */
    private _onWindowAction(event: Event): void {
        const action = (event as CustomEvent<{ action: WindowAction }>).detail?.action;
        if (action === 'toggle-maximized') {
            this._write('maximized', String(!this._offByDefault('maximized')));
            return;
        }
        if (action === 'close') this.close();
    }

    /**
     * `gtk_window_close` (gtkwindow.c:1274-1287): emit `close-request` and, if nothing handled
     * it, hide the window when `hide-on-close` is set and DESTROY it otherwise. "Destroy" is
     * the one word this port cannot mean — a page has no unref — so the default detaches the
     * frame, which is the same observable outcome for everything above it.
     */
    close(): boolean {
        const request = new CustomEvent('close-request', { bubbles: true, cancelable: true });
        this.dispatchEvent(request);
        if (request.defaultPrevented) return false;
        if (this._offByDefault('hide-on-close')) this.hidden = true;
        else this.remove();
        return true;
    }

    /**
     * `gtk_window_maximize`. ASYNCHRONOUS in GTK — the GIR says so at gtkwindow.c:1044 — so
     * the property is the thing a caller watches, and this writes it directly rather than
     * pretending to round-trip a compositor.
     */
    maximize(): void {
        this._write('maximized', 'true');
    }

    /** `gtk_window_unmaximize`, with the same caveat as {@link maximize}. */
    unmaximize(): void {
        this._write('maximized', 'false');
    }
}

customElements.define('gtk-window', GtkWindow);
