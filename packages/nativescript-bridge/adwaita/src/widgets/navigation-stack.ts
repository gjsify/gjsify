// AdwNavigationView for NativeScript — the pure half.
//
// The stack machine is HEADLESS in `@gjsify/adwaita-core` (ADR 0004): page registry,
// tag index, the static-vs-dynamic (`remove_on_pop`) lifecycle, the six mutators — all
// shared with `@gjsify/adwaita-web`. NativeScript-specific is the mapping onto a
// `GridLayout`: pages are overlaid children shown by toggling `visibility`, and the
// GObject signals become `notify()` events. No `@nativescript/core` value imports, so
// specs reach the real adapter off-device (AGENTS.md).
//
// NativeScript has no slide transition (the CSS subset carries no `transition` or
// `animation`), so every change settles at once: {@link NsNavigationStack} calls the
// core's `finishTransition()` seam immediately, which is what `adw_animation_skip` does
// in the C when `animate` is FALSE.
//
// Reference: refs/libadwaita/src/adw-navigation-view.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { NavigationViewState } from '@gjsify/adwaita-core';
import type {
    AdwNavigationPageProps,
    NavigationDiagnosticListener,
    NavigationShortcutResult,
    NavigationStackChange,
} from '@gjsify/adwaita-core';
import type { View } from '@nativescript/core';

/** Event name emitted when the visible page changes. Mirrors GObject `notify::visible-page`. */
export const NOTIFY_VISIBLE_PAGE = 'notify::visible-page';

/** Emitted after a page has been pushed. Mirrors `AdwNavigationView::pushed`. */
export const PUSHED = 'pushed';

/** Emitted after a page has been popped — once per popped page, top-first. Mirrors `AdwNavigationView::popped`. */
export const POPPED = 'popped';

/** Emitted after the whole stack has been replaced. Mirrors `AdwNavigationView::replaced`. */
export const REPLACED = 'replaced';

/** The NS visibility values a navigation page is toggled between. */
export type NsPageVisibility = 'visible' | 'collapse';

/** The CSS class every managed page carries, so `_navigation-view.scss` applies. */
export const NS_NAVIGATION_PAGE_CLASS = 'adw-navigation-page';

/** Append the navigation-page class to a view's existing class list. */
export function navigationPageClassName(existing: string | null | undefined): string {
    return `${existing ?? ''} ${NS_NAVIGATION_PAGE_CLASS}`.trim();
}

/** One signal the widget must re-emit, already reduced to its payload. */
export interface NsNavigationEvent {
    /** {@link PUSHED}, {@link POPPED}, {@link REPLACED} or {@link NOTIFY_VISIBLE_PAGE}. */
    name: string;
    /** The page the signal is about — `null` for `replaced` and for an emptied view. */
    page: View | null;
    /**
     * That page's tag, or `null`. A page destroyed by the SAME mutation has already
     * left the registry, so its tag reads `null` — the page handle is the reliable
     * identity in an event payload.
     */
    tag: string | null;
    /** The stack depth after the change. */
    depth: number;
}

/** The NativeScript side of the adapter: child management + signal emission. */
export interface NsNavigationHost {
    /** Add `view` as an overlaying child of the navigation grid. */
    attachPage(view: View): void;
    /** Remove `view` from the grid — the page has been destroyed. */
    detachPage(view: View): void;
    /** Show or hide a page. Instant: the NS CSS subset has no transition. */
    setPageVisibility(view: View, visibility: NsPageVisibility): void;
    /** Re-emit a GObject-style signal on the widget. */
    emit(event: NsNavigationEvent): void;
}

/** Construction seams. */
export interface NsNavigationStackOptions {
    /** Where rejected mutations go — the widget logs them; a test collects them. */
    onDiagnostic?: NavigationDiagnosticListener;
}

/**
 * `Adw.NavigationView` bound to a NativeScript view tree.
 *
 * Holds a `NavigationViewState` and keeps the grid's children in step with its
 * registry: a page enters the tree when it is registered and leaves when it is
 * destroyed, and the top of the stack is the only visible one. The widget keeps
 * ZERO navigation state.
 */
