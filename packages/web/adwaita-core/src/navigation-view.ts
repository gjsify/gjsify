// Adwaita navigation-view state machine — headless (ADR 0004).
//
// `Adw.NavigationView` is almost entirely bookkeeping: a page REGISTRY with a tag
// index, an ordered STACK over that registry, a static-vs-dynamic (`remove_on_pop`)
// ownership lifecycle, and six mutators — add / remove / push / pop / pop-to / replace
// — each with precise reject conditions. Only "show the top of the stack" plus the
// spring animation is rendering.
//
// Four rules that are easy to get wrong:
// - `pop()` IGNORES `can-pop`: the property gates shortcuts, gestures and the
// header-bar back button only, and the docs say a manual `pop()` still works;
// - `replace()` resolves string entries BEFORE purging dynamic pages, so
// `replace(['tag-of-a-pushed-page'])` works;
// - `push()` refuses a page already on the stack, so `push(v)` twice cannot produce
// `[v, v]`;
// - a dynamically-pushed page is DESTROYED on pop; a statically added one survives.
//
// The back-button derivation lives in `adw-back-button.c`, not in the view.
//
// The two seams follow the rest of this package: {@link NavigationViewState.subscribe}
// is the per-instance observable (as `ExpanderState`/`ComboState` in `rows.ts`), and
// {@link NavigationViewState.finishTransition} is the injected TIMING seam standing in
// for `AdwAnimation`'s "done" callback — the deferred destroy of the outgoing page is a
// lifecycle rule that merely happens to be scheduled by the animation.
//
// The page handle `P` is opaque on purpose: a DOM element for `@gjsify/adwaita-web`,
// a NativeScript `View` for `@gjsify/adwaita-nativescript`. Stack membership is
// pointer identity, exactly like the C `GListStore`.
//
// Reference: refs/libadwaita/src/adw-navigation-view.c
// Reference: refs/libadwaita/src/adw-back-button.c (update_page, query_tooltip)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** The three headless `AdwNavigationPage` properties a renderer registers a page with. */
export interface AdwNavigationPageProps {
    /**
     * `AdwNavigationPage:tag` — unique within one view, or `null` for untagged.
     * `''` is a legal tag: the C tag table is a plain `g_str_hash` table and only
     * a NULL tag is skipped (add_page).
     */
    tag?: string | null;
    /** `AdwNavigationPage:title` — defaults to `''`, never null (adw_navigation_page_init). */
    title?: string;
    /** `AdwNavigationPage:can-pop` — defaults to `true` (adw_navigation_page_init). */
    canPop?: boolean;
}

/**
 * Why the stack moved. Maps 1:1 onto the C signals so a renderer can re-emit
 * them without re-deriving the cause: `'add'`/`'push'` → `::pushed`, `'pop'` →
 * one `::popped` per entry in {@link NavigationStackChange.popped}, `'replace'` →
 * `::replaced`. `'add'` is split out from `'push'` only because it is the
 * auto-push add_page performs, which is never animated.
 */
export type NavigationChangeReason = 'add' | 'push' | 'pop' | 'replace';

