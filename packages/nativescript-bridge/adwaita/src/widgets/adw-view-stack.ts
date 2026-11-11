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
// ROUTE D: `visible-child` and `visible-child-name` are declared properties. Both are
// seam-owned — `visible-child` is object-kind, `visible-child-name` is `explicitNotify` —
// because the measured emission order is `notify::visible-child` FIRST, then
// `notify::visible-child-name`, and a store-level "it changed, so notify" cannot produce
// that. The `ViewStackState` subscriber pushes both values silently and then emits the
// two notifies in order.
//
// FIDELITY: approximated. NS has no native page stack; pages swap by toggling
// `visibility` (`collapse`/`visible`) — instant, no cross-fade (the CSS subset has
// no transition). The page model + selection semantics are faithful.
//
// Reference: refs/libadwaita/src/adw-view-stack.c (Adw.ViewStack)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { TYPE_OBJECT } from '@gjsify/adwaita-core';
import type { View } from '@nativescript/core';
import { GridLayout, ItemSpec } from '@nativescript/core';
import { applyViewStackVisibility, createViewStackState, type AdwViewStackPageInfo } from './view-stack-state.js';
import { AdwViewStackPage } from './view-stack-page.js';
import { iconValueKind } from './icon-theme.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { pushDeclared, readDeclaredValue, withSignals, type GObjectNotify } from './signals.js';

// Re-exported so the widget module stays the one import site for the page type,
// as `widgets/index.ts` and every consumer already expect.
export type { AdwViewStackPageInfo };

/**
 * What a declared property's {@link DeclaredProperty.normalize} reads off the stack. Structural,
 * because `normalize` is handed a bare `object` while the instance may still be constructing
 * (the `ComboRowValues` precedent) — and because `_state` is private to the class, which a cast
 * to `AdwViewStack` could not reach.
 */
interface AdwViewStackValues {
    readonly _state: ReturnType<typeof createViewStackState>;
    visibleChildName: string | null;
    visibleChild: View | null;
}

