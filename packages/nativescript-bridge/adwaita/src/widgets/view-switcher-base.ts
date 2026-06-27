// AdwViewSwitcherBase — shared base for the NativeScript view-switching widgets.
//
// `Adw.ViewSwitcher`, `Adw.InlineViewSwitcher`, and (the tab-bar half of)
// `Adw.TabView` all reduce to the same primitive: a horizontal bar of mutually-
// exclusive buttons, each bound to one page in a content stack, with exactly one
// page visible at a time. This base captures that shared logic so the concrete
// widgets only differ by CSS class (pill vs flat vs tab look) and chrome.
//
// Each switcher button is a REAL tappable NS `StackLayout` holding an optional
// Adwaita symbolic `AdwIcon` + a `Label` — matching the native view switchers,
// whose buttons show icon + label (not text alone). Press feedback is wired with
// {@link attachRowPressFeedback} (NS only auto-applies `:highlighted` to `Button`,
// and these buttons are layouts). Subclasses can append per-button chrome (e.g. a
// tab close button) via {@link _buildButtonExtras} / {@link _applyButtonState}.
//
// FIDELITY: approximated. NS has no `Adw.ViewStack`; pages are swapped by toggling
// `visibility` (`collapse`/`visible`) — instant, no cross-fade (the CSS subset has
// no transition). The selected button is marked with the `.active` class.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_view-switcher.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, StackLayout, View, type EventData } from '@nativescript/core';
import { AdwIcon } from './adw-icon.js';
import { attachRowPressFeedback } from './row-press.js';

/** Event name emitted when the selected view changes. Mirrors GObject `notify::selected`. */
export const NOTIFY_SELECTED = 'notify::selected';

/** Payload of the `notify::selected` event. */
export interface NotifyViewSelectedEventData extends EventData {
    /** The newly-selected view index. */
    selected: number;
    /** The newly-selected view's title. */
    title: string;
}

/** One page registered with a {@link AdwViewSwitcherBase}. */
export interface AdwViewPage {
    /** The switcher button label. */
    title: string;
    /** The page content view, shown when this page is selected. */
    content: View;
    /** Optional Adwaita symbolic SVG shown left of the label in the switcher button. */
    icon?: string;
}

/**
 * Shared base: a switcher bar (row 0) + a content area (row 1), one page visible.
 * Subclasses set the bar/button CSS classes for their look.
 */
export abstract class AdwViewSwitcherBase extends GridLayout {
    /** The horizontal switcher bar holding the buttons. */
    protected readonly _bar: StackLayout;
    /** The content area where the selected page is shown. */
    protected readonly _contentArea: GridLayout;
    protected readonly _pages: AdwViewPage[] = [];
    /** The tappable button containers (one per page), in bar order. */
    protected readonly _buttons: StackLayout[] = [];
    protected _selected = 0;

    /** CSS class applied to the switcher bar — subclass-specific. */
    protected abstract get barClass(): string;
    /** CSS class applied to each switcher button — subclass-specific. */
    protected abstract get buttonClass(): string;

    constructor(rootClass: string) {
        super();

        this.className = rootClass;
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'auto')); // bar
        this.addRow(new ItemSpec(1, 'star')); // content

        const bar = new StackLayout();
        bar.orientation = 'horizontal';
        bar.horizontalAlignment = 'center';
        GridLayout.setRow(bar, 0);
        this.addChild(bar);
        this._bar = bar;

        const contentArea = new GridLayout();
        contentArea.addColumn(new ItemSpec(1, 'star'));
        contentArea.addRow(new ItemSpec(1, 'star'));
        GridLayout.setRow(contentArea, 1);
        this.addChild(contentArea);
        this._contentArea = contentArea;
    }

    /** Initialise the bar class after the subclass fields are ready. */
    protected _initClasses(): void {
        this._bar.className = this.barClass;
    }

    /** Register the view pages. Rebuilds the switcher bar + content stack. */
    setViews(pages: AdwViewPage[]): void {
        // Clear existing.
        for (const btn of this._buttons) this._bar.removeChild(btn);
        this._buttons.length = 0;
        for (const page of this._pages) this._contentArea.removeChild(page.content);
        this._pages.length = 0;

        for (const page of pages) {
            this._pages.push(page);

            const index = this._buttons.length;
            const btn = new StackLayout();
            btn.orientation = 'horizontal';
            btn.className = this.buttonClass;
            btn.horizontalAlignment = 'center';

            if (page.icon) {
                const icon = new AdwIcon();
                icon.className = `${icon.className} ${this.buttonClass}-icon`.trim();
                icon.verticalAlignment = 'middle';
                icon.icon = page.icon;
                btn.addChild(icon);
            }

            const label = new Label();
            label.text = page.title;
            label.className = `${this.buttonClass}-label`;
            label.verticalAlignment = 'middle';
            btn.addChild(label);

            // Let subclasses append per-button chrome (e.g. a tab close button).
            this._buildButtonExtras(btn, page, index);

            attachRowPressFeedback(btn);
            btn.addEventListener('tap', () => {
                this.selected = index;
            });
            this._bar.addChild(btn);
            this._buttons.push(btn);

            GridLayout.setColumn(page.content, 0);
            GridLayout.setRow(page.content, 0);
            this._contentArea.addChild(page.content);
        }

        if (this._selected >= this._pages.length) this._selected = 0;
        this._applySelection();
    }

    /** Show only the selected page; mark its button active. */
    protected _applySelection(): void {
        this._pages.forEach((page, i) => {
            page.content.visibility = i === this._selected ? 'visible' : 'collapse';
        });
        this._buttons.forEach((btn, i) => {
            const active = i === this._selected;
            btn.className = active ? `${this.buttonClass} active` : this.buttonClass;
            this._applyButtonState(btn, i, active);
        });
    }

    /**
     * Hook: append extra chrome to a freshly-built button (after icon + label).
     * Default no-op. Subclasses (e.g. {@link AdwTabView}) override to add a close
     * button. The button is the tappable `StackLayout` container.
     */
    protected _buildButtonExtras(_button: StackLayout, _page: AdwViewPage, _index: number): void {
        // no-op by default
    }

    /**
     * Hook: react to a button's active/inactive state on every selection change.
     * Default no-op. Subclasses override to e.g. show the close button only on the
     * active tab.
     */
    protected _applyButtonState(_button: StackLayout, _index: number, _active: boolean): void {
        // no-op by default
    }

    /** The registered view pages. */
    get views(): AdwViewPage[] {
        return this._pages;
    }

    set views(pages: AdwViewPage[]) {
        this.setViews(Array.isArray(pages) ? pages : []);
    }

    /** The selected view index. Swaps the visible page + emits `notify::selected`. */
    get selected(): number {
        return this._selected;
    }

    set selected(value: number) {
        const next = Number.isFinite(value) ? value : 0;
        if (next === this._selected || next < 0 || next >= this._pages.length) {
            // Still apply on first set (when pages just registered) but don't emit.
            return;
        }
        this._selected = next;
        this._applySelection();
        const data: NotifyViewSelectedEventData = {
            eventName: NOTIFY_SELECTED,
            object: this,
            selected: next,
            title: this._pages[next]?.title ?? '',
        };
        this.notify(data);
    }
}
