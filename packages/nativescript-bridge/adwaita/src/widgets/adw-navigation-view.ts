// AdwNavigationView — a Libadwaita-style navigation stack for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` that overlays its pages and shows only
// the top of the navigation stack. The stack machine itself is NOT here: it lives
// in `@gjsify/adwaita-core` (ADR 0004) and is reached through `navigation-stack.ts`,
// the `@nativescript/core`-free adapter that the spec suite can load off-device.
// This file is only the view-tree half — grid children, `visibility`, and turning
// stack changes into `notify()` events.
//
// FIDELITY: approximated. An NS `Frame` gives real native push/pop with the platform's
// slide animation but requires each page to be a `Page`/`Frame`-routed module — too
// heavy for a drop-in widget, and it imposes its own header chrome. This overlays plain
// `View`s in one `GridLayout` and shows the top via `visibility`. COMPROMISES: (1) no
// slide/back-swipe animation or gesture (the CSS subset has no transition; an app can
// wrap this in `view.animate()` or use a `Frame`); (2) no automatic back button — the
// consumer wires one to `pop()`, using `canGoBack()` / `backButtonTooltip()` for its
// visibility and label. The push/pop STACK SEMANTICS are faithful.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-navigation-view`.
// Reference: refs/libadwaita/src/adw-navigation-view.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_misc.scss (navigation-view transition shadows)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, type EventData, type View } from '@nativescript/core';
import { describeNavigationDiagnostic } from '@gjsify/adwaita-core';
import type { AdwNavigationPageProps, NavigationShortcutResult } from '@gjsify/adwaita-core';

import {
    NOTIFY_VISIBLE_PAGE,
    POPPED,
    PUSHED,
    REPLACED,
    NsNavigationStack,
    navigationPageClassName,
} from './navigation-stack.js';
import type { NsNavigationEvent } from './navigation-stack.js';
import { xmlBoolean } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

export { NOTIFY_VISIBLE_PAGE, POPPED, PUSHED, REPLACED };

/** Payload of every navigation signal — `pushed`, `popped`, `replaced`, `notify::visible-page`. */
export interface AdwNavigationEventData extends EventData {
    /** The page the signal is about, or `null` (`replaced`, or an emptied view). */
    page: View | null;
    /** That page's tag, or `null`. */
    tag: string | null;
    /** The current navigation stack depth. */
    depth: number;
}

/** Payload of the `notify::visible-page` event. */
export type NotifyVisiblePageEventData = AdwNavigationEventData;

export class AdwNavigationView extends GridLayout {
    private readonly _nav: NsNavigationStack;