/** One stack mutation, as a single payload. */
export interface NavigationStackChange<P> {
    /** The new navigation stack, bottom-first (`adw_navigation_view_get_navigation_stack`). */
    stack: readonly P[];
    /** The new visible page — the top of {@link stack} — or `null` for an empty stack. */
    visiblePage: P | null;
    /** {@link visiblePage}'s tag, or `null`. Never `''` for an untagged page. */
    visiblePageTag: string | null;
    /**
     * The page that was visible before this mutation. `previousVisiblePage !==
     * visiblePage` is exactly the condition under which libadwaita notifies
     * `visible-page` — including the `replace()` corner where the old visible
     * page was destroyed rather than switched away from (replace).
     */
    previousVisiblePage: P | null;
    /** Why the stack moved. */
    reason: NavigationChangeReason;
    /**
     * The popped pages, TOP-FIRST — `::popped` is emitted in this order.
     * pop_from_stack builds the list with `g_slist_prepend` while walking
     * bottom-up, then iterates it forward. Always empty unless `reason` is `'pop'`.
     */
    popped: readonly P[];
    /** Pages unregistered by this mutation — the renderer destroys their views now. */
    removed: readonly P[];
    /**
     * The outgoing visible page, destroyed only once the transition finishes
     * (pop_from_stack skips it; transition_done_cb does it). The
     * renderer hands it back by calling {@link NavigationViewState.finishTransition}.
     */
    removeAfterTransition: P | null;
    /**
     * Whether this transition animates. `false` for the auto-push (add_page),
     * for every `replace()` (replace), and whenever there is no outgoing page
     * to slide away from (switch_page).
     */
    animate: boolean;
    /** Transition direction: `true` when the new page comes from BELOW (pop/replace). */
    pop: boolean;
    /**
     * Whether `visible-page-tag` re-notifies: switch_page notifies only
     * when the outgoing OR the incoming page carries a tag.
     */
    tagNotify: boolean;
}

/** The four `g_critical` sites of the family, as structured data. */
export type NavigationDiagnosticCode = 'duplicate-tag' | 'already-in-stack' | 'tag-not-found' | 'not-in-stack';

/**
 * A rejected mutation. Replaces `g_critical`: today web writes `console.warn`
 * with two of the four cases and NS is silent, which is itself a divergence.
 */
export interface NavigationDiagnostic {
    /** Which rule rejected the call. */
    code: NavigationDiagnosticCode;
    /** The offending tag, where the C message names one. */
    tag?: string | null;
    /** The offending page's title, where the C message names one instead. */
    title?: string;
}

/** Subscriber for {@link NavigationViewState} stack changes. */
export type NavigationStackListener<P> = (change: NavigationStackChange<P>) => void;

/** Sink for rejected mutations — the injected `g_critical`. */
export type NavigationDiagnosticListener = (diagnostic: NavigationDiagnostic) => void;

/**
 * Supplies {@link AdwNavigationPageProps} for a page a mutation is registering
 * on the fly. `replace()` may introduce pages the view has never seen; a renderer
 * reads their properties from its own markup (DOM attributes, XML) and this is
 * the seam that lets it, without core touching a platform API.
 */
export type NavigationPagePropsResolver<P> = (page: P) => AdwNavigationPageProps | undefined;

/**
 * What a shortcut handler must do with the key event. `'stop'` is
 * `GDK_EVENT_STOP` — notably also returned WITHOUT popping when the visible page
 * has `can-pop = FALSE`, so the key is not forwarded to an enclosing navigation
 * view (pop_shortcut_cb).
 */
export type NavigationShortcutResult = 'stop' | 'propagate';

/** Construction defaults + the diagnostic seam. */
export interface NavigationViewOptions {
    /** `AdwNavigationView:animate-transitions`, default `true` (init). */
    animateTransitions?: boolean;
    /** `AdwNavigationView:pop-on-escape`, default `true` (init). */
    popOnEscape?: boolean;
    /** Where rejected mutations are reported. Unset = silent. */
    onDiagnostic?: NavigationDiagnosticListener;
}

/** The default back-button tooltip when the previous page has no title. */
export const BACK_BUTTON_FALLBACK_TOOLTIP = 'Back';

/** Everything the view stores per registered page. */
interface PageRecord {
    tag: string | null;
    title: string;
    canPop: boolean;
    /** `AdwNavigationPage`'s private `remove_on_pop`: the page was pushed, never added. */
    removeOnPop: boolean;
}

/** What one `switch_page` call decides, before the change is assembled. */
interface SwitchOutcome<P> {
    animate: boolean;
    tagNotify: boolean;
    removeAfterTransition: P | null;
}

