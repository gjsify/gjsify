// What `Adw.Window` and `Adw.ApplicationWindow` add on top of their Gtk parent: the content
// area, the breakpoints and the open-dialog bookkeeping.
//
// A HELPER, NOT A BASE CLASS. Upstream `AdwWindow` extends `GtkWindow` and `AdwApplicationWindow`
// extends `GtkApplicationWindow` (Adw-1.gir), so the two cannot share an Adw base without one of
// them losing its Gtk parent. A custom element has one prototype chain, so the shared part is
// composed in: each class owns one of these and forwards to it.
//
// Reference: refs/libadwaita/src/adw-window.c
// Copyright (c) 2020-2023 Alice Mikhaylenko / Purism SPC (libadwaita). LGPLv2.1+
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { AdwBreakpoint } from '@gjsify/adwaita-core';
import { addBreakpoints } from '../breakpoints.js';

/** `adw_window_init`'s size request: a MINIMUM, overridable by `width-request`/`height-request`. */
const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 200;

/** A `width-request`/`height-request` attribute as px; absent, unparsable or -1 means unset. */
function requested(host: HTMLElement, name: string, fallback: number): number {
    const value = Number.parseFloat(host.getAttribute(name) ?? '');
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export class AdwWindowFeatures {
    private _contentEl: HTMLDivElement | null = null;
    private _breakpoints: AdwBreakpoint[] = [];
    private _disposeBreakpoints: (() => void) | null = null;
    private _openDialogs: HTMLElement[] = [];

    constructor(private readonly _host: HTMLElement) {}

    /** The content area, or `null` before the window is first connected. */
    get contentArea(): HTMLDivElement | null {
        return this._contentEl;
    }

    /** The content widget — the first child of the content area. */
    get content(): HTMLElement | null {
        return (this._contentEl?.firstElementChild as HTMLElement | null) ?? null;
    }

    set content(value: HTMLElement | null) {
        if (value) this._contentEl?.appendChild(value);
    }

    get breakpoints(): readonly AdwBreakpoint[] {
        return this._breakpoints;
    }

    get currentBreakpoint(): AdwBreakpoint | null {
        return this._breakpoints.find((bp) => bp.applied) ?? null;
    }

    get dialogs(): readonly HTMLElement[] {
        // A dialog taken out of the document never raises `notify::open` on the way
        // out, so a dialog that was REMOVED while open would otherwise stay listed
        // for the rest of the window's life.
        this._openDialogs = this._openDialogs.filter((dialog) => dialog.isConnected);
        return this._openDialogs;
    }

    get visibleDialog(): HTMLElement | null {
        const dialogs = this.dialogs;
        return dialogs.length > 0 ? (dialogs[dialogs.length - 1] as HTMLElement) : null;
    }

    /**
     * Take the content area the Gtk parent built, once. Tracks open dialogs presented inside
     * the window: an AdwDialog raises `notify::open`, which bubbles to the host.
     */
    adopt(contentEl: HTMLDivElement): void {
        if (this._contentEl !== null) return;
        this._contentEl = contentEl;
        contentEl.classList.add('adw-window-content');
        this._host.addEventListener('notify::open', (e) => {
            const dialog = e.target as HTMLElement;
            if (dialog === this._host) return;
            if (dialog.hasAttribute('open')) {
                if (!this._openDialogs.includes(dialog)) this._openDialogs.push(dialog);
            } else {
                this._openDialogs = this._openDialogs.filter((d) => d !== dialog);
            }
        });
    }

    /**
     * Add a breakpoint (adw_window_add_breakpoint). The breakpoint evaluates against the
     * window's own box and sets a `data-breakpoint` attribute when applied.
     */
    addBreakpoint(condition: string): AdwBreakpoint {
        const host = this._host;
        const bp = new AdwBreakpoint(condition, {
            onApply: () => (host.dataset.breakpoint = condition),
            onUnapply: () => {
                if (host.dataset.breakpoint === condition) delete host.dataset.breakpoint;
            },
        });
        this._breakpoints.push(bp);
        // Re-evaluated against a box that may have changed since the last add.
        this.bind();
        return bp;
    }

    /**
     * Bind the breakpoints to THIS box.
     *
     * NOT once per lifetime: `release` drops the disposer, so a window moved between
     * parents would come back deaf — and a window is exactly the thing a client-side route
     * change re-parents. Re-binding is cheap and idempotent, and it re-measures the new box.
     */
    bind(): void {
        this._disposeBreakpoints?.();
        this._disposeBreakpoints = null;
        if (this._contentEl !== null && this._breakpoints.length > 0) {
            this._disposeBreakpoints = addBreakpoints(this._host, this._breakpoints);
        }
    }

    release(): void {
        this._disposeBreakpoints?.();
        this._disposeBreakpoints = null;
    }

    /**
     * The window's size. `Adw.Window` defaults to a 360×200 MINIMUM (a size request, not the
     * size; `width-request`/`height-request` override it). `default-width/height` is only
     * a default: an authored size is the box, and an absent one leaves the box to the
     * stylesheet, which fills the viewport — a page has no window manager to pick a size.
     */
    applySizeRequest(): void {
        const host = this._host;
        host.style.minWidth = `${requested(host, 'width-request', DEFAULT_WIDTH)}px`;
        host.style.minHeight = `${requested(host, 'height-request', DEFAULT_HEIGHT)}px`;
        const width = host.getAttribute('default-width') ?? host.getAttribute('width');
        const height = host.getAttribute('default-height') ?? host.getAttribute('height');
        if (width) host.style.width = `${width}px`;
        else host.style.removeProperty('width');
        if (height) host.style.height = `${height}px`;
        else host.style.removeProperty('height');
    }
}
