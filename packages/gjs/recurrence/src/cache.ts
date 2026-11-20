/**
 * A window cache for expansions.
 *
 * ical.js has no "seek": `RecurExpansion` always starts at the series start and steps forward, so
 * a daily series that began in 2015 costs several thousand iterations before the first instance a
 * month view asks for — and a view that scrolls asks again for every month. Caching the answer per
 * window is what keeps that cost paid once.
 *
 * The key is uid + version + window, because all three change the answer: the version is the
 * source's ETag/ctag, and a changed ETag means the text is different, so every window
 * derived from it is stale. Entries are derived data — dropping any of them is always correct.
 */

import type { ExpandResult, ExpandWindow } from './expand.js';

export interface WindowCacheKey {
    /** The series or calendar the text belongs to. */
    uid: string;
    /** ETag, ctag or any opaque marker of the text's version; null when the source gave none. */
    version: string | null;
    window: ExpandWindow;
}

export interface WindowCacheStats {
    hits: number;
    misses: number;
    /** Entries dropped because the cache was full. */
    evictions: number;
}

export interface WindowCache {
    /** The cached expansion, or null for a miss. */
    get(key: WindowCacheKey): ExpandResult | null;
    put(key: WindowCacheKey, result: ExpandResult): void;
    /** Drop one uid's entries, or everything without an argument. */
    invalidate(uid?: string): void;
    stats(): WindowCacheStats;
    size(): number;
}

/** Entries kept before the least recently used one is dropped. */
export const WINDOW_CACHE_CAPACITY = 256;

/**
 * A null version is NOT the same as the version `"null"`: a source that sends no ETag gives no
 * promise that its text is unchanged, so its entries must never be reused across a refetch. They
 * are keyed by a marker that no real ETag can equal and dropped by `invalidate`.
 */
function keyOf(key: WindowCacheKey): string {
    const version = key.version === null ? '\u0000none' : `v${key.version}`;
    return `${key.uid}\u0000${version}\u0000${key.window.from}\u0000${key.window.to}`;
}

/** Frozen on the way in and copied on the way out: a caller must not be able to edit the cache. */
function freeze(result: ExpandResult): ExpandResult {
    return {
        occurrences: result.occurrences.map((o) => ({ ...o })),
        cuts: result.cuts.map((c) => ({ ...c })),
        unresolvedZones: [...result.unresolvedZones],
    };
}

/**
 * In-memory LRU. `Map` keeps insertion order, so re-inserting on a hit makes the first key the
 * least recently used one.
 */
export function createWindowCache(capacity = WINDOW_CACHE_CAPACITY): WindowCache {
    const rows = new Map<string, { uid: string; result: ExpandResult }>();
    const counts: WindowCacheStats = { hits: 0, misses: 0, evictions: 0 };

    return {
        get(key) {
            const id = keyOf(key);
            const row = rows.get(id);
            if (!row) {
                counts.misses += 1;
                return null;
            }
            counts.hits += 1;
            rows.delete(id);
            rows.set(id, row);
            return freeze(row.result);
        },
        put(key, result) {
            const id = keyOf(key);
            rows.delete(id);
            rows.set(id, { uid: key.uid, result: freeze(result) });
            while (rows.size > capacity) {
                const oldest = rows.keys().next();
                if (oldest.done) break;
                rows.delete(oldest.value);
                counts.evictions += 1;
            }
        },
        invalidate(uid) {
            if (uid === undefined) {
                rows.clear();
                return;
            }
            for (const [id, row] of rows) {
                if (row.uid === uid) rows.delete(id);
            }
        },
        stats: () => ({ ...counts }),
        size: () => rows.size,
    };
}