/** The `g_critical` message libadwaita prints for `diagnostic` — kept verbatim. */
export function describeNavigationDiagnostic(diagnostic: NavigationDiagnostic): string {
    switch (diagnostic.code) {
        case 'duplicate-tag':
            return `Duplicate page tag in AdwNavigationView: ${diagnostic.tag}`;
        case 'already-in-stack':
            return diagnostic.tag === undefined
                ? `Page '${diagnostic.title}' is already in navigation stack`
                : `Page with the tag '${diagnostic.tag}' is already in navigation stack`;
        case 'tag-not-found':
            return `No page with the tag '${diagnostic.tag}' found in AdwNavigationView`;
        case 'not-in-stack':
            return `Page '${diagnostic.title}' is not in the navigation stack`;
    }
}

/**
 * The whole `Adw.NavigationView` machine, headless.
 *
 * A renderer registers its page handles ({@link add} / {@link push}), drives the
 * mutators, and reacts to one {@link NavigationStackChange} per mutation. It keeps
 * ZERO navigation state of its own — the stack, the tag index, the
 * static-vs-dynamic ownership and the deferred-destroy queue all live here.
 */
export class NavigationViewState<P = unknown> {
    private readonly _registry = new Map<P, PageRecord>();
    private readonly _tags = new Map<string, P>();
    private readonly _stack: P[] = [];
    private readonly _listeners = new Set<NavigationStackListener<P>>();
    private readonly _onDiagnostic: NavigationDiagnosticListener | null;
    private _animateTransitions: boolean;
    private _popOnEscape: boolean;
    /** The outgoing page owed a destroy once the transition ends (C's `hiding_page`). */
    private _pendingRemoval: P | null = null;

    constructor(options: NavigationViewOptions = {}) {
        this._animateTransitions = options.animateTransitions ?? true;
        this._popOnEscape = options.popOnEscape ?? true;
        this._onDiagnostic = options.onDiagnostic ?? null;
    }

    /** Subscribe to stack changes. Returns an unsubscribe function. */
    subscribe(listener: NavigationStackListener<P>): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /** The navigation stack, bottom-first. A snapshot — mutating it does nothing. */
    get stack(): readonly P[] {
        return [...this._stack];
    }

    /** Number of pages on the stack. */
    get depth(): number {
        return this._stack.length;
    }

    /** Every registered page (static + dynamically pushed), in registration order. */
    get pages(): readonly P[] {
        return [...this._registry.keys()];
    }

    /** The top of the stack, or `null` when the stack is empty (get_visible_page). */
    get visiblePage(): P | null {
        return this._stack.length === 0 ? null : (this._stack[this._stack.length - 1] as P);
    }

    /** The visible page's tag, or `null` — never `''` for an untagged page (get_visible_page_tag). */
    get visiblePageTag(): string | null {
        const page = this.visiblePage;
        return page === null ? null : this.tagOf(page);
    }

    /** Whether push/pop transitions animate. */
    get animateTransitions(): boolean {
        return this._animateTransitions;
    }

    /** Whether Escape pops the visible page. */
    get popOnEscape(): boolean {
        return this._popOnEscape;
    }

    /** Set `animate-transitions`. Returns whether it changed. */
    setAnimateTransitions(value: boolean): boolean {
        const next = !!value;
        if (next === this._animateTransitions) return false;
        this._animateTransitions = next;
        return true;
    }

    /** Set `pop-on-escape`. Returns whether it changed. */
    setPopOnEscape(value: boolean): boolean {
        const next = !!value;
        if (next === this._popOnEscape) return false;
        this._popOnEscape = next;
        return true;
    }

    /** Whether `page` is known to this view. */
    isRegistered(page: P): boolean {
        return this._registry.has(page);
    }

    /** Whether `page` currently sits on the navigation stack. */
    isInStack(page: P): boolean {
        return this._stack.includes(page);
    }

    /** Whether `page` is a DYNAMIC page — pushed but never added, so destroyed when popped. */
    isRemoveOnPop(page: P): boolean {
        return this._registry.get(page)?.removeOnPop === true;
    }

