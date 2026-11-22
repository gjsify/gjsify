/**
 * The Evolution Data Server driver for the CalendarBackend port.
 *
 * EDS keeps events (`Calendar` sources) and reminders (`Task List` sources) apart, so `kind`
 * picks the source extension and the client type. Every component crosses the port as
 * iCalendar text; parsing is the consumer's.
 *
 * Recurring items come back as their series definition (`occur-in-time-range?` selects series
 * with an occurrence in the window); occurrences are not expanded.
 */

import type ECal from 'gi://ECal?version=2.0';
import type EDataServer from 'gi://EDataServer?version=1.2';

import type { CalendarBackend, ItemQuery } from '../backend.js';
import { BackendError } from '../errors.js';
import { _, fmt } from '../i18n.js';
import type { CalendarInfo, ItemKind, RawItem } from '../types.js';

import { goaAccountId } from './goa.js';
import { edsError, isBackendFailure, unwrapList, unwrapResult } from './errors.js';
import { cal, eds } from './libs.gjs.js';

const CONNECT_WAIT_SECONDS = 15;

/** Quote a string for an EDS s-expression. */
function sexpString(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Run `fn`; anything that is not already a classified failure leaves as a BackendError. */
async function boundary<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (err) {
        if (isBackendFailure(err)) throw err;
        throw edsError(label, err);
    }
}

