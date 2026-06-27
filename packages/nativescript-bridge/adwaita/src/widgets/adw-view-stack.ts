// AdwViewStack — a Libadwaita-style view stack for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` that overlays its named pages and
// shows exactly one at a time. Mirrors `Adw.ViewStack`: pages are registered with
// `add(content, name, title?, icon?)`, the visible page is selected by `name` or
// index, and a `notify::visible-child` event fires on change. Unlike the coupled
// `AdwViewSwitcher` (which bundles its own button rail), `AdwViewStack` is a pure
// CONTENT container — a separate `AdwViewSwitcher` / `AdwViewSwitcherBar` binds to
// it via its `stack` property, exactly as in libadwaita. This decoupling is what
// lets the switcher live in a header bar (wide) or a bottom bar (narrow) while the
// stack fills the window body.
//
// FIDELITY: approximated. NS has no native page stack; pages swap by toggling
// `visibility` (`collapse`/`visible`) — instant, no cross-fade (the CSS subset has
// no transition). The page model + selection semantics are faithful.
//
// Reference: refs/libadwaita/src/view-stack (Adw.ViewStack)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, View, type EventData } from '@nativescript/core';

/** Event name emitted when the visible child changes. Mirrors GObject `notify::visible-child`. */
export const NOTIFY_VISIBLE_CHILD = 'notify::visible-child';

/** Payload of the {@link NOTIFY_VISIBLE_CHILD} event. */
export interface NotifyVisibleChildEventData extends EventData {
    /** The newly-visible page's index. */
    index: number;
    /** The newly-visible page's name. */
    name: string;
    /** The newly-visible page's title. */
    title: string;
}

/** One page registered with an {@link AdwViewStack}. */
export interface AdwViewStackPage {
    /** Stable identifier used by `visibleChildName` / switcher binding. */
    name: string;
    /** Human-facing title shown in a bound switcher button. */
    title: string;
    /** Optional Adwaita symbolic SVG shown in a bound switcher button. */
    icon?: string;
    /** The page content view, shown when this page is selected. */
    content: View;
}

export class AdwViewStack extends GridLayout {
    private readonly _pages: AdwViewStackPage[] = [];
    private _visibleIndex = 0;

    constructor() {
        super();

        this.className = 'adw-view-stack';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));
    }

    /**
     * Register a page. The FIRST page added becomes visible automatically so the
     * stack is never empty, matching `Adw.ViewStack`. Returns the page handle.
     */
    add(content: View, name: string, title?: string, icon?: string): AdwViewStackPage {
        const page: AdwViewStackPage = { name, title: title ?? name, icon, content };
        content.visibility = this._pages.length === 0 ? 'visible' : 'collapse';
        GridLayout.setColumn(content, 0);
        GridLayout.setRow(content, 0);
        this.addChild(content);
        this._pages.push(page);
        return page;
    }

    /** Convenience alias matching `Adw.ViewStack.add_titled`. */
    addTitled(content: View, name: string, title: string): AdwViewStackPage {
        return this.add(content, name, title);
    }

    /** All registered pages, in add order (a bound switcher reads this). */
    get pages(): readonly AdwViewStackPage[] {
        return this._pages;
    }

    /** The visible page index. Swaps the visible page + emits `notify::visible-child`. */
    get visibleChildIndex(): number {
        return this._visibleIndex;
    }

    set visibleChildIndex(value: number) {
        if (!Number.isFinite(value) || value < 0 || value >= this._pages.length) return;
        if (value === this._visibleIndex) return;
        this._visibleIndex = value;
        this._apply(true);
    }

    /** The visible page name (`Adw.ViewStack.visible-child-name`). */
    get visibleChildName(): string {
        return this._pages[this._visibleIndex]?.name ?? '';
    }

    set visibleChildName(name: string) {
        const idx = this._pages.findIndex((p) => p.name === name);
        if (idx >= 0) this.visibleChildIndex = idx;
    }

    /** The visible page content view, or `null`. */
    get visibleChild(): View | null {
        return this._pages[this._visibleIndex]?.content ?? null;
    }

    private _apply(emit: boolean): void {
        this._pages.forEach((page, i) => {
            page.content.visibility = i === this._visibleIndex ? 'visible' : 'collapse';
        });
        if (emit) {
            const page = this._pages[this._visibleIndex];
            const data: NotifyVisibleChildEventData = {
                eventName: NOTIFY_VISIBLE_CHILD,
                object: this,
                index: this._visibleIndex,
                name: page?.name ?? '',
                title: page?.title ?? '',
            };
            this.notify(data);
        }
    }
}