    /** `page`'s tag, or `null` (also `null` for an unregistered page). */
    tagOf(page: P): string | null {
        return this._registry.get(page)?.tag ?? null;
    }

    /** `page`'s title. `''` when untitled or unregistered — the C title is never NULL. */
    titleOf(page: P): string {
        return this._registry.get(page)?.title ?? '';
    }

    /** `page`'s `can-pop`. `true` for an unregistered page, matching the property default. */
    canPopOf(page: P): boolean {
        return this._registry.get(page)?.canPop ?? true;
    }

    /**
     * The page with this tag, or `null` (find_page).
     *
     * Byte-exact: the C table is `g_str_hash`/`g_str_equal`, so NFC and NFD
     * spellings of the same word are DIFFERENT keys and `''` is a valid one.
     * Dynamically-pushed pages are found too — `maybe_add_page` routes through
     * `add_page`, which indexes the tag.
     */
    findPage(tag: string): P | null {
        return this._tags.get(tag) ?? null;
    }

    /**
     * The page popping `page` would reveal (get_previous_page) — `null` when
     * `page` is the root page or is not on the stack.
     */
    getPreviousPage(page: P): P | null {
        const pos = this._stack.indexOf(page);
        return pos <= 0 ? null : (this._stack[pos - 1] as P);
    }

    /**
     * Permanently add `page` (`adw_navigation_view_add`); a page added this way survives
     * being popped. Two easily-missed rules:
     * 1. adding a page that is on the stack as a DYNAMIC page converts it to a permanent
     * one and does nothing else — the stack does not move and nothing is emitted;
     * 2. the auto-push fires whenever the stack is EMPTY, not only for the first page
     * ever added, so `add()` after `replace([])` pushes again.
     *
     * Returns `false` (with a `duplicate-tag` diagnostic) when the tag collides.
     */
    add(page: P, props: AdwNavigationPageProps = {}): boolean {
        const record = this._registry.get(page);
        if (record !== undefined) {
            if (record.removeOnPop && this._stack.includes(page)) {
                record.removeOnPop = false;
                return true;
            }
            // Re-adding an already-permanent page is a programming error: C reaches
            // `gtk_widget_set_parent` on a parented widget, having already criticaled
            // on the page's own tag when it has one.
            if (record.tag !== null) this._diagnose({ code: 'duplicate-tag', tag: record.tag });
            return false;
        }
        return this._addPage(page, props, true);
    }

    /**
     * Remove `page` (adw_navigation_view_remove → remove_page).
     *
     * If the page is on the stack the removal is DEFERRED: the page is marked
     * remove-on-pop and destroyed when it is popped. Otherwise it is
     * unregistered immediately and its tag freed. Returns `false` only for a page
     * this view does not know.
     */
    remove(page: P): boolean {
        const record = this._registry.get(page);
        if (record === undefined) return false;
        // remove_page skips the animation for the page currently transitioning
        // out, which resolves its deferred destroy here instead.
        if (this._pendingRemoval === page) this._pendingRemoval = null;
        if (this._stack.includes(page)) {
            record.removeOnPop = true;
            return true;
        }
        this._unregister(page);
        return true;
    }

    /**
     * Set `page`'s tag (adw_navigation_page_set_tag). Silent no-op when
     * unchanged; rejected with `duplicate-tag` when another page already
     * owns the tag, in which case the OLD tag is kept.
     */
    setTag(page: P, tag: string | null): boolean {
        const record = this._registry.get(page);
        if (record === undefined) return false;
        const next = tag ?? null;
        if (next === record.tag) return false;
        if (next !== null && this._tags.has(next)) {
            this._diagnose({ code: 'duplicate-tag', tag: next });
            return false;
        }
        if (record.tag !== null) this._tags.delete(record.tag);
        record.tag = next;
        if (next !== null) this._tags.set(next, page);
        return true;
    }