export class NsNavigationStack {
    private readonly _state: NavigationViewState<View>;
    private readonly _host: NsNavigationHost;
    /** The views currently in the grid — the mirror of the core's registry. */
    private readonly _attached = new Set<View>();
    private readonly _onDiagnostic: NavigationDiagnosticListener | undefined;
    private _pending: NavigationStackChange<View> | null = null;

    constructor(host: NsNavigationHost, options: NsNavigationStackOptions = {}) {
        this._host = host;
        this._onDiagnostic = options.onDiagnostic;
        this._state = new NavigationViewState<View>({ onDiagnostic: options.onDiagnostic });
        this._state.subscribe((change) => {
            this._pending = change;
        });
    }

    get visiblePage(): View | null {
        return this._state.visiblePage;
    }

    get visiblePageTag(): string | null {
        return this._state.visiblePageTag;
    }

    get depth(): number {
        return this._state.depth;
    }

    /** The navigation stack, bottom-first. */
    get stack(): readonly View[] {
        return this._state.stack;
    }

    /** Every registered page — static and dynamically pushed. */
    get pages(): readonly View[] {
        return this._state.pages;
    }

    /**
     * `Adw.NavigationView:animate-transitions`. Stored and honoured by the shared
     * change payload, but NativeScript paints the swap instantly either way — the
     * CSS subset has no transition, so a real app animates with `View.animate()`.
     */
    get animateTransitions(): boolean {
        return this._state.animateTransitions;
    }

    /** `Adw.NavigationView:pop-on-escape` — consulted by {@link popFromEscape}. */
    get popOnEscape(): boolean {
        return this._state.popOnEscape;
    }

    isRegistered(view: View): boolean {
        return this._state.isRegistered(view);
    }

    /** `view`'s tag, or `null`. */
    tagOf(view: View): string | null {
        return this._state.tagOf(view);
    }

    /** `view`'s title (`''` when untitled). */
    titleOf(view: View): string {
        return this._state.titleOf(view);
    }

    /** Whether `view` may be popped by a shortcut or a back button. */
    canPopOf(view: View): boolean {
        return this._state.canPopOf(view);
    }

    findPage(tag: string): View | null {
        return this._state.findPage(tag);
    }

    /** The page popping `view` would reveal, or `null`. */
    getPreviousPage(view: View): View | null {
        return this._state.getPreviousPage(view);
    }

    /** Whether a back button belongs on the visible page. */
    canGoBack(): boolean {
        return this._state.canGoBack();
    }

    /** The back button's tooltip — the previous page's title, or `null` when there is no button. */
    backButtonTooltip(fallback?: string): string | null {
        return this._state.backButtonTooltip(fallback);
    }

    /**
     * Register a page (optionally with a tag for `push(tag)`). A page added while
     * the stack is EMPTY is pushed automatically, so the view is never blank.
     */
    add(view: View, tag: string | null = null, options: Omit<AdwNavigationPageProps, 'tag'> = {}): boolean {
        const added = this._state.add(view, { ...options, tag });
        this._flush();
        return added;
    }

    /** Remove a page. One that is on the stack is removed when it is POPPED. */
    remove(view: View): boolean {
        const removed = this._state.remove(view);
        this._flush();
        return removed;
    }

    /** Push a page (a previously-registered tag, or a fresh view) onto the stack. */
    push(viewOrTag: View | string, options: AdwNavigationPageProps = {}): boolean {
        if (typeof viewOrTag === 'string') return this.pushByTag(viewOrTag);
        const pushed = this._state.push(viewOrTag, options);
        this._flush();
        return pushed;
    }

    pushByTag(tag: string): boolean {
        const pushed = this._state.pushByTag(tag);
        this._flush();
        return pushed;
    }

    /** Pop the top page. `can-pop` does NOT gate this — it gates the shortcuts. */
    pop(): boolean {
        const popped = this._state.pop();
        this._flush();
        return popped;
    }

    /** Pop until `view` is visible, in ONE transition. */
    popToPage(view: View): boolean {
        const popped = this._state.popToPage(view);
        this._flush();
        return popped;
    }

    popToTag(tag: string): boolean {
        const popped = this._state.popToTag(tag);
        this._flush();
        return popped;
    }