export function createEdsBackend(): CalendarBackend {
    let registry: EDataServer.SourceRegistry | null = null;
    const clients = new Map<string, Promise<ECal.Client>>();

    async function getRegistry(): Promise<EDataServer.SourceRegistry> {
        if (!registry) {
            const lib = await eds.get();
            try {
                // A one-time setup against the running evolution-source-registry service.
                registry = lib.SourceRegistry.new_sync(null);
            } catch (err) {
                throw edsError('EDS source registry', err);
            }
        }
        return registry;
    }

    async function sources(kind: ItemKind): Promise<EDataServer.Source[]> {
        const lib = await eds.get();
        const reg = await getRegistry();
        try {
            return reg.list_enabled(kind === 'event' ? lib.SOURCE_EXTENSION_CALENDAR : lib.SOURCE_EXTENSION_TASK_LIST);
        } catch (err) {
            throw edsError(`list ${kind === 'event' ? 'calendars' : 'task lists'}`, err);
        }
    }

    async function source(kind: ItemKind, uid: string): Promise<EDataServer.Source> {
        const found = (await sources(kind)).find((s) => s.get_uid() === uid);
        if (!found)
            throw new BackendError(
                fmt(kind === 'event' ? _('no enabled calendar "{uid}"') : _('no enabled task list "{uid}"'), { uid }),
            );
        return found;
    }

    function connect(src: EDataServer.Source, kind: ItemKind): Promise<ECal.Client> {
        const key = `${kind}:${src.get_uid()}`;
        let pending = clients.get(key);
        if (!pending) {
            pending = cal.get().then(
                ({ ECal: lib }) =>
                    new Promise<ECal.Client>((resolve, reject) => {
                        const type = kind === 'event' ? lib.ClientSourceType.EVENTS : lib.ClientSourceType.TASKS;
                        lib.Client.connect(src, type, CONNECT_WAIT_SECONDS, null, (_src, res) => {
                            try {
                                const client = lib.Client.connect_finish(res);
                                if (client) resolve(client as ECal.Client);
                                else reject(new Error('ECal.Client.connect_finish returned null'));
                            } catch (err) {
                                reject(err);
                            }
                        });
                    }),
            );
            // A failed connect must not be cached: EDS may come up a moment later.
            pending.catch(() => clients.delete(key));
            clients.set(key, pending);
        }
        return pending;
    }

    async function query(client: ECal.Client, sexp: string): Promise<string[]> {
        const comps = unwrapList<ECal.Component>(await client.get_object_list_as_comps(sexp, null));
        return comps.flatMap((c) => {
            const ical = c.get_icalcomponent()?.as_ical_string();
            return ical ? [ical] : [];
        });
    }

    return {
        id: 'eds',

        listCalendars: (kind) =>
            boundary('listCalendars', async () => {
                const lib = await eds.get();
                const reg = await getRegistry();
                const kinds: ItemKind[] = kind ? [kind] : ['event', 'reminder'];
                const out: CalendarInfo[] = [];
                for (const k of kinds) {
                    for (const s of await sources(k)) {
                        const parentUid = s.get_parent();
                        const parent = parentUid ? reg.ref_source(parentUid) : null;
                        const accountId = goaAccountId(s, (uid) => reg.ref_source(uid), lib.SOURCE_EXTENSION_GOA);
                        out.push({
                            uid: s.get_uid(),
                            name: s.get_display_name(),
                            kind: k,
                            backend: 'eds',
                            account: parent?.get_display_name() ?? null,
                            ...(accountId ? { accountId } : {}),
                        });
                    }
                }
                return out;
            }),

        listItems: (q: ItemQuery) =>
            boundary('listItems', async () => {
                const { ECal: lib } = await cal.get();
                let sexp = '#t';
                if (q.kind === 'event' && q.from && q.to) {
                    const start = lib.isodate_from_time_t(Math.floor(Date.parse(q.from) / 1000));
                    const end = lib.isodate_from_time_t(Math.floor(Date.parse(q.to) / 1000));
                    sexp = `(occur-in-time-range? (make-time "${start}") (make-time "${end}"))`;
                }
                let list = await sources(q.kind);
                if (q.calendarUid) list = list.filter((s) => s.get_uid() === q.calendarUid);

                const items: RawItem[] = [];
                let opened = 0;
                let lastError: unknown = null;
                for (const src of list) {
                    let client: ECal.Client;
                    try {
                        client = await connect(src, q.kind);
                        opened++;
                    } catch (err) {
                        // One unreachable account must not hide every other calendar.
                        lastError = err;
                        continue;
                    }
                    try {
                        for (const ical of await query(client, sexp)) items.push({ calendarUid: src.get_uid(), ical });
                    } catch (err) {
                        throw edsError(`get_object_list_as_comps(${src.get_display_name()})`, err);
                    }
                }
                if (opened === 0 && list.length > 0 && lastError) throw edsError('connect calendar', lastError);
                return items;
            }),

        getItem: (calendarUid, kind, uid) =>
            boundary('getItem', async () => {
                const client = await connect(await source(kind, calendarUid), kind);
                // A uid query, not get_object: "not found" is then an empty list rather than a GError
                // whose domain and code differ between GJS and node-gi.
                const found = await query(client, `(uid? ${sexpString(uid)})`);
                // EDS has no ETag; it serialises writes itself, so there is no value to make one
                // conditional on.
                return found[0] === undefined ? null : { ical: found[0], etag: null };
            }),

        createItem: (calendarUid, kind, ical) =>
            boundary('createItem', async () => {
                const { ECal: lib, ICalGLib } = await cal.get();
                const client = await connect(await source(kind, calendarUid), kind);
                if (client.is_readonly())
                    throw new BackendError(fmt(_('"{calendar}" is read-only'), { calendar: calendarUid }));
                const comp = ICalGLib.Component.new_from_string(ical);
                const uid = unwrapResult<string>(await client.create_object(comp, lib.OperationFlags.NONE, null));
                return typeof uid === 'string' ? uid : '';
            }),

        updateItem: (calendarUid, kind, _uid, ical) =>
            boundary('updateItem', async () => {
                const { ECal: lib, ICalGLib } = await cal.get();
                const client = await connect(await source(kind, calendarUid), kind);
                if (client.is_readonly())
                    throw new BackendError(fmt(_('"{calendar}" is read-only'), { calendar: calendarUid }));
                const comp = ICalGLib.Component.new_from_string(ical);
                // THIS, not THIS_AND_FUTURE: a recurring task is edited as its series definition, which
                // is the only form this backend ever hands out.
                await client.modify_object(comp, lib.ObjModType.THIS, lib.OperationFlags.NONE, null);
            }),
    };
}
