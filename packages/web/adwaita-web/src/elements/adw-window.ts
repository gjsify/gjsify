// <adw-window> — the web counterpart of Adw.Window: a Gtk.Window (so <gtk-window>'s state
// members — is-active, focus-widget, close-request, present(), maximized — are inherited)
// with no titlebar area. Adw.Window styles nothing itself — you pair it with
// Adw.ToolbarView and an Adw.HeaderBar (or a Gtk.HeaderBar) to get the chrome —
// so this element owns the FRAME and the window's own state, and the chrome is
// whatever you put in it.
//
// THE FRAME IS IN-PAGE, and that is the whole difference from GTK. A document has
// no window manager, so this element is a box on the page, not a toplevel: no
// titlebar, no `.tiled`/`.maximized`/`.solid-csd` decoration classes, no focus
// stealing on present. What IS ported is the frame libadwaita draws for a CSD
// window (border-radius, the three-layer shadow, the 1px outline), the size
// request GTK makes for an AdwWindow, the content property, the breakpoints and
// the open-dialog bookkeeping.
//
// Children are placed in the content area (the Adw.Window:content property).
// The window supports breakpoints via addBreakpoint() and tracks open dialogs
// presented inside it. The default size is 360×200, matching the C source.
//
// Attributes:
//   width, height — the size REQUEST in px, the one `gtk_widget_set_size_request
//     (GTK_WIDGET (self), 360, 200)` makes in adw_window_init (C:344). Absent, the
//     element keeps that default; an explicit attribute overrides it.
//   default-width, default-height — `Gtk.Window:default-width` / `:default-height`, the size a
//     `.blp` authors (`default-width: 1100`). A page has no window manager to open the window at
//     that size, so it IS the box's size here, and it beats the request where both are present.
//
// Properties: `content` (the Adw.Window:content child), `breakpoints`,
// `currentBreakpoint` (Adw.Window:current-breakpoint), `dialogs` and
// `visibleDialog` (Adw.Window:dialogs / :visible-dialog), `contentArea`.
//
// NOT PORTED: `adaptive-preview` — a debug mode that lets you resize the window to
// a set of device sizes, opened from GTK Inspector or Ctrl+Shift+M. A browser has
// no inspector and no device to simulate; a CSS media query does the same job and
// the breakpoints below are how libadwaita itself does it. Ledgered in KNOWN_GAPS.
//
// Reference: refs/libadwaita/src/adw-window.c (AdwWindow behaviour)
// Reference: refs/libadwaita/src/stylesheet/widgets/_window.scss (window frame)
// Copyright (c) 2020-2023 Alice Mikhaylenko / Purism SPC (libadwaita). LGPLv2.1+
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import type { AdwBreakpoint } from '@gjsify/adwaita-core';
import type { AdwSlot } from '../slotted-children.js';
import { AdwWindowFeatures } from './adw-window-features.js';
import { GtkWindow } from './gtk-window.js';

export class AdwWindow extends GtkWindow {
    private readonly _features = new AdwWindowFeatures(this);

    static get observedAttributes() {
        return [...GtkWindow.observedAttributes, 'width', 'height'];
    }

    /** The content area — the Adw.Window:content property. */
    get contentArea(): HTMLDivElement {
        return this._content;
    }

    /** The content widget — the first child of the content area. */
    get content(): HTMLElement | null {
        return this._features.content;
    }

    set content(value: HTMLElement | null) {
        this._features.content = value;
    }

    /** The breakpoints added to this window. */
    get breakpoints(): readonly AdwBreakpoint[] {
        return this._features.breakpoints;
    }

    /** The currently applied breakpoint, or null when none is. */
    get currentBreakpoint(): AdwBreakpoint | null {
        return this._features.currentBreakpoint;
    }

    /** The open dialogs presented inside this window (Adw.Window:dialogs). */
    get dialogs(): readonly HTMLElement[] {
        return this._features.dialogs;
    }

    /** The currently visible dialog, or null when none is (Adw.Window:visible-dialog). */
    get visibleDialog(): HTMLElement | null {
        return this._features.visibleDialog;
    }

    /** Add a breakpoint to this window (adw_window_add_breakpoint). */
    addBreakpoint(condition: string): AdwBreakpoint {
        return this._features.addBreakpoint(condition);
    }

    connectedCallback() {
        super.connectedCallback();
        this._features.adopt(this._content);
        // EVERY connect, not only the first — see `AdwWindowFeatures.bind`.
        this._features.bind();
    }

    disconnectedCallback() {
        this._features.release();
        super.disconnectedCallback();
    }

    attributeChangedCallback(name: string) {
        // The size request is read from the ATTRIBUTE, so it is applied on every change —
        // including one that arrived before the element was connected.
        if (name === 'width' || name === 'height') {
            this.renderFrameSize();
            return;
        }
        super.attributeChangedCallback(name);
    }

    /** `Adw.Window` has no titlebar of its own: you pair it with a header bar. */
    protected override hasTitlebar(): boolean {
        return false;
    }

    protected override strips(): Node[] {
        return [this._content];
    }

    protected override extraSlots(): AdwSlot[] {
        // `content` is the content area's name too: a `.blp` writes `content:` on the window.
        return [{ name: 'content', into: this._content }];
    }

    protected override renderFrameSize(): void {
        this._features.applySizeRequest();
    }
}

customElements.define('adw-window', AdwWindow);
