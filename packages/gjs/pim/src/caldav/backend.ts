/**
 * The CalDAV driver for the CalendarBackend port.
 *
 * A calendar's uid is its collection URL. Components cross the port as iCalendar text: reads hand
 * back whatever the server stores (a VCALENDAR wrapper included — core's parser walks nested
 * components), writes wrap the bare component core builds, because CalDAV stores whole VCALENDARs.
 *
 * Recurring items come back as their series definition, like EDS: the server filters by the
 * window and nothing is expanded here.
 */

import { DavClient, DavError, basicAuth, type Collection, type DavObject, type FetchLike } from '@gjsify/dav';

import type { CalendarBackend, ItemQuery } from '../backend.js';
import { BackendError, ConflictError } from '../errors.js';
import { _, fmt } from '../i18n.js';
import { davError } from './errors.js';
import type { CalendarInfo, ItemKind, RawItem } from '../types.js';

const COMPONENT: Record<ItemKind, string> = { event: 'VEVENT', reminder: 'VTODO' };
/** Multiget URLs per request, to keep request bodies bounded on large calendars. */
const MULTIGET_CHUNK = 50;

export interface CaldavOptions {
    /** Server root or any URL the user knows; RFC 6764 discovery finds the calendar home. */
    url: string;
    username: string;
    password: string;
    /** Injectable for tests and custom TLS setups; defaults to the runtime's fetch. */
    fetch?: FetchLike;
    /** PRODID of the VCALENDAR a bare component is wrapped in; name the app that wrote it. */
    prodId?: string;
}

const DEFAULT_PRODID = '-//gjsify//pim//EN';

/** UID of a component, from unfolded text. The one line the port lets a backend look at. */
function uidOf(ical: string): string | null {
    const m = /^UID[;:][^\r\n]*$/m.exec(ical.replace(/\r?\n[ \t]/g, ''));
    const value = m?.[0].slice(m[0].indexOf(':') + 1).trim();
    return value ? value : null;
}

