// AdwSplitViewBase — shared base for the NativeScript split-view widgets.
//
// `Adw.NavigationSplitView` and `Adw.OverlaySplitView` both pair a sidebar with a
// content pane and collapse on narrow widths; they differ only in HOW the sidebar
// behaves when collapsed (the navigation split-view swaps the visible pane like a
// nav stack; the overlay split-view slides the sidebar OVER the content). This base
// captures the shared sidebar/content slots + the `collapsed` / `showSidebar`
// state; the subclasses override `_applyLayout()` for their collapse behaviour.
//
// FIDELITY: approximated. NS has no responsive two-pane container and no automatic
// width breakpoint, so `collapsed` is a manual flag the consumer toggles (e.g.
// from an orientation/size listener) rather than an automatic narrow-width
// collapse. Slide-over is an instant `visibility`/overlay swap (no slide
// animation — the CSS subset has no transform transition).
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_navigation-split-view.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, View, type EventData } from '@nativescript/core';

/** Event name emitted when the sidebar visibility changes. */
export const NOTIFY_SHOW_SIDEBAR = 'notify::show-sidebar';

/** Payload of the `notify::show-sidebar` event. */
export interface NotifyShowSidebarEventData extends EventData {
    /** Whether the sidebar is currently shown. */
    showSidebar: boolean;
    /** Whether the view is in its collapsed (narrow) mode. */
    collapsed: boolean;
}

/** Default sidebar width, in DIPs. */
export const DEFAULT_SIDEBAR_WIDTH = 240;

export abstract class AdwSplitViewBase extends GridLayout {
    protected _sidebar: View | null = null;
    protected _content: View | null = null;
    protected _collapsed = false;
    protected _showSidebar = true;
    protected _sidebarWidth = DEFAULT_SIDEBAR_WIDTH;

    constructor(rootClass: string) {
        super();
        this.className = rootClass;
        this.addRow(new ItemSpec(1, 'star'));
        // Two columns: sidebar (auto) + content (*). Overlay subclass spans content.
        this.addColumn(new ItemSpec(1, 'auto'));
        this.addColumn(new ItemSpec(1, 'star'));
    }

    /** Subclass-specific layout application for the current collapsed/show state. */
    protected abstract _applyLayout(): void;

    /** Set (or replace) the sidebar pane. */
    setSidebar(view: View | null): void {
        if (this._sidebar) this.removeChild(this._sidebar);
        this._sidebar = view;
        if (view) {
            view.className = `${view.className ?? ''} adw-split-view-sidebar`.trim();
            view.width = this._sidebarWidth;
            this.addChild(view);
        }
        this._applyLayout();
    }

    /** Set (or replace) the content pane. */
    setContent(view: View | null): void {
        if (this._content) this.removeChild(this._content);
        this._content = view;
        if (view) {
            view.className = `${view.className ?? ''} adw-split-view-content`.trim();
            this.addChild(view);
        }
        this._applyLayout();
    }

    /** Show the sidebar (relevant in collapsed mode). */
    showSidebarPane(): void {
        this.showSidebar = true;
    }

    /** Hide the sidebar (relevant in collapsed mode). */
    hideSidebarPane(): void {
        this.showSidebar = false;
    }

    /** Whether the view is in collapsed (narrow / single-pane) mode. */
    get collapsed(): boolean {
        return this._collapsed;
    }

    set collapsed(value: boolean) {
        this._collapsed = !!value;
        this._applyLayout();
    }

    /** Whether the sidebar is shown. Toggling emits `notify::show-sidebar`. */
    get showSidebar(): boolean {
        return this._showSidebar;
    }

    set showSidebar(value: boolean) {
        const next = !!value;
        if (next === this._showSidebar) return;
        this._showSidebar = next;
        this._applyLayout();
        const data: NotifyShowSidebarEventData = {
            eventName: NOTIFY_SHOW_SIDEBAR,
            object: this,
            showSidebar: next,
            collapsed: this._collapsed,
        };
        this.notify(data);
    }

    /** The sidebar pane width, in DIPs. */
    get sidebarWidth(): number {
        return this._sidebarWidth;
    }

    set sidebarWidth(value: number) {
        this._sidebarWidth = Number.isFinite(value) && value > 0 ? value : DEFAULT_SIDEBAR_WIDTH;
        if (this._sidebar) this._sidebar.width = this._sidebarWidth;
    }

    /** The sidebar pane, or `null`. */
    get sidebar(): View | null {
        return this._sidebar;
    }

    /** The content pane, or `null`. */
    get content(): View | null {
        return this._content;
    }
}