    /**
     * Replace the whole stack. String entries are resolved BEFORE anything is mutated,
     * so replacing the stack with the tag of a dynamically-pushed page keeps that page.
     */
    replace(
        entries: ReadonlyArray<View | string | null>,
        props?: (view: View) => AdwNavigationPageProps | undefined,
    ): void {
        const resolved = entries.map((entry) => {
            if (typeof entry !== 'string') return entry ?? null;
            const page = this._state.findPage(entry);
            if (page === null) this._onDiagnostic?.({ code: 'tag-not-found', tag: entry });
            return page;
        });
        this._state.replace(resolved, props);
        this._flush();
    }

    replaceWithTags(tags: readonly string[]): void {
        this._state.replaceWithTags(tags);
        this._flush();
    }

    /** Set a page's tag. Rejected when another page already owns it. */
    setTag(view: View, tag: string | null): boolean {
        return this._state.setTag(view, tag);
    }

    /** Set a page's title — the NEXT page's back-button tooltip. */
    setTitle(view: View, title: string): boolean {
        return this._state.setTitle(view, title);
    }

    /** Set a page's `can-pop`: gates the shortcuts and a back button, not `pop()`. */
    setCanPop(view: View, canPop: boolean): boolean {
        return this._state.setCanPop(view, canPop);
    }

    setAnimateTransitions(value: boolean): boolean {
        return this._state.setAnimateTransitions(value);
    }

    setPopOnEscape(value: boolean): boolean {
        return this._state.setPopOnEscape(value);
    }

    /** The `can-pop`-aware pop behind a hardware back button or Alt+Left. */
    popFromShortcut(): NavigationShortcutResult {
        const result = this._state.popFromShortcut();
        this._flush();
        return result;
    }

    /** Escape-to-pop, gated on `pop-on-escape`. */
    popFromEscape(): NavigationShortcutResult {
        const result = this._state.popFromEscape();
        this._flush();
        return result;
    }

    /**
     * Settle the transition (a no-op here beyond what {@link _flush} already did):
     * NativeScript never defers, so this exists only so the widget exposes the
     * whole `Adw.NavigationView` surface.
     */
    finishTransition(): readonly View[] {
        const destroyed = this._state.finishTransition();
        this._sync();
        return destroyed;
    }

    /**
     * Apply the change the last mutation produced: bring the view tree in step,
     * then re-emit the signals. The tree is synced FIRST so a listener reading
     * `visiblePage` from the event sees a mounted page.
     */
    private _flush(): void {
        const change = this._pending;
        this._pending = null;
        this._sync();
        if (change !== null) this._emit(change);
        // No slide transition on NativeScript, so the deferred destroy resolves
        // immediately — the same thing adw_animation_skip does when animate is FALSE.
        if (this._state.finishTransition().length > 0) this._sync();
    }

    private _emit(change: NavigationStackChange<View>): void {
        if (change.reason === 'add' || change.reason === 'push') {
            this._notify(PUSHED, change.visiblePage);
        } else if (change.reason === 'pop') {
            for (const page of change.popped) this._notify(POPPED, page);
        } else {
            this._notify(REPLACED, null);
        }
        if (change.previousVisiblePage !== change.visiblePage) {
            this._notify(NOTIFY_VISIBLE_PAGE, change.visiblePage);
        }
    }

    private _notify(name: string, page: View | null): void {
        this._host.emit({
            name,
            page,
            tag: page === null ? null : this._state.tagOf(page),
            depth: this._state.depth,
        });
    }

    /** Mirror the core's registry into the grid, then raise the top of the stack. */
    private _sync(): void {
        for (const view of this._state.pages) {
            if (this._attached.has(view)) continue;
            this._attached.add(view);
            this._host.attachPage(view);
        }
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: this loop DELETES from `_attached`, and a live Set iterator would skip the element after each removal
        for (const view of [...this._attached]) {
            if (this._state.isRegistered(view)) continue;
            this._attached.delete(view);
            this._host.detachPage(view);
        }
        const top = this._state.visiblePage;
        for (const view of this._attached) {
            this._host.setPageVisibility(view, view === top ? 'visible' : 'collapse');
        }
    }
}