    /**
     * Set `page`'s title (adw_navigation_page_set_title). Drives the header-bar
     * title and the NEXT page's back-button tooltip. `null`/`undefined` is rejected
     * — the C has `g_return_if_fail (title != NULL)`.
     */
    setTitle(page: P, title: string): boolean {
        if (typeof title !== 'string') return false;
        const record = this._registry.get(page);
        if (record === undefined || record.title === title) return false;
        record.title = title;
        return true;
    }

    /**
     * Set `page`'s `can-pop` (adw_navigation_page_set_can_pop). Gates
     * shortcuts, gestures and the back button — deliberately NOT {@link pop}.
     */
    setCanPop(page: P, canPop: boolean): boolean {
        const record = this._registry.get(page);
        if (record === undefined) return false;
        const next = !!canPop;
        if (next === record.canPop) return false;
        record.canPop = next;
        return true;
    }

    /**
     * Push `page` onto the stack (adw_navigation_view_push).
     *
     * A page the view has never seen is registered as DYNAMIC (destroyed when
     * popped, maybe_add_page); an already-registered one keeps its
     * permanence, because maybe_add_page returns early for it. That
     * asymmetry is why a static page survives a push/pop round trip.
     *
     * Returns `false` with `already-in-stack` when the page is already on the
     * stack (push_to_stack), or with `duplicate-tag` when its tag collides.
     */
    push(page: P, props: AdwNavigationPageProps = {}): boolean {
        if (!this._maybeAddPage(page, props)) return false;
        return this._pushToStack(page, 'push', this._animateTransitions, false);
    }

    /**
     * Push the page carrying `tag` (adw_navigation_view_push_by_tag). An
     * unknown tag is rejected with `tag-not-found` and changes nothing.
     */
    pushByTag(tag: string): boolean {
        const page = this.findPage(tag);
        if (page === null) {
            this._diagnose({ code: 'tag-not-found', tag });
            return false;
        }
        return this._pushToStack(page, 'push', this._animateTransitions, true);
    }

    /**
     * Pop the visible page (adw_navigation_view_pop). `false` when there is
     * no visible page or no page beneath it.
     *
     * Deliberately IGNORES `can-pop`: the C function contains no such test and the
     * property docs say so in as many words — "Manually calling
     * [method@NavigationView.pop] […] will still work". Use
     * {@link popFromShortcut} for the gated path.
     */
    pop(): boolean {
        const page = this.visiblePage;
        if (page === null) return false;
        const previous = this.getPreviousPage(page);
        if (previous === null) return false;
        this._popFromStack(previous, this._animateTransitions);
        return true;
    }

    /**
     * Pop until `page` is visible (adw_navigation_view_pop_to_page) — ONE
     * atomic splice, so ONE visible-page notification carrying every popped page,
     * not N sequential pops. Ignores `can-pop` on the pages it passes.
     *
     * `false` (silently) when `page` is already visible; `false` with
     * `not-in-stack` when it is off-stack.
     */
    popToPage(page: P): boolean {
        if (page === this.visiblePage) return false;
        if (!this._stack.includes(page)) {
            this._diagnose({ code: 'not-in-stack', title: this.titleOf(page) });
            return false;
        }
        this._popFromStack(page, this._animateTransitions);
        return true;
    }

    /**
     * Pop until the page carrying `tag` is visible (adw_navigation_view_pop_to_tag).
     * An unknown tag yields `tag-not-found`; a known but off-stack one yields
     * `not-in-stack`.
     */
    popToTag(tag: string): boolean {
        const page = this.findPage(tag);
        if (page === null) {
            this._diagnose({ code: 'tag-not-found', tag });
            return false;
        }
        return this.popToPage(page);
    }

