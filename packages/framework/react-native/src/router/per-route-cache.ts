// The one cache shape a navigator needs, and the one place it is pruned.
//
// THREE MAPS HAD THIS SHAPE AND NONE OF THEM WAS EVER PRUNED (#1547): the title slot
// per header bar (`chrome.ts`), the screen options per page and the ref/`hidden`
// binding pair per page (`stack.ts`). Each is keyed on a ROUTE KEY, and a route key is
// not a route NAME — React Navigation mints a fresh one per pushed instance, so an
// application that pushes `detail/[id]` a few thousand times held a few thousand
// entries in each. A leak with a slope rather than a wall, and invisible on screen.
//
// EACH CACHE IS ALSO NECESSARY, which is why the answer is a prune and not a removal.
// An unstable slot identity re-runs every contributor's effect on each commit, which
// for that consumer means clearing and re-setting its contribution in a loop; a fresh
// callback ref per render leaves the widget unreachable between the detach and the
// re-attach, and a fresh signal handler costs one `g_signal_connect` per page per
// render; and `reconcilePopped` runs from a signal handler, outside any render, where
// the options of a page that has already left `descriptors` are still needed.
//
// SO THE LIFECYCLE IS THE PAGE LIST, not three lifecycles. `retain` is called once per
// commit with the keys the navigator still renders — which is the list the closing-page
// bookkeeping already maintains, so a page held for its exit animation keeps its
// entries until the release that drops it. It also covers the case a release-driven
// delete cannot see: a route removed from the MIDDLE of the stack was never on screen,
// so nothing animates it out and no `hidden` ever arrives for it, yet its entries are
// just as dead.

/**
 * Entries live across every cache in the process, so a leak is countable.
 *
 * The same seam `announce.ts` keeps for the same reason: a pruned cache and an
 * unpruned one render identically, and only a count tells them apart.
 */
let entries = 0;

/** How many per-route cache entries the process is holding right now. */
export const perRouteCacheEntries = (): number => entries;

/** A `Map` keyed by route key that is pruned to the pages a navigator still renders. */
export class PerRouteCache<T> {
    private readonly held = new Map<string, T>();

    /** The value for `key`, made once and kept — the identity every caller depends on. */
    getOrCreate(key: string, make: () => T): T {
        const existing = this.held.get(key);
        if (existing !== undefined) return existing;
        const made = make();
        this.held.set(key, made);
        entries++;
        return made;
    }

    /** Replace what is held for `key`. For values a render recomputes, like screen options. */
    set(key: string, value: T): void {
        if (!this.held.has(key)) entries++;
        this.held.set(key, value);
    }

    get(key: string): T | undefined {
        return this.held.get(key);
    }

    /**
     * Drop every key that is not in `keys`. The whole lifecycle, in one call.
     *
     * Deleting the key the loop is standing on is defined behaviour for a `Map`
     * iterator — no snapshot is needed, and taking one would only hide that.
     */
    retain(keys: ReadonlySet<string>): void {
        for (const key of this.held.keys()) {
            if (keys.has(key)) continue;
            this.held.delete(key);
            entries--;
        }
    }

    /** Drop everything. What an unmounting navigator owes the count. */
    clear(): void {
        entries -= this.held.size;
        this.held.clear();
    }

    get size(): number {
        return this.held.size;
    }
}
