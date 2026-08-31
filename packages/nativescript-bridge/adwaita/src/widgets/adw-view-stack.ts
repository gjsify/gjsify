// AdwViewStack — a Libadwaita-style view stack for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` that overlays its named pages and shows
// exactly one at a time. Unlike the coupled `AdwViewSwitcher` (which bundles its own
// button rail) this is a pure CONTENT container that a separate `AdwViewSwitcher` /
// `AdwViewSwitcherBar` binds to via its `stack` property, which is what lets the
// switcher sit in a header bar (wide) or a bottom bar (narrow) while the stack fills
// the window body.
//
// The SELECTION is HEADLESS in `@gjsify/adwaita-core` (ADR 0004) as `ViewStackState`,
// shared with the `@gjsify/adwaita-web` twin and pinned by the conformance vectors;
// `view-stack-state.ts` holds the NS projection onto `View.visibility`. This class is
// the `GridLayout` wiring only.
//
// FIDELITY: approximated. NS has no native page stack; pages swap by toggling
// `visibility` (`collapse`/`visible`) — instant, no cross-fade (the CSS subset has
// no transition). The page model + selection semantics are faithful.
//
// Reference: refs/libadwaita/src/adw-view-stack.c (Adw.ViewStack)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';
import { GridLayout, ItemSpec, type EventData } from '@nativescript/core';
import {
    applyViewStackVisibility,
    createViewStackState,
    viewStackNotifyPayload,
    type AdwViewStackPage,
    type ViewStackNotifyPayload,
} from './view-stack-state.js';
import { xmlNumber } from './xml-values.js';

// Re-exported so the widget module stays the one import site for the page type,
// as `widgets/index.ts` and every consumer already expect.
export type { AdwViewStackPage };

/** Event name emitted when the visible child changes. Mirrors GObject `notify::visible-child`. */
export const NOTIFY_VISIBLE_CHILD = 'notify::visible-child';

/**
 * Payload of the {@link NOTIFY_VISIBLE_CHILD} event. `index` is `-1` and
 * `name`/`title` are `''` when nothing is selected — the state an empty stack, a
 * fully-hidden stack and a removed visible page all land in.
 */
export interface NotifyVisibleChildEventData extends EventData, ViewStackNotifyPayload {}

export class AdwViewStack extends GridLayout {
    private readonly _state = createViewStackState();

    constructor() {
        super();

        this.className = 'adw-view-stack';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));

        this._state.subscribe((change) => {
            applyViewStackVisibility(this._state);
            const data: NotifyVisibleChildEventData = {
                eventName: NOTIFY_VISIBLE_CHILD,
                object: this,
                ...viewStackNotifyPayload(change),
            };
            this.notify(data);
        });
    }

    /**
     * Register a page. It becomes visible when nothing is selected yet — and,
     * unlike before, that auto-pick NOTIFIES, so a bound switcher highlights the
     * initial page without a manual `refresh()` (`add_page`,
     * adw-view-stack.c:1149-1151 → the notify at :1038-1039). Returns the page handle.
     */
    add(content: View, name: string, title?: string, icon?: string): AdwViewStackPage {
        const page = this._state.addPage({ name, title, icon, content });
        GridLayout.setColumn(content, 0);
        GridLayout.setRow(content, 0);
        this.addChild(content);
        applyViewStackVisibility(this._state);
        return page;
    }

    /** Convenience alias matching `Adw.ViewStack.add_titled`. */
    addTitled(content: View, name: string, title: string): AdwViewStackPage {
        return this.add(content, name, title);
    }

    /**
     * Remove the first page named `name` and detach its content view. Returns
     * whether anything was removed. When the removed page was the visible one the
     * stack ends up showing NOTHING and emits no event — `stack_remove` clears
     * `visible_child` without re-picking (adw-view-stack.c:1202-1203).
     */
    removePage(name: string): boolean {
        const content = this._state.pages[this._state.indexOfName(name)]?.content;
        if (!this._state.removePage(name)) return false;
        if (content) this.removeChild(content);
        applyViewStackVisibility(this._state);
        return true;
    }

    /**
     * Show or hide a page (`AdwViewStackPage:visible`). Returns whether the
     * SELECTION moved: hiding the visible page falls back to the next visible one
     * and making a page visible while nothing is selected selects it
     * (`update_child_visible`, adw-view-stack.c:1061-1082).
     */
    setPageVisible(name: string, visible: boolean): boolean {
        const moved = this._state.setPageVisible(name, visible);
        applyViewStackVisibility(this._state);
        return moved;
    }

    /** All registered pages, in add order (a bound switcher reads this). */
    get pages(): readonly AdwViewStackPage[] {
        return this._state.pages;
    }

    /** The visible page index, `-1` when nothing is selected. Swaps the visible page + emits. */
    get visibleChildIndex(): number {
        return this._state.visibleIndex;
    }

    set visibleChildIndex(raw: number | string) {
        const value = xmlNumber(raw, this.visibleChildIndex);
        this._state.setVisibleIndex(value);
    }

    /** The visible page name (`Adw.ViewStack.visible-child-name`), `''` for none. */
    get visibleChildName(): string {
        return this._state.visibleName;
    }

    set visibleChildName(name: string | null | undefined) {
        this._state.setVisibleName(name);
    }

    /** The visible page content view, or `null`. */
    get visibleChild(): View | null {
        return this._state.visiblePage?.content ?? null;
    }
}
