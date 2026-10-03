// <adw-window> — the web counterpart of Adw.Window: a freeform window with no
// titlebar area. Adw.Window styles nothing itself — you pair it with
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

import { AdwBreakpoint } from '@gjsify/adwaita-core';
import { addBreakpoints } from '../breakpoints.js';
import { bindSlottedChildren } from '../slotted-children.js';

/** The default minimum size of an AdwWindow, from adw_window_init (C:344). */
const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 200;

export class AdwWindow extends HTMLElement {
    private _initialized = false;
    private _contentEl!: HTMLDivElement;
    private _breakpoints: AdwBreakpoint[] = [];
    private _disposeBreakpoints: (() => void) | null = null;
    private _openDialogs: HTMLElement[] = [];

    static get observedAttributes() {
        return ['width', 'height'];
    }

    /** The content area — the Adw.Window:content property. */
    get contentArea(): HTMLDivElement {
        return this._contentEl;
    }

    /** The content widget — the first child of the content area. */
    get content(): HTMLElement | null {
        return this._contentEl.firstElementChild as HTMLElement | null;
    }

    set content(value: HTMLElement | null) {
        if (value) {
            this._contentEl.appendChild(value);
        }
    }

    /** The breakpoints added to this window. */
    get breakpoints(): readonly AdwBreakpoint[] {
        return this._breakpoints;
    }

    /** The currently applied breakpoint, or null when none is. */
    get currentBreakpoint(): AdwBreakpoint | null {
        return this._breakpoints.find((bp) => bp.applied) ?? null;
    }

    /** The open dialogs presented inside this window (Adw.Window:dialogs). */
    get dialogs(): readonly HTMLElement[] {
        // A dialog taken out of the document never raises `notify::open` on the way
        // out, so a dialog that was REMOVED while open would otherwise stay listed
        // for the rest of the window's life.
        this._openDialogs = this._openDialogs.filter((dialog) => dialog.isConnected);
        return this._openDialogs;
    }

    /** The currently visible dialog, or null when none is (Adw.Window:visible-dialog). */
    get visibleDialog(): HTMLElement | null {
        const dialogs = this.dialogs;
        return dialogs.length > 0 ? (dialogs[dialogs.length - 1] as HTMLElement) : null;
    }

    /**
     * Add a breakpoint to this window (adw_window_add_breakpoint).
     * The breakpoint evaluates against the window's own box and sets a
     * `data-breakpoint` attribute when applied.
     */
    addBreakpoint(condition: string): AdwBreakpoint {
        const bp = new AdwBreakpoint(condition, {
            onApply: () => (this.dataset.breakpoint = condition),
            onUnapply: () => {
                if (this.dataset.breakpoint === condition) delete this.dataset.breakpoint;
            },
        });
        this._breakpoints.push(bp);
        // Re-evaluated against a box that may have changed since the last add.
        this._bindBreakpoints();
        return bp;
    }

    connectedCallback() {
        this._buildOnce();
        // EVERY connect, not only the first — see `_bindBreakpoints`.
        this._bindBreakpoints();
    }

    disconnectedCallback() {
        this._disposeBreakpoints?.();
        this._disposeBreakpoints = null;
    }

    attributeChangedCallback(name: string) {
        // The size request is read from the ATTRIBUTE, so it is applied on every
        // change — including one that arrived before the element was connected, which
        // is the ordinary case for markup already sitting in a document.
        if (name === 'width' || name === 'height') this._applySizeRequest();
    }

    private _buildOnce() {
        if (this._initialized) return;
        this._initialized = true;

        this._applySizeRequest();

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-window-content';

        // Children are the content — the Adw.Window buildable default, and `content` is
        // ALSO its name, because a `.blp` writes `content:` on the window and an authored
        // tree needs the name to route it: `refuseUnknownSlots` in
        // `src/shared-tree-builder.ts` throws on a slot a defined element does not
        // declare, and `showcases/gtk/effect-adw-services/src/window.blp` is rooted at
        // one. The content area becomes the host's own child, so a child appended later
        // lands in it too (`bindSlottedChildren` is LIVE, see `src/slotted-children.ts`).
        bindSlottedChildren(this, [{ name: 'content', into: this._contentEl }, { into: this._contentEl }]).install(
            this._contentEl,
        );

        // Track open dialogs presented inside this window: an AdwDialog raises
        // `notify::open`, which bubbles to here.
        this.addEventListener('notify::open', (e) => {
            const dialog = e.target as HTMLElement;
            if (dialog === this) return;
            if (dialog.hasAttribute('open')) {
                if (!this._openDialogs.includes(dialog)) this._openDialogs.push(dialog);
            } else {
                this._openDialogs = this._openDialogs.filter((d) => d !== dialog);
            }
        });
    }

    /**
     * Bind the breakpoints to THIS box.
     *
     * NOT once per lifetime: `disconnectedCallback` releases the disposer, so a
     * window moved between parents would come back deaf — and a window is exactly
     * the thing a client-side route change re-parents. Re-binding is cheap and
     * idempotent, and it re-measures the new box on the way.
     */
    private _bindBreakpoints() {
        this._disposeBreakpoints?.();
        this._disposeBreakpoints = null;
        if (this._initialized && this._breakpoints.length > 0) {
            this._disposeBreakpoints = addBreakpoints(this, this._breakpoints);
        }
    }

    /** The window's size request — GTK's, not CSS's, so an absent attribute means the default. */
    private _applySizeRequest() {
        const width = this.getAttribute('width');
        const height = this.getAttribute('height');
        this.style.width = width ? `${width}px` : `${DEFAULT_WIDTH}px`;
        this.style.height = height ? `${height}px` : `${DEFAULT_HEIGHT}px`;
    }
}

customElements.define('adw-window', AdwWindow);
