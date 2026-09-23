// AdwNavigationPage — one page of an `Adw.NavigationView` (or a split view's pane), for
// NativeScript.
//
// A REAL NativeScript `GridLayout` holding ONE child, as `AdwNavigationPage` is a bin
// around its `child`. What makes it a page and not a plain view is the three properties
// the navigation stack reads — `tag`, `title` and `can-pop` — which is why a view
// registered this way needs no side-channel: `AdwNavigationView._addChildFromBuilder`
// reads them off the page, where before a template-built page could carry no tag at all.
//
// A LATER WRITE REACHES THE STACK. `adw_navigation_page_set_tag` and friends update the
// view the page is in, so a page that was renamed after it was added is found by its new
// tag. The page remembers the view that registered it and forwards each write through the
// view's own setter, which keeps the stack's rules (a tag already taken is refused) in the
// one place that owns them.
//
// Reference: refs/libadwaita/src/adw-navigation-view.c (AdwNavigationPage, :625-690, :803)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';
import { GridLayout, ItemSpec } from '@nativescript/core';

import { builderSlotsOf } from './builder-slots.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';
import { xmlBoolean } from './xml-values.js';

/** The navigation view a page is registered in — the three setters it forwards to. */
export interface NavigationPageOwner {
    setPageTag(view: View, tag: string | null): boolean;
    setPageTitle(view: View, title: string): boolean;
    setPageCanPop(view: View, canPop: boolean): boolean;
}

export class AdwNavigationPage extends withSignals(GridLayout) {
    /**
     * `Adw.NavigationPage:child` is the one destination, so it is also the fallback: an
     * authored `child: …` and a bare child mean the same thing (adw-navigation-view.c:808).
     */
    static readonly builderSlots: readonly string[] = builderSlotsOf(['child'], 'child');

    private _child: View | null = null;
    private _tag: string | null = null;
    private _title = '';
    private _canPop = true;
    private _owner: NavigationPageOwner | null = null;

    constructor(props?: ConstructProps<AdwNavigationPage>) {
        super();
        this.className = 'adw-navigation-page';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));
        applyConstructProps(this, props);
    }

    /** Set (or clear) the page's content — `adw_navigation_page_set_child`. */
    set_child(view: View | null): void {
        if (this._child) this.removeChild(this._child);
        this._child = view;
        if (view) {
            GridLayout.setColumn(view, 0);
            GridLayout.setRow(view, 0);
            this.addChild(view);
        }
    }

    /** The page's content, or `null`. */
    get child(): View | null {
        return this._child;
    }

    /** XML inflation — every child is THE child, as the C's `add_child` makes it. */
    _addChildFromBuilder(_name: string, view: View): void {
        this.set_child(view);
    }

    /** `Adw.NavigationPage:tag` — how `push_by_tag` finds this page; `null` for none. */
    get tag(): string | null {
        return this._tag;
    }

    set tag(value: string | null) {
        this._tag = value;
        this._owner?.setPageTag(this, value);
    }

    /** `Adw.NavigationPage:title` — also the next page's back-button tooltip. */
    get title(): string {
        return this._title;
    }

    set title(value: string) {
        this._title = value ?? '';
        this._owner?.setPageTitle(this, this._title);
    }

    /** `Adw.NavigationPage:can-pop` — gates the back button and the shortcuts, not `pop()`. */
    get canPop(): boolean {
        return this._canPop;
    }

    set canPop(raw: boolean | string) {
        this._canPop = xmlBoolean(raw, this._canPop);
        this._owner?.setPageCanPop(this, this._canPop);
    }

    /** Called by the view that registered this page, so later writes reach its stack. */
    _setOwner(owner: NavigationPageOwner | null): void {
        this._owner = owner;
    }
}