    /**
     * Replace the whole stack (adw_navigation_view_replace). Never animates
     * and emits no `popped` — `::replaced` is its own signal.
     *
     * `null` entries are skipped and a page listed twice is
     * rejected on its second occurrence. Old DYNAMIC pages are
     * destroyed only when they are absent from the new set; that
     * guard is what makes replacing the stack with the tag of a pushed page work.
     * An empty array leaves no visible page.
     *
     * `props` supplies registration properties for pages the view has not seen.
     */
    replace(pages: readonly (P | null)[], props?: NavigationPagePropsResolver<P>): void {
        const originalVisible = this.visiblePage;
        // C nulls its local `visible_page` when that page is destroyed below, which
        // turns the later switch into a "no outgoing page" one.
        let switchPrev = originalVisible;
        const hadVisiblePage = originalVisible !== null;
        let oldVisibleHadTag = false;
        const removed: P[] = [];

        const keep = new Set<P>();
        for (const page of pages) {
            if (page !== null && page !== undefined) keep.add(page);
        }

        // replace — walk the OLD stack top-first, destroying the dynamic
        // pages that the new stack does not keep.
        for (let i = this._stack.length - 1; i >= 0; i--) {
            const page = this._stack[i] as P;
            const record = this._registry.get(page);
            if (record === undefined || !record.removeOnPop || keep.has(page)) continue;
            if (page === switchPrev) {
                oldVisibleHadTag = record.tag !== null;
                switchPrev = null;
            }
            if (this._unregister(page)) removed.push(page);
        }

        this._stack.length = 0;

        const added = new Set<P>();
        for (const page of pages) {
            if (page === null || page === undefined) continue;
            if (added.has(page)) {
                this._diagnose({ code: 'already-in-stack', title: this.titleOf(page) });
                continue;
            }
            if (!this._maybeAddPage(page, props?.(page) ?? {})) continue;
            added.add(page);
            this._stack.push(page);
        }

        const newVisible = this.visiblePage;
        let outcome: SwitchOutcome<P>;
        if (newVisible !== null) {
            outcome =
                switchPrev === newVisible
                    ? { animate: false, tagNotify: false, removeAfterTransition: null }
                    : this._beginSwitch(switchPrev, newVisible, true, false, removed);
        } else if (switchPrev !== null) {
            outcome = this._beginSwitch(switchPrev, null, true, false, removed);
        } else {
            // replace — the old visible page was destroyed rather than
            // switched away from, so `visible-page` still notifies but the tag only
            // does when that page carried one.
            outcome = { animate: false, tagNotify: hadVisiblePage && oldVisibleHadTag, removeAfterTransition: null };
        }
        this._emitChange('replace', originalVisible, true, [], removed, outcome);
    }

    /**
     * Replace the stack with the pages carrying `tags`
     * (adw_navigation_view_replace_with_tags).
     *
     * Every tag is resolved BEFORE any mutation; an unknown one reports `tag-not-found`
     * and becomes a null slot {@link replace} then skips, rather than aborting the call.
     */
    replaceWithTags(tags: readonly string[]): void {
        const pages = tags.map((tag) => {
            const page = this.findPage(tag);
            if (page === null) this._diagnose({ code: 'tag-not-found', tag });
            return page;
        });
        this.replace(pages);
    }

    /**
     * Report that the outgoing transition finished (transition_done_cb),
     * and receive the pages the renderer must now destroy.
     *
     * This is the injected timing seam replacing `AdwAnimation`'s "done" callback.
     * A renderer that does not animate calls it straight after the change — which
     * is precisely what `adw_animation_skip` does in the C when `animate` is FALSE.
     * A page pushed back onto the stack before the transition finished survives,
     * because the C routes this through `adw_navigation_view_remove` and its
     * on-the-stack check (:1042 → remove_page).
     */
    finishTransition(): readonly P[] {
        const page = this._resolvePendingRemoval();
        return page === null ? [] : [page];
    }

    // Back button — Reference: refs/libadwaita/src/adw-back-button.c

