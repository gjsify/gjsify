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
//   `application`, `child`, `default-widget`, `display` — WIDGET- or
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
// THE STATE MEMBERS, and what each is in a page (the shared rules — notify only on change, the
// close sequence — live in `@gjsify/adwaita-core`'s `window-members.ts`):
//   `is-active`    — the DOCUMENT has focus and this frame is connected and shown. A page has one
//                    focus for all its windows, so every shown frame is active together; that is
//                    the honest limit of a frame (`document.hasFocus()`, window focus/blur and
//                    `visibilitychange` feed it). Read-only, as in GTK.
//   `focus-widget` — the element inside the frame that holds `document.activeElement`, live.
//                    `set_focus(el)` calls `el.focus()` and refuses an element outside the frame;
//                    `set_focus(null)` blurs. `focusin`/`focusout` notify; focus that merely
//                    leaves with the window (blur) keeps its widget, as GTK keeps it.
//   `maximized`    — the FRAME's state (square corners), not the browser window's: a page cannot
//                    maximize its browser window. `is_maximized()` reads it.
//   `present()`    — un-hides the frame; a page cannot raise or focus a window it does not own.
//
// THE GOBJECT DOOR (ADR 0096 § 3, ADR 0098 Amendment 3): `connect` / `disconnect` / `emit` /
// `notify` / `get_property` / `set_property` come from `installElementApi`, over the events in
// `static signals`; an undeclared signal throws. A `close-request` handler that returns true is
// `preventDefault()` and stops later listeners. `emit('close-request')` throws: the signal is
// `close()`'s, which also runs the default handler. `is_active` and `focus_widget` are PROPERTIES,
// as in GJS and `@girs/gtk-4.0` (GTK 4 has no `gtk_window_is_active()`); `is_active()` is gone.
//
// Events: `notify::<prop>` (CustomEvent, bubbles, detail `{ <prop>: value }`) on every real
// change, and `close-request` (CustomEvent, bubbles, CANCELLABLE, no detail), which is
// `Gtk.Window::close-request`: a listener that calls `preventDefault()` is a GTK handler that
// returns true. `window.close()` runs it through `CloseRequestState`.
//
// Reference: refs/gtk/gtk/gtkwindow.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_window.scss (GtkWindow)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { CloseRequestState, WindowMemberState, type WindowMemberProperty } from '@gjsify/adwaita-core';

