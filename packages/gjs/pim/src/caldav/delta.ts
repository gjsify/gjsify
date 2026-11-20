/**
 * Delta read of one CalDAV collection (docs/adr/0018).
 *
 * The caller remembers the last answer — an opaque marker and the items — and hands both back. An
 * unchanged collection then costs ONE request (a PROPFIND on the calendar home); a changed one
 * costs the sync-collection report plus a multiget of only the changed items; a server without
 * (or with a rejected) sync token costs a full listing. The driver still moves iCalendar text only.
 *
 * Marker: JSON `{"v":1,"ctag":string|null,"syncToken":string|null}`. Callers treat it as opaque;
 * one that does not parse is no marker, and the read is a full one.
 */

import { DavClient, DavSyncTokenError, basicAuth, type Collection, type DavObject, type FetchLike } from '@gjsify/dav';

import { BackendError } from '../errors.js';
import { _, fmt } from '../i18n.js';
import type { CollectionDelta, CollectionItem, CollectionPrevious, ItemKind } from '../types.js';
import { davError } from './errors.js';

const COMPONENT: Record<ItemKind, string> = { event: 'VEVENT', reminder: 'VTODO' };
/** Multiget URLs per request, to keep request bodies bounded on large calendars. */
const MULTIGET_CHUNK = 50;

export interface CaldavDeltaOptions {
    /** Server root or any URL the user knows; RFC 6764 discovery finds the calendar home once. */
    url: string;
    username: string;
    password: string;
    fetch?: FetchLike;
    /** The calendar home, when known: skips discovery, so even the first read is cheap. */
    homeUrl?: string;
}

export interface CaldavDeltaReader {
    /** `collectionUrl` is a calendar uid as `listCalendars` reports it. `previous` null = full read. */
    read(collectionUrl: string, kind: ItemKind, previous: CollectionPrevious | null): Promise<CollectionDelta>;
}

interface Marker {
    ctag: string | null;
    syncToken: string | null;
}

const encodeMarker = (m: Marker): string => JSON.stringify({ v: 1, ctag: m.ctag, syncToken: m.syncToken });

function decodeMarker(raw: string): Marker | null {
    try {
        const m: unknown = JSON.parse(raw);
        if (typeof m !== 'object' || m === null) return null;
        const o = m as Record<string, unknown>;
        if (o.v !== 1) return null;
        const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
        return { ctag: text(o.ctag), syncToken: text(o.syncToken) };
    } catch {
        return null;
    }
}

/**
 * Unchanged only when the server offers a version at all and every one it offers matches. A
 * server that sends neither ctag nor sync token can never prove "unchanged".
 */
function same(now: Marker, before: Marker): boolean {
    if (now.ctag === null && now.syncToken === null) return false;
    return now.ctag === before.ctag && now.syncToken === before.syncToken;
}

export function createCaldavDeltaReader(options: CaldavDeltaOptions): CaldavDeltaReader {
    const dav = new DavClient({ auth: basicAuth(options.username, options.password), fetch: options.fetch });
    let home: Promise<string> | null = options.homeUrl ? Promise.resolve(options.homeUrl) : null;

    function homeUrl(): Promise<string> {
        if (!home) {
            home = dav.discover('caldav', options.url).then((d) => d.homeUrl);
            // A failed discovery must not be remembered: the network or the password may be fixed later.
            home.catch(() => (home = null));
        }
        return home;
    }

    async function fetchItems(collectionUrl: string, hrefs: string[]): Promise<CollectionItem[]> {
        const out: CollectionItem[] = [];
        for (let i = 0; i < hrefs.length; i += MULTIGET_CHUNK) {
            const got: DavObject[] = await dav.getObjects(collectionUrl, 'caldav', hrefs.slice(i, i + MULTIGET_CHUNK));
            for (const o of got) if (o.data !== undefined) out.push({ href: o.url, etag: o.etag, ical: o.data });
        }
        return out;
    }

    async function full(c: Collection, kind: ItemKind, marker: Marker): Promise<CollectionDelta> {
        const listed = await dav.listObjects(c.url, 'caldav', { component: COMPONENT[kind] });
        const items = await fetchItems(
            c.url,
            listed.map((o) => o.url),
        );
        return { kind: 'changed', marker: encodeMarker(marker), items };
    }

    async function delta(
        c: Collection,
        kind: ItemKind,
        before: Marker,
        items: CollectionItem[],
        now: Marker,
    ): Promise<CollectionDelta> {
        let result;
        try {
            result = await dav.sync(c.url, before.syncToken);
        } catch (err) {
            if (err instanceof DavSyncTokenError) return full(c, kind, now);
            throw err;
        }
        const gone = new Set(result.deleted);
        const touched = new Set(result.changed.map((o) => o.url));
        const kept = items.filter((i) => !gone.has(i.href) && !touched.has(i.href));
        // `sync` asks for etags only, so a changed object carries no body: multiget those and no more.
        // Unlike the full read's calendar-query, sync-collection cannot filter by component, so a
        // collection holding events and tasks reports both; keep only the kind asked for.
        const wanted = new RegExp(`^BEGIN:${COMPONENT[kind]}\\r?$`, 'm');
        const fresh = (await fetchItems(c.url, [...touched])).filter((i) => wanted.test(i.ical));
        return {
            kind: 'changed',
            marker: encodeMarker({ ctag: now.ctag, syncToken: result.syncToken ?? now.syncToken }),
            items: [...kept, ...fresh],
        };
    }

    return {
        read: async (collectionUrl, kind, previous) => {
            try {
                const collections = await dav.listCollections(await homeUrl(), 'caldav');
                const c = collections.find((x) => x.url === collectionUrl);
                if (!c) throw new BackendError(fmt(_('no calendar "{uid}"'), { uid: collectionUrl }));
                const now: Marker = { ctag: c.ctag, syncToken: c.syncToken };
                const before = previous ? decodeMarker(previous.marker) : null;
                if (previous && before) {
                    if (same(now, before)) return { kind: 'unchanged', marker: previous.marker };
                    if (before.syncToken !== null && now.syncToken !== null)
                        return await delta(c, kind, before, previous.items, now);
                }
                return await full(c, kind, now);
            } catch (err) {
                throw davError('readCollection', err);
            }
        },
    };
}