    /**
     * Whether the automatic back button is shown — `get_previous_page(visible) !==
     * null && can_pop(visible)` (adw-back-button.c update_page). This is the
     * ONLY place `can-pop` decides whether a page can be left.
     */
    canGoBack(): boolean {
        const page = this.visiblePage;
        if (page === null || !this.canPopOf(page)) return false;
        return this.getPreviousPage(page) !== null;
    }

    /**
     * The back button's tooltip: the title of the page the button would reveal,
     * falling back to `fallback` only when that title is empty
     * (adw-back-button.c query_tooltip). `null` when there is no back
     * button at all.
     */
    backButtonTooltip(fallback: string = BACK_BUTTON_FALLBACK_TOOLTIP): string | null {
        if (!this.canGoBack()) return null;
        const previous = this.getPreviousPage(this.visiblePage as P);
        if (previous === null) return null;
        const title = this.titleOf(previous);
        return title.length > 0 ? title : fallback;
    }

    /**
     * The `can-pop`-aware pop behind Alt+Left and the back mouse button
     * (pop_shortcut_cb).
     *
     * Returns `'stop'` WITHOUT popping when the visible page has `can-pop = FALSE`
     * — deliberately, so the key is not forwarded to an enclosing navigation view.
     */
    popFromShortcut(): NavigationShortcutResult {
        const page = this.visiblePage;
        if (page === null) return 'propagate';
        if (!this.canPopOf(page)) return 'stop';
        return this.pop() ? 'stop' : 'propagate';
    }

    /** Escape-to-pop: {@link popFromShortcut} gated on `pop-on-escape` (escape_shortcut_cb). */
    popFromEscape(): NavigationShortcutResult {
        return this._popOnEscape ? this.popFromShortcut() : 'propagate';
    }

    private _diagnose(diagnostic: NavigationDiagnostic): void {
        this._onDiagnostic?.(diagnostic);
    }