function wrap(ical: string, prodId: string): string {
    if (/^BEGIN:VCALENDAR/m.test(ical)) return ical;
    const body = ical.replace(/\r?\n/g, '\r\n');
    return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:${prodId}\r\n${body.endsWith('\r\n') ? body : `${body}\r\n`}END:VCALENDAR\r\n`;
}

function icalUtc(iso: string): string {
    return new Date(iso)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
}

function supports(c: Collection, kind: ItemKind): boolean {
    // A server that names no component set accepts all of them (RFC 4791 §5.2.3).
    return c.components.length === 0 || c.components.includes(COMPONENT[kind]);
}

export function createCaldavBackend(options: CaldavOptions): CalendarBackend {
    const dav = new DavClient({ auth: basicAuth(options.username, options.password), fetch: options.fetch });
    const prodId = options.prodId ?? DEFAULT_PRODID;
    let collections: Promise<Collection[]> | null = null;

    async function boundary<T>(label: string, fn: () => Promise<T>): Promise<T> {
        try {
            return await fn();
        } catch (err) {
            throw davError(label, err);
        }
    }

    function load(): Promise<Collection[]> {
        if (!collections) {
            collections = (async () => {
                const { homeUrl } = await dav.discover('caldav', options.url);
                return dav.listCollections(homeUrl, 'caldav');
            })();
            // A failed discovery must not be cached: the network or the password may be fixed a moment later.
            collections.catch(() => (collections = null));
        }
        return collections;
    }

    async function collection(kind: ItemKind, uid: string): Promise<Collection> {
        const found = (await load()).find((c) => c.url === uid && supports(c, kind));
        if (!found)
            throw new BackendError(
                fmt(kind === 'event' ? _('no calendar "{uid}"') : _('no task list "{uid}"'), { uid }),
            );
        return found;
    }

    async function fetchObjects(c: Collection, urls: string[]): Promise<DavObject[]> {
        const out: DavObject[] = [];
        for (let i = 0; i < urls.length; i += MULTIGET_CHUNK) {
            out.push(...(await dav.getObjects(c.url, 'caldav', urls.slice(i, i + MULTIGET_CHUNK))));
        }
        return out;
    }

    async function fetchData(c: Collection, urls: string[]): Promise<string[]> {
        return (await fetchObjects(c, urls)).flatMap((o) => (o.data ? [o.data] : []));
    }

    const resourceUrl = (c: Collection, uid: string) => `${c.url.replace(/\/$/, '')}/${encodeURIComponent(uid)}.ics`;

    /**
     * The resource that holds `uid`, with the etag the server reported for it.
     *
     * Our own creates live at `<uid>.ics`, so ask there first; other clients name resources freely,
     * so a miss asks the server for the UID with a calendar-query prop-filter.
     */
    async function locate(c: Collection, kind: ItemKind, uid: string): Promise<DavObject | null> {
        const holds = (o: DavObject) => o.data !== undefined && uidOf(o.data) === uid;
        const direct = (await fetchObjects(c, [resourceUrl(c, uid)])).find(holds);
        if (direct) return direct;
        const listed = await dav.listObjects(c.url, 'caldav', { component: COMPONENT[kind], uid });
        return (
            (
                await fetchObjects(
                    c,
                    listed.map((o) => o.url),
                )
            ).find(holds) ?? null
        );
    }

    return {
        id: 'caldav',

        listCalendars: (kind) =>
            boundary('listCalendars', async () => {
                const kinds: ItemKind[] = kind ? [kind] : ['event', 'reminder'];
                const account = new URL(options.url).host;
                const out: CalendarInfo[] = [];
                for (const k of kinds) {
                    for (const c of await load()) {
                        if (!supports(c, k)) continue;
                        out.push({ uid: c.url, name: c.displayName ?? c.url, kind: k, backend: 'caldav', account });
                    }
                }
                return out;
            }),

        listItems: (q: ItemQuery) =>
            boundary('listItems', async () => {
                const range =
                    q.kind === 'event' && q.from && q.to ? { start: icalUtc(q.from), end: icalUtc(q.to) } : undefined;
                const items: RawItem[] = [];
                for (const c of await load()) {
                    if (!supports(c, q.kind) || (q.calendarUid && c.url !== q.calendarUid)) continue;
                    const listed = await dav.listObjects(c.url, 'caldav', { component: COMPONENT[q.kind], range });
                    for (const ical of await fetchData(
                        c,
                        listed.map((o) => o.url),
                    ))
                        items.push({ calendarUid: c.url, ical });
                }
                return items;
            }),

        getItem: (calendarUid, kind, uid) =>
            boundary('getItem', async () => {
                const found = await locate(await collection(kind, calendarUid), kind, uid);
                return found?.data === undefined ? null : { ical: found.data, etag: found.etag };
            }),

        createItem: (calendarUid, kind, ical) =>
            boundary('createItem', async () => {
                const c = await collection(kind, calendarUid);
                const uid = uidOf(ical);
                if (!uid) throw new BackendError(_('createItem: the component has no UID'));
                try {
                    await dav.put(resourceUrl(c, uid), wrap(ical, prodId), { ifNoneMatch: true });
                } catch (err) {
                    if (err instanceof DavError && err.isPreconditionFailed)
                        throw new BackendError(
                            fmt(_('createItem: "{uid}" already exists in "{calendar}"'), {
                                uid,
                                calendar: calendarUid,
                            }),
                            'http',
                            412,
                        );
                    if (err instanceof DavError && err.status === 403)
                        throw new BackendError(
                            fmt(_('createItem: "{calendar}" refused the write (read-only?)'), {
                                calendar: calendarUid,
                            }),
                            'http',
                            403,
                        );
                    throw err;
                }
                return uid;
            }),

        updateItem: (calendarUid, kind, uid, ical, etag) =>
            boundary('updateItem', async () => {
                const c = await collection(kind, calendarUid);
                // The resource is looked up again: between the read and this call nothing moved it, but
                // the port passes a UID, not a URL, and only the server knows which path holds it.
                const found = await locate(c, kind, uid);
                if (!found)
                    throw new BackendError(
                        fmt(_('updateItem: no "{uid}" in "{calendar}"'), { uid, calendar: calendarUid }),
                    );
                try {
                    await dav.put(found.url, wrap(ical, prodId), etag ? { ifMatch: etag } : {});
                } catch (err) {
                    if (err instanceof DavError && err.isPreconditionFailed)
                        throw new ConflictError(
                            fmt(_('updateItem: "{uid}" changed on the server since it was read'), { uid }),
                            'http',
                            412,
                        );
                    if (err instanceof DavError && err.status === 403)
                        throw new BackendError(
                            fmt(_('updateItem: "{calendar}" refused the write (read-only?)'), {
                                calendar: calendarUid,
                            }),
                            'http',
                            403,
                        );
                    throw err;
                }
            }),
    };
}