import { installElementApi } from '../gobject-elements.js';
import type { DispatchedSignals } from '../signals.js';
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
    /** `is-active` and `focus-widget`; `maximized` stays the attribute above. */
    private readonly _members = new WindowMemberState<Element>((property) => this._notifyMember(property));
    private readonly _closing = new CloseRequestState();
    private readonly _syncActive = (): void => void this._members.reportActive(this._documentIsActive());
    private readonly _onFocusIn = (event: FocusEvent): void => {
        if (event.target instanceof Element) this._members.reportFocus(event.target);
    };
    private readonly _onFocusOut = (event: FocusEvent): void => {
        const next = event.relatedTarget;
        if (next instanceof Node && this.contains(next)) return;
        // Focus leaving WITH the window (tab switch, another app) keeps the widget; GTK does too.
        if (next === null && !document.hasFocus()) return;
        this._members.reportFocus(null);
    };

    /**
     * The GObject door (ADR 0096 § 3): `connect` / `disconnect` / `emit` / `notify` / `get_property` /
     * `set_property` over these events, the same ones every element declares in `static signals`.
     * A `close-request` handler that returns true is `preventDefault()`.
     */
    static readonly signals: DispatchedSignals = {
        'close-request': 'close-request',
        ...Object.fromEntries(
            [
                'decorated',
                'default-height',
                'default-width',
                'deletable',
                'focus-widget',
                'fullscreened',
                'hide-on-close',
                'icon-name',
                'is-active',
                'maximized',
                'modal',
                'resizable',
                'title',
                'transient-for',
            ].map((name) => [`notify::${name}`, `notify::${name}`]),
        ),
    };

    /** `GObject.Object.connect`: installed per instance by `installElementApi`; refuses an undeclared signal. */
    declare connect: (signal: string, handler: (emitter: this, ...args: any[]) => unknown) => number;
    /** `GObject.Object.disconnect`: throws for an id that is not connected. */
    declare disconnect: (id: number) => void;
    /** `GObject.Object.emit`; `close-request` is refused, call `close()`. */
    declare emit: (signal: string, ...args: unknown[]) => void;
    /** `GObject.Object.notify`. */
    declare notify: (name: string) => void;
    /** `GObject.Object.get_property`, by GTK's dashed name. */
    declare get_property: (name: string) => unknown;
    /** `GObject.Object.set_property`; a read-only property throws. */
    declare set_property: (name: string, value: unknown) => void;

    constructor() {
        super();
        installElementApi(this);
        // `Gtk.Window::close-request` is emitted by `close()`, which also runs the default handler
        // (hide or destroy). Emitting it bare would be a different thing under the same name.
        const emit = (this as unknown as { emit: (signal: string, ...args: unknown[]) => void }).emit;
        Object.defineProperty(this, 'emit', {
            configurable: true,
            writable: true,
            value: (signal: string, ...args: unknown[]): void => {
                if (signal === 'close-request') {
                    throw new Error("<gtk-window>.emit('close-request') is not supported; call close()");
                }
                emit(signal, ...args);
            },
        });
    }

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
            // Not a window property: `is-active` depends on it, so it is watched but never notified.
            'hidden',
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
        return this.hasAttribute(name) && this.getAttribute(name) !== 'false';
    }

    connectedCallback() {
        if (this._initialized) {
            this._watchActivity();
            this._watchTitlebar();
            this._render();
            return;
        }
        this._initialized = true;
        this._watchActivity();

        this._titlebar = document.createElement('div');
        this._titlebar.className = 'adw-gtk-window-titlebar';
        this._content = document.createElement('div');
        this._content.className = 'adw-gtk-window-content';

        bindSlottedChildren(this, [
            // `child` only beside a titlebar: AdwWindow and AdwApplicationWindow inherit
            // `Gtk.Window:child` and abort on it (adw-window.c:180), `content` is theirs.
            ...(this.hasTitlebar()
                ? [
                      { name: 'titlebar', into: this._titlebar },
                      { name: 'child', into: this._content },
                  ]
                : []),
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
        window.removeEventListener('focus', this._syncActive);
        window.removeEventListener('blur', this._syncActive);
        document.removeEventListener('visibilitychange', this._syncActive);
        this.removeEventListener('focusin', this._onFocusIn);
        this.removeEventListener('focusout', this._onFocusOut);
        // An unmapped window is neither active nor holding focus.
        this._members.reportActive(false);
        this._members.reportFocus(null);
    }

    private _watchActivity(): void {
        window.addEventListener('focus', this._syncActive);
        window.addEventListener('blur', this._syncActive);
        document.addEventListener('visibilitychange', this._syncActive);
        this.addEventListener('focusin', this._onFocusIn);
        this.addEventListener('focusout', this._onFocusOut);
        this._syncActive();
    }

    private _documentIsActive(): boolean {
        return this.isConnected && !this.hidden && document.visibilityState !== 'hidden' && document.hasFocus();
    }

    private _notifyMember(property: WindowMemberProperty): void {
        const detail =
            property === 'is-active'
                ? this._members.active
                : property === 'focus-widget'
                  ? this._members.focus
                  : this.maximized;
        this.dispatchEvent(new CustomEvent(`notify::${property}`, { bubbles: true, detail: { [property]: detail } }));
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

    /**
     * Whether this window has a titlebar strip at all. `Adw.Window` has none (it styles nothing
     * itself, you pair it with a header bar), so a subclass answers `false` and neither the
     * `titlebar` slot nor the server-side decoration is built.
     */
    protected hasTitlebar(): boolean {
        return true;
    }

    /** The slots a subclass adds beside `titlebar`; none by default. */
    protected extraSlots(): AdwSlot[] {
        return [];
    }

    attributeChangedCallback(name: string) {
        if (name === 'hidden') {
            this._syncActive();
            return;
        }
        // Before the first connect there is nothing to draw, but the property still moved: GTK
        // notifies a window that was never mapped, and a listener on a detached frame hears it.
        if (this._initialized) this._render();
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

        this.renderFrameSize();

        const title = this.getAttribute('title');
        if (title === null) this.removeAttribute('aria-label');
        else this.setAttribute('aria-label', title);
        this._renderTitlebar();
    }

    /**
     * The frame's box from `default-width` / `default-height`; an absent one clears it. A subclass
     * with a size request of its own (`Adw.Window`'s 360×200) replaces this.
     */
    protected renderFrameSize(): void {
        const width = Number.parseFloat(this.getAttribute('default-width') ?? '');
        const height = Number.parseFloat(this.getAttribute('default-height') ?? '');
        for (const [axis, value] of [
            ['width', width],
            ['height', height],
        ] as const) {
            if (Number.isFinite(value) && value > 0) this.style.setProperty(axis, `${value}px`);
            else this.style.removeProperty(axis);
        }
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
        if (!this.decorated || !this.hasTitlebar()) return;

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
     *
     * A frame that is not in the page is not realized, so there is nothing to close; a listener
     * that calls `close()` again is ignored, as GTK ignores it. Answers whether the window went
     * away (hidden or detached), `false` when a listener took the request over or it was ignored.
     */
    close(): boolean {
        const outcome = this._closing.close({
            realized: this.isConnected,
            hideOnClose: this._offByDefault('hide-on-close'),
            emit: () => {
                const request = new CustomEvent('close-request', { bubbles: true, cancelable: true });
                this.dispatchEvent(request);
                return request.defaultPrevented;
            },
            hide: () => void (this.hidden = true),
            destroy: () => this.remove(),
        });
        return outcome === 'hidden' || outcome === 'destroyed';
    }

    /**
     * `gtk_window_present`: show the frame. GTK also raises and focuses the toplevel, which is
     * the window manager's to grant; a page owns no such surface, so this is only the first half.
     */
    present(): void {
        this.hidden = false;
    }

    /**
     * `Gtk.Window:is-active` — see the header: the document's focus, while this frame is shown.
     * A PROPERTY, as in GJS and `@girs/gtk-4.0`: GTK 4 has no `gtk_window_is_active`, so
     * `window.is_active` is the value and `window.is_active()` does not exist.
     */
    get isActive(): boolean {
        return this._members.active;
    }

    get is_active(): boolean {
        return this._members.active;
    }

    /** `Gtk.Window:focus-widget`, read live from the document. */
    get focusWidget(): Element | null {
        return this.get_focus();
    }

    /** `Gtk.Window:focus-widget` under its GJS spelling; writing it is `set_focus`. */
    get focus_widget(): Element | null {
        return this.get_focus();
    }

    set focus_widget(widget: Element | null) {
        this.set_focus(widget);
    }

    /** `gtk_window_get_focus`: the element inside the frame that has focus, or `null`. */
    get_focus(): Element | null {
        const active = document.activeElement;
        return active !== null && active !== this && this.contains(active) ? active : null;
    }

    /**
     * `gtk_window_set_focus`. `null` clears the focus. An element outside the frame is refused:
     * GTK's window only focuses its own descendants.
     */
    set_focus(widget: Element | null): void {
        if (widget === null) {
            const current = this.get_focus();
            if (current instanceof HTMLElement || current instanceof SVGElement) current.blur();
            this._members.reportFocus(null);
            return;
        }
        if (widget === this || !this.contains(widget)) {
            throw new Error('<gtk-window>.set_focus: the widget is not inside this window');
        }
        if (widget instanceof HTMLElement || widget instanceof SVGElement) widget.focus();
        // `focus()` fires no focusin while the document itself is unfocused, so report what the
        // document now says; an equal write is dropped by the state.
        this._members.reportFocus(this.get_focus());
    }

    /** `gtk_window_is_maximized`: the FRAME's state, not the browser window's. */
    is_maximized(): boolean {
        return this.maximized;
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