export class AdwViewStack extends withSignals(GridLayout, {
    GTypeName: 'AdwViewStack',
    Properties: {
        // Object-kind makes this seam-owned for the same reason `AdwComboRow:selected-item`
        // is: the NativeScript `View` never enters a real GObject slot. The declared property
        // is the public door; `ViewStackState` is still the source of truth.
        //
        // MEASURED on GTK 4.22 / libadwaita 1.9.4: every selection move emits
        // `notify::visible-child` FIRST, then `notify::visible-child-name`. The property order
        // below IS that order, because the seam's `emittedSignals` lists declared properties
        // in declaration order.
        'visible-child': {
            kind: 'object',
            valueType: TYPE_OBJECT,
            explicitNotify: true,
            blurb: 'The currently visible child',
            normalize: (value, self) => {
                const stack = self as AdwViewStackValues;
                const child = readDeclaredValue('visible-child', 'object', value) as View | null;
                if (child === null) return stack.visibleChild;
                const at = stack._state.pages.findIndex((page) => page.content === child);
                if (at !== -1) stack._state.setVisibleIndex(at);
                return stack.visibleChild;
            },
        },
        'visible-child-name': {
            kind: 'string',
            explicitNotify: true,
            default: null,
            blurb: 'The name of the currently visible child',
            normalize: (value, self) => {
                const stack = self as AdwViewStackValues;
                const name = readDeclaredValue('visible-child-name', 'string', value) as string | null | undefined;
                if (name === null || name === undefined) return stack.visibleChildName;
                stack._state.setVisibleName(name);
                return stack._state.visibleName || null;
            },
        },
    },
}) {
    static readonly GTypeName: string = 'AdwViewStack';

    /**
     * No named placement: a stack's XML children are its pages, in order, as GtkBuildable's
     * untyped `<child>` is (`adw_view_stack_buildable_add_child`). An empty list, not an absent
     * one, so the builder refuses an authored slot by name instead of guessing one.
     */
    static readonly builderSlots: readonly string[] = [];

    /** `Adw.ViewStack:visible-child-name` — the visible page's name; `null` for none or an unnamed page. */
    declare visibleChildName: string | null;

    /** `Adw.ViewStack:visible-child` — the visible page's child, or `null`. */
    declare visibleChild: View | null;

    /** GJS's `notify('<prop>')` beside NativeScript's `notify({ eventName })`; see the seam. */
    declare notify: GObjectNotify;

    private readonly _state = createViewStackState();
    /**
     * The SVG-source icons pages were added with, by content view. The headless core
     * normalises an icon to a GTK NAME and turns anything that is not one token into
     * `''` — an SVG document included — so a switcher reading `page.icon` drew
     * `image-missing` for every page whose icon was handed in as source.
     */
    private readonly _sourceIcons = new Map<View, string>();

    constructor(props?: ConstructProps<AdwViewStack>) {
        super();

        this.className = 'adw-view-stack';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));

        this._state.subscribe(() => {
            applyViewStackVisibility(this._state);
            pushDeclared(this, 'visible-child', this._state.visiblePage?.content ?? null);
            pushDeclared(this, 'visible-child-name', this._state.visibleName || null);
            this.notify('visible-child');
            this.notify('visible-child-name');
        });

        applyConstructProps(this, props);
    }

    /**
     * Register a page. It becomes visible when nothing is selected yet — and,
     * unlike before, that auto-pick NOTIFIES, so a bound switcher highlights the
     * initial page without a manual `refresh()` (`add_page`,
     * adw-view-stack.c:1149-1151 → the notify at :1038-1039). Returns the page handle.
     */
    add(content: View, name: string, title?: string, icon?: string): AdwViewStackPageInfo {
        const page = this._state.addPage({ name, title, icon, content });
        this._rememberSourceIcon(content, icon);
        this._placePage(content);
        return page;
    }

    /** Put a page's view into the one cell and let the selection decide what shows. */
    private _placePage(content: View): void {
        GridLayout.setColumn(content, 0);
        GridLayout.setRow(content, 0);
        this.addChild(content);
        applyViewStackVisibility(this._state);
    }

    /**
     * An XML child — `adw_view_stack_buildable_add_child`: an {@link AdwViewStackPage} record
     * adds its child under the record's name, title, icon and badge state; any other view is
     * a page with no name, which is `adw_view_stack_add` (`name` NULL). Before this there was no
     * child door at all, and `LayoutBase`'s inherited one put every child into the grid
     * beside the pages, shown whatever the selection said.
     */
    _addChildFromBuilder(_name: string, view: View | AdwViewStackPage): void {
        if (!(view instanceof AdwViewStackPage)) {
            this.add(view, '');
            return;
        }
        const content = view.child;
        if (content === null) {
            // NativeScript's XML builder hands the record over before reading its child, so
            // the record adds itself once the child arrives (`_awaitChild` says why). A record
            // that never gets one never becomes a page, as `add_page` refuses it in C.
            view._awaitChild(this);
            return;
        }
        view._adoptBy(this);
        this._state.addPage({
            name: view.name,
            title: view.title,
            icon: view.iconName,
            content,
            visible: view.visible,
            badgeNumber: view.badgeNumber,
            needsAttention: view.needsAttention,
            useUnderline: view.useUnderline,
        });
        this._rememberSourceIcon(content, view.iconName);
        this._placePage(content);
    }

    private _rememberSourceIcon(content: View, icon: string | null | undefined): void {
        if (icon && iconValueKind(icon) === 'source') this._sourceIcons.set(content, icon);
    }

    /**
     * The icon each page carries as a switcher button shows it, in page order: the SVG
     * source it was added with, else the normalised name (`''` for none).
     */
    pageIcons(): string[] {
        return this._state.pages.map(
            (page) => (page.content ? this._sourceIcons.get(page.content) : undefined) ?? page.icon,
        );
    }

    /** Convenience alias matching `Adw.ViewStack.add_titled`. */
    add_titled(content: View, name: string, title: string): AdwViewStackPageInfo {
        return this.add(content, name, title);
    }

    /**
     * Register a titled page carrying an icon — `Adw.ViewStack.add_titled_with_icon`.
     *
     * The same call {@link add} already is, under the name the counterpart gives it. It
     * exists because the ARGUMENT ORDER is the thing a reader has to get right and this
     * port had no spelling that matched: `add(child, name, title, icon)` and
     * `adw_view_stack_add_titled_with_icon (stack, child, name, title, icon_name)` take
     * the same four values in the same order, so the alias is a rename and cannot drift
     * from the method it forwards to.
     */
    add_titled_with_icon(content: View, name: string, title: string, iconName: string): AdwViewStackPageInfo {
        return this.add(content, name, title, iconName);
    }

    /**
     * Remove a page and detach its content view — `adw_view_stack_remove`. Returns
     * whether anything was removed. When the removed page was the visible one the
     * stack ends up showing NOTHING and emits no event — `stack_remove` clears
     * `visible_child` without re-picking (adw-view-stack.c:1202-1203).
     *
     * Takes the CHILD, as the GIR verb does, or the page name the port's headless list
     * keys on (view-stack-state.ts) — a caller ported off GJS holds the view, and one
     * that came through {@link visibleChildName} or an XML attribute holds the name.
     */
    remove(child: View | string): boolean {
        const name = typeof child === 'string' ? child : (this._nameOf(child) ?? '');
        const page = this._state.pages[this._state.indexOfName(name)];
        const content = page?.content;
        const wasVisible = this._state.visiblePage?.content === content;
        if (!this._state.removePage(name)) return false;
        if (content) {
            this.removeChild(content);
            this._sourceIcons.delete(content);
            // The stack collapsed this page while another was shown; a page that leaves the stack
            // (to sit in a column, as Learn6502's wide layout does) must not stay hidden.
            content.visibility = 'visible';
        }
        if (wasVisible) {
            // `adw_view_stack_remove` clears the visible child without re-picking and without
            // emitting `notify::visible-child` / `notify::visible-child-name`.
            pushDeclared(this, 'visible-child', null);
            pushDeclared(this, 'visible-child-name', null);
        }
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

    /** The name of the page holding `child`, or `null` when it is not one of ours. */
    private _nameOf(child: View): string | null {
        for (const page of this._state.pages) if (page.content === child) return page.name;
        return null;
    }

    /** All registered pages, in add order (a bound switcher reads this). */
    get pages(): readonly AdwViewStackPageInfo[] {
        return this._state.pages;
    }

    /**
     * The visible page's position, `-1` when nothing is selected.
     *
     * A REPORT, NOT A DOOR (ADR 0048). `Adw.ViewStack` selects by NAME, and an ordinal
     * is derived: an insertion before the visible page increments it, a reorder rewrites
     * it and a removal decrements it — the three cases `ViewStackState` carries code for.
     * So it is safe to read at a moment and unsafe to hold, and selecting is
     * {@link visibleChildName}.
     */
    get visibleChildIndex(): number {
        return this._state.visibleIndex;
    }

    /**
     * Show the page at position `n`. Returns whether the selection moved.
     *
     * THE ORDINAL IS A CALL, NOT A PROPERTY (ADR 0048). It resolves against the page list
     * as it is at THIS moment and keeps nothing, which is the whole difference from the
     * setter it replaces: a held index silently comes to mean another page after an
     * insert, a reorder or a removal. Port-owned — measured, `refs/libadwaita` gives
     * `AdwViewStack` no ordinal API at all — and named for the `selectNthPage` the tab
     * view already has, so the two widgets ask the same question the same way.
     *
     * A non-integer or out-of-range `n` selects nothing; the guard is the core's
     * ({@link ViewStackState.setVisibleIndex}) and is pinned by the shared vectors.
     */
    selectNthPage(n: number): boolean {
        return this._state.setVisibleIndex(n);
    }

    /** `adw_view_stack_add_named`. */
    add_named(content: View, name: string | null): AdwViewStackPageInfo {
        return this.add(content, name ?? '');
    }

    /** `adw_view_stack_get_visible_child_name` — `null` when nothing is selected. */
    get_visible_child_name(): string | null {
        return this.visibleChildName;
    }

    /** `adw_view_stack_set_visible_child_name`. */
    set_visible_child_name(name: string): void {
        this.visibleChildName = name;
    }

    /** `adw_view_stack_get_visible_child`. */
    get_visible_child(): View | null {
        return this.visibleChild;
    }

    /** `adw_view_stack_set_visible_child`; a view that is not a page of this stack selects nothing. */
    set_visible_child(child: View): void {
        this.visibleChild = child;
    }
}
