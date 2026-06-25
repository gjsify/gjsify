// AdwNavigationView — a Libadwaita-style navigation stack for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` that overlays its pages and shows only
// the top of a manual page stack. Mirrors `Adw.NavigationView`: `add(page, tag)`,
// `push(pageOrTag)`, `pop()`, `visiblePage`, and a `notify::visible-page` event.
//
// FIDELITY: approximated. An NS `Frame` gives real native push/pop with the
// platform's slide animation but requires each page to be a `Page`/`Frame`-routed
// module — too heavy for a drop-in widget and it imposes its own header chrome.
// This instead keeps a manual stack of plain `View`s in a single `GridLayout`,
// showing the top via `visibility` toggles. COMPROMISES: (1) no slide/back-swipe
// animation or gesture (the CSS subset has no transition; a real app can wrap this
// in `view.animate()` or use a `Frame` for gestures); (2) no automatic back
// button — the consumer wires a button to `pop()`. The push/pop *stack semantics*
// are faithful.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-navigation-view`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_navigation-view.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, View, type EventData } from '@nativescript/core';

/** Event name emitted when the visible page changes. Mirrors GObject `notify::visible-page`. */
export const NOTIFY_VISIBLE_PAGE = 'notify::visible-page';

/** Payload of the `notify::visible-page` event. */
export interface NotifyVisiblePageEventData extends EventData {
    /** The newly-visible page's tag, or `null`. */
    tag: string | null;
    /** The current navigation stack depth. */
    depth: number;
}

interface NavPage {
    view: View;
    tag: string | null;
}

export class AdwNavigationView extends GridLayout {
    /** All registered pages (by tag), addressable by `push(tag)`. */
    private readonly _pages: NavPage[] = [];
    /** The live navigation stack (last entry = visible). */
    private readonly _stack: NavPage[] = [];

    constructor() {
        super();

        this.className = 'adw-navigation-view';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));
    }

    /**
     * Register a page (optionally with a tag for `push(tag)`). The FIRST page added
     * is auto-pushed so the view is never empty, matching `Adw.NavigationView`.
     */
    add(view: View, tag: string | null = null): void {
        const page: NavPage = { view, tag };
        view.className = `${view.className ?? ''} adw-navigation-page`.trim();
        view.visibility = 'collapse';
        GridLayout.setColumn(view, 0);
        GridLayout.setRow(view, 0);
        this.addChild(view);
        this._pages.push(page);

        if (this._stack.length === 0) {
            this._stack.push(page);
            this._applyVisible(false);
        }
    }

    /** Push a page (a previously-registered tag, or a fresh view) onto the stack. */
    push(pageOrTag: View | string): void {
        let page: NavPage | undefined;
        if (typeof pageOrTag === 'string') {
            page = this._pages.find((p) => p.tag === pageOrTag);
        } else {
            page = this._pages.find((p) => p.view === pageOrTag);
            if (!page) {
                this.add(pageOrTag);
                page = this._pages[this._pages.length - 1];
                // add() may have auto-pushed it as the first page — avoid double push.
                if (this._stack[this._stack.length - 1] === page) {
                    this._applyVisible(true);
                    return;
                }
            }
        }
        if (!page) return;
        this._stack.push(page);
        this._applyVisible(true);
    }

    /** Pop the top page. Returns `true` if a page was popped (stack keeps ≥1). */
    pop(): boolean {
        if (this._stack.length <= 1) return false;
        this._stack.pop();
        this._applyVisible(true);
        return true;
    }

    private _applyVisible(emit: boolean): void {
        const top = this._stack[this._stack.length - 1];
        for (const page of this._pages) {
            page.view.visibility = page === top ? 'visible' : 'collapse';
        }
        if (emit) {
            const data: NotifyVisiblePageEventData = {
                eventName: NOTIFY_VISIBLE_PAGE,
                object: this,
                tag: top?.tag ?? null,
                depth: this._stack.length,
            };
            this.notify(data);
        }
    }

    /** The currently-visible page view, or `null`. */
    get visiblePage(): View | null {
        return this._stack[this._stack.length - 1]?.view ?? null;
    }

    /** The currently-visible page tag, or `null`. */
    get visiblePageTag(): string | null {
        return this._stack[this._stack.length - 1]?.tag ?? null;
    }

    /** The current navigation stack depth. */
    get depth(): number {
        return this._stack.length;
    }
}