    private _emit(change: NavigationStackChange<P>): void {
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._listeners]) listener(change);
    }

    private _emitChange(
        reason: NavigationChangeReason,
        previousVisiblePage: P | null,
        pop: boolean,
        popped: readonly P[],
        removed: readonly P[],
        outcome: SwitchOutcome<P>,
    ): void {
        const visiblePage = this.visiblePage;
        this._emit({
            stack: [...this._stack],
            visiblePage,
            visiblePageTag: visiblePage === null ? null : this.tagOf(visiblePage),
            previousVisiblePage,
            reason,
            popped: [...popped],
            removed: [...removed],
            removeAfterTransition: outcome.removeAfterTransition,
            animate: outcome.animate,
            pop,
            tagNotify: outcome.tagNotify,
        });
    }

    /** `add_page` — register, index the tag, and auto-push into an empty stack. */
    private _addPage(page: P, props: AdwNavigationPageProps, autoPush: boolean): boolean {
        const tag = props.tag ?? null;
        if (tag !== null && this._tags.has(tag)) {
            this._diagnose({ code: 'duplicate-tag', tag });
            return false;
        }
        this._registry.set(page, {
            tag,
            title: props.title ?? '',
            canPop: props.canPop === undefined ? true : !!props.canPop,
            removeOnPop: false,
        });
        if (tag !== null) this._tags.set(tag, page);
        // the condition is "the stack is empty", not "this is the
        // first page", and the auto-push is hard-coded NOT to animate.
        if (autoPush && this._stack.length === 0) this._pushToStack(page, 'add', false, false);
        return true;
    }

    /** `maybe_add_page` — register an unknown page as DYNAMIC; keep a known one as it is. */
    private _maybeAddPage(page: P, props: AdwNavigationPageProps): boolean {
        if (this._registry.has(page)) return true;
        const tag = props.tag ?? null;
        if (tag !== null && this._tags.has(tag)) {
            this._diagnose({ code: 'duplicate-tag', tag });
            return false;
        }
        if (!this._addPage(page, props, false)) return false;
        const record = this._registry.get(page);
        if (record !== undefined) record.removeOnPop = true;
        return true;
    }

    /** `push_to_stack` — the append plus its already-in-stack guard. */
    private _pushToStack(page: P, reason: NavigationChangeReason, animate: boolean, useTagForErrors: boolean): boolean {
        if (this._stack.includes(page)) {
            this._diagnose(
                useTagForErrors
                    ? { code: 'already-in-stack', tag: this.tagOf(page) }
                    : { code: 'already-in-stack', title: this.titleOf(page) },
            );
            return false;
        }
        const previous = this.visiblePage;
        const removed: P[] = [];
        this._stack.push(page);
        const outcome = this._beginSwitch(previous, page, false, animate, removed);
        this._emitChange(reason, previous, false, [], removed, outcome);
        return true;
    }

    /** `pop_from_stack` — one splice, one switch, then the per-page destroys. */
    private _popFromStack(pageTo: P, animate: boolean): void {
        const oldPage = this.visiblePage;
        if (pageTo === oldPage) return;
        const pos = this._stack.indexOf(pageTo);
        // prepend-while-walking-up makes `popped` top-first.
        const popped = this._stack.slice(pos + 1).reverse();
        this._stack.length = pos + 1;

        const removed: P[] = [];
        const outcome = this._beginSwitch(oldPage, pageTo, true, animate, removed);
        // every popped DYNAMIC page is destroyed now EXCEPT the outgoing
        // visible one, which waits for the transition to finish.
        for (const page of popped) {
            if (page === oldPage) continue;
            if (this._registry.get(page)?.removeOnPop !== true) continue;
            if (this._unregister(page)) removed.push(page);
        }
        this._emitChange('pop', oldPage, true, popped, removed, outcome);
    }

    /**
     * `switch_page`, minus the rendering: flush a still-pending deferred
     * destroy, decide whether this transition animates, and queue the new one.
     */
    private _beginSwitch(
        prev: P | null,
        page: P | null,
        pop: boolean,
        animate: boolean,
        removed: P[],
    ): SwitchOutcome<P> {
        // starting a transition on a DIFFERENT page resolves the one
        // still owed from the previous transition.
        if (this._pendingRemoval !== null && this._pendingRemoval !== prev) {
            const stale = this._resolvePendingRemoval();
            if (stale !== null) removed.push(stale);
        }

        // the destroy is deferred, and `remove_page`'s on-the-stack check
        // spares a page the new stack still holds.
        let removeAfterTransition: P | null = null;
        if (pop && prev !== null && this._registry.get(prev)?.removeOnPop === true && !this._stack.includes(prev)) {
            removeAfterTransition = prev;
            this._pendingRemoval = prev;
        }

        return {
            // with no outgoing page there is nothing to slide away, so
            // the very first push into an empty view never animates.
            animate: animate && prev !== null,
            // the tag re-notifies when EITHER side carries one.
            tagNotify: (prev !== null && this.tagOf(prev) !== null) || (page !== null && this.tagOf(page) !== null),
            removeAfterTransition,
        };
    }

    /**
     * Settle the deferred destroy owed by the last pop — the shared body of
     * {@link finishTransition} and the mid-transition flush in {@link _beginSwitch}.
     * Both go through `adw_navigation_view_remove` in the C, so both
     * inherit `remove_page`'s on-the-stack check: a page pushed BACK before the
     * transition ended survives and is merely re-marked remove-on-pop.
     */
    private _resolvePendingRemoval(): P | null {
        const page = this._pendingRemoval;
        if (page === null) return null;
        this._pendingRemoval = null;
        if (this._stack.includes(page)) {
            const record = this._registry.get(page);
            if (record !== undefined) record.removeOnPop = true;
            return null;
        }
        return this._unregister(page) ? page : null;
    }

    private _unregister(page: P): boolean {
        const record = this._registry.get(page);
        if (record === undefined) return false;
        if (record.tag !== null && this._tags.get(record.tag) === page) this._tags.delete(record.tag);
        this._registry.delete(page);
        return true;
    }
}