    constructor(props?: ConstructProps<AdwNavigationView>) {
        super();

        this.className = 'adw-navigation-view';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));

        this._nav = new NsNavigationStack(
            {
                attachPage: (view) => {
                    view.className = navigationPageClassName(view.className);
                    GridLayout.setColumn(view, 0);
                    GridLayout.setRow(view, 0);
                    this.addChild(view);
                },
                detachPage: (view) => this.removeChild(view),
                setPageVisibility: (view, visibility) => {
                    view.visibility = visibility;
                },
                emit: (event) => this._emitNavigation(event),
            },
            {
                // The C prints these with g_critical; staying silent about a
                // rejected push or a duplicate tag is how the old copy hid them.
                onDiagnostic: (diagnostic) =>
                    console.warn(`[AdwNavigationView] ${describeNavigationDiagnostic(diagnostic)}`),
            },
        );

        applyConstructProps(this, props);
    }

    /**
     * Register a page (optionally with a tag for `push(tag)`). A page added while
     * the stack is EMPTY is pushed automatically, so the view is never blank —
     * which also re-arms after `replace([])`.
     */
    add(view: View, tag: string | null = null, options: Omit<AdwNavigationPageProps, 'tag'> = {}): boolean {
        return this._nav.add(view, tag, options);
    }

    /**
     * An XML child is a PAGE, registered in document order — so the first one is
     * pushed and the rest wait behind it, exactly as `add` already promises.
     *
     * Registered with NO TAG: `add(view)` defaults it to `null`, and nothing in the
     * markup can supply one, because a `tag` is this widget's own idea rather than a
     * property of the child. `pushByTag` is therefore not reachable for a page that
     * came from a template; a loader that wants it registers the page itself, or
     * calls `setPageTag` on one it looked up. What XML contributes is the tree.
     */
    _addChildFromBuilder(_name: string, view: View): void {
        this.add(view);
    }

    /**
     * Remove a page (`AdwNavigationView.remove`). One that is on the stack is
     * removed once it is POPPED. Named `removePage` rather than `remove` so the
     * widget never shadows a member of NativeScript's own `ViewBase`, the same
     * reason `@gjsify/adwaita-web` avoids `HTMLElement.remove()`.
     */
    removePage(view: View): boolean {
        return this._nav.remove(view);
    }

    /** Push a page (a previously-registered tag, or a fresh view) onto the stack. */
    push(viewOrTag: View | string, options: AdwNavigationPageProps = {}): boolean {
        return this._nav.push(viewOrTag, options);
    }

    /** Push the page carrying `tag`. */
    pushByTag(tag: string): boolean {
        return this._nav.pushByTag(tag);
    }

    /**
     * Pop the top page. Returns `true` if a page was popped (the stack keeps ≥1).
     * `can-pop` does NOT gate this — it gates {@link popFromShortcut} and the back
     * button, exactly as libadwaita documents.
     */
    pop(): boolean {
        return this._nav.pop();
    }

    /** Pop until `view` is visible, in ONE transition. */
    popToPage(view: View): boolean {
        return this._nav.popToPage(view);
    }

    /** Pop until the page carrying `tag` is visible. */
    popToTag(tag: string): boolean {
        return this._nav.popToTag(tag);
    }

    /** Replace the whole stack; the last entry becomes visible. Never animates. */
    replace(entries: ReadonlyArray<View | string | null>): void {
        this._nav.replace(entries);
    }

    /** Replace the stack with the pages carrying `tags`. */
    replaceWithTags(tags: readonly string[]): void {
        this._nav.replaceWithTags(tags);
    }

    /** The page with this tag, or `null`. */
    findPage(tag: string): View | null {
        return this._nav.findPage(tag);
    }

    /** The page popping `view` would reveal, or `null`. */
    getPreviousPage(view: View): View | null {
        return this._nav.getPreviousPage(view);
    }

    /** Set a page's tag. Rejected when another page already owns it. */
    setPageTag(view: View, tag: string | null): boolean {
        return this._nav.setTag(view, tag);
    }

    /** Set a page's title — used as the NEXT page's back-button tooltip. */
    setPageTitle(view: View, title: string): boolean {
        return this._nav.setTitle(view, title);
    }

    /** Set a page's `can-pop`, gating the shortcuts and a back button. */
    setPageCanPop(view: View, canPop: boolean): boolean {
        return this._nav.setCanPop(view, canPop);
    }

    /** Whether a back button belongs on the visible page. */
    canGoBack(): boolean {
        return this._nav.canGoBack();
    }

    /** The back button's label/tooltip — the previous page's title, or `null` when there is none. */
    backButtonTooltip(fallback?: string): string | null {
        return this._nav.backButtonTooltip(fallback);
    }

    /** The `can-pop`-aware pop, for a hardware/software back button. */
    popFromShortcut(): NavigationShortcutResult {
        return this._nav.popFromShortcut();
    }

    /** Escape-to-pop, gated on {@link popOnEscape}. */
    popFromEscape(): NavigationShortcutResult {
        return this._nav.popFromEscape();
    }

    /** The currently-visible page view, or `null`. */
    get visiblePage(): View | null {
        return this._nav.visiblePage;
    }

    /** The currently-visible page tag, or `null`. */
    get visiblePageTag(): string | null {
        return this._nav.visiblePageTag;
    }

    /** The current navigation stack depth. */
    get depth(): number {
        return this._nav.depth;
    }

    /** The navigation stack, bottom-first. */
    get navigationStack(): readonly View[] {
        return this._nav.stack;
    }

    /** Every registered page — static and dynamically pushed. */
    get pages(): readonly View[] {
        return this._nav.pages;
    }

    /**
     * `Adw.NavigationView:animate-transitions`. Kept for API parity: the NS CSS
     * subset has no transition, so the swap is instant either way.
     */
    get animateTransitions(): boolean {
        return this._nav.animateTransitions;
    }

    set animateTransitions(raw: boolean | string) {
        const value = xmlBoolean(raw, this.animateTransitions);
        this._nav.setAnimateTransitions(value);
    }

    /** `Adw.NavigationView:pop-on-escape` — consulted by {@link popFromEscape}. */
    get popOnEscape(): boolean {
        return this._nav.popOnEscape;
    }

    set popOnEscape(raw: boolean | string) {
        const value = xmlBoolean(raw, this.popOnEscape);
        this._nav.setPopOnEscape(value);
    }

    private _emitNavigation(event: NsNavigationEvent): void {
        const data: AdwNavigationEventData = {
            eventName: event.name,
            object: this,
            page: event.page,
            tag: event.tag,
            depth: event.depth,
        };
        this.notify(data);
    }
}
