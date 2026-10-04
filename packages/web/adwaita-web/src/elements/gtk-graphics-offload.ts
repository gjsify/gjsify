// <gtk-graphics-offload> — a wrapper that asks the compositor to take its ONE child
// as it is, skipping a texture round-trip that a frequently changing child would pay on
// every frame.
//
// WHAT THIS IS NOT, STATED FIRST BECAUSE IT IS THE FIRST THING A READER GETS WRONG. A web
// page cannot hand a surface to a compositor the way `gdk_surface_create_subsurface` does
// (`sync_subsurface`, gtkgraphicsoffload.c:176-191). There is no API on the platform for
// it and no CSS property that means it. So the element ports everything AROUND the
// passthrough, which is all of the widget's own behaviour:
//
//   · the ENUM, with its default. `enabled` is `GTK_GRAPHICS_OFFLOAD_ENABLED` from the
//     start (`:107-109`, `:267-273`) and takes one of two values; `set_enabled` returns
//     early when it is already right, then `sync_subsurface`, `queue_draw` and a notify
//     (`:366-380`). When offload is enabled the element sets `will-change: transform` on
//     its own box, which is the browser's own statement that a layer may be composited
//     without being drawn into a texture first — the closest thing on this platform to
//     what the C asks GDK for, and the whole of what it can do.
//   · the BLACK RECTANGLE. `black_background` paints `GDK_RGBA_BLACK` over the widget's
//     whole allocation and THEN the child (`:213-233`), which is what letterboxing a video
//     whose aspect ratio does not match the screen needs, and the reason the property
//     exists at all rather than being a CSS class the application could add itself.
//   · THE BIN LAYOUT. `GtkGraphicsOffload` installs `GTK_TYPE_BIN_LAYOUT` (`:290`), so the
//     child is given the whole allocation rather than sized by anything of the wrapper's.
//   · THE ORDER of the notify, which is the property order and never anything else.
//
// What GTK does NOT do is worth reading too, because it is the list of things an
// application must not put on top of an offloaded child (`:64-75`): rounded corners that
// clip the content, a transform more complex than a translation and a scale, a filter such
// as opacity or grayscale, and translucent content. None of them are enforced here — a
// browser decides what it composites — and the block says so rather than implying the
// passthrough is available.
//
// A11Y: no role. The widget is a bin (`:286-291`): it contributes no name, no role and no
// value of its own, and the child's own accessibility is what a screen reader should get.
//
// Events: `notify::<prop>` (CustomEvent, bubbles, detail `{ <prop>: value }`) on a real
// change. There is no `notify::child` from a slotted write — the child arrives as markup,
// which is the same answer `GtkOverlay` gives.
//
// Reference: refs/gtk/gtk/gtkgraphicsoffload.c
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { bindSlottedChildren } from '../slotted-children.js';

/** `GtkGraphicsOffloadEnabled`, spelled as the GIR's enum nicks. */
type OffloadEnabled = 'enabled' | 'disabled';

function booleanAttribute(element: HTMLElement, name: string, fallback: boolean): boolean {
    const raw = element.getAttribute(name);
    if (raw === null) return fallback;
    return raw !== 'false' && raw !== '0';
}

export class GtkGraphicsOffload extends HTMLElement {
    private _childEl!: HTMLDivElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['enabled', 'black-background'];
    }

    /** `Gtk.GraphicsOffload:child` — the child widget, as the light-DOM node adopted. */
    get child(): Element | null {
        return this._childEl?.firstElementChild ?? null;
    }

    /**
     * `Gtk.GraphicsOffload:enabled` — whether the widget ATTEMPTS to offload its child's
     * contents. Defaults to `GTK_GRAPHICS_OFFLOAD_ENABLED` (`:267-273`).
     */
    get enabled(): OffloadEnabled {
        return this.getAttribute('enabled') === 'disabled' ? 'disabled' : 'enabled';
    }

    set enabled(v: OffloadEnabled) {
        // `if (priv->enabled == enabled) return;` (:369) — the guard that makes the notify
        // a change rather than an echo.
        if (this.enabled === v) return;
        this.setAttribute('enabled', v);
    }

    /** `Gtk.GraphicsOffload:black-background` — the black rect painted before the child. */
    get blackBackground(): boolean {
        return booleanAttribute(this, 'black-background', false);
    }

    set blackBackground(v: boolean) {
        if (this.blackBackground === !!v) return;
        this.setAttribute('black-background', String(!!v));
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._childEl = document.createElement('div');
        this._childEl.className = 'adw-graphics-offload-child';
        // `GTK_TYPE_BIN_LAYOUT` gives the child the whole allocation, and `child` is the one
        // GtkBuildable slot the widget has, so it is the default one here.
        bindSlottedChildren(this, [{ into: this._childEl }]).install(this._childEl);
        this.replaceChildren(this._childEl);
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'enabled' || name === 'black-background') this._render();
        this._notify(name);
    }

    /** `sync_subsurface` (:176-191): the subsurface exists while the widget is realized and offload is not disabled. */
    private _render(): void {
        const offloading = this.enabled !== 'disabled';
        // The browser's own hint that this layer may be composited without a texture
        // round-trip. It is not the passthrough — nothing on this platform is — and the
        // block says so where a reader would otherwise assume parity.
        this.style.willChange = offloading ? 'transform' : '';
        // `gtk_snapshot_append_color (… GDK_RGBA_BLACK …)` over the whole allocation, before
        // the child (:222-229): a background, which is what makes the letterbox bars black.
        this.style.backgroundColor = this.blackBackground ? '#000000' : '';
    }

    private _notify(name: string): void {
        const value: string | boolean = name === 'enabled' ? this.enabled : this.blackBackground;
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: value } }));
    }
}

customElements.define('gtk-graphics-offload', GtkGraphicsOffload);
