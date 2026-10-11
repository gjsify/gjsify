import type { DavAuth } from './auth.js';
import {
    NS_CALDAV,
    NS_CARDDAV,
    NS_CS,
    NS_DAV,
    addressbookQueryBody,
    calendarQueryBody,
    childText,
    directChildren,
    hasChild,
    multigetBody,
    okProp,
    parseMultistatus,
    propfindBody,
    syncCollectionBody,
    type DavResponse,
    type Multistatus,
    type TimeRange,
} from './xml.js';

export type DavKind = 'caldav' | 'carddav';
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface DavClientOptions {
    auth?: DavAuth;
    /** Defaults to the runtime's global fetch. Inject one for tests or a custom TLS setup. */
    fetch?: FetchLike;
}

export class DavError extends Error {
    constructor(
        readonly status: number,
        readonly url: string,
        readonly method: string,
        message?: string,
    ) {
        super(message ?? `DAV ${method} ${url} failed with ${status}`);
        this.name = 'DavError';
    }
    /** If-Match / If-None-Match precondition failed: the object changed or already exists. */
    get isPreconditionFailed(): boolean {
        return this.status === 412;
    }
}

export interface Discovery {
    principalUrl: string;
    homeUrl: string;
}

export interface Collection {
    url: string;
    kind: DavKind;
    displayName: string | null;
    ctag: string | null;
    syncToken: string | null;
    /** Supported components such as VEVENT and VTODO; empty for address books. */
    components: string[];
}

export interface DavObject {
    url: string;
    etag: string | null;
    /** iCalendar or vCard text; undefined when only the ETag was requested. */
    data?: string;
}

export interface SyncResult {
    syncToken: string | null;
    changed: DavObject[];
    deleted: string[];
}

export interface WriteOptions {
    /** Replace only if the server still has this ETag. */
    ifMatch?: string;
    /** Create only; fail with 412 if the URL exists. */
    ifNoneMatch?: boolean;
    contentType?: string;
}

// The bare identifier lets `gjsify build --globals auto` inject the fetch polyfill on GJS.
const defaultFetch: FetchLike = (url, init) => fetch(url, init);

const DATA = {
    caldav: { ns: NS_CALDAV, name: 'calendar-data' },
    carddav: { ns: NS_CARDDAV, name: 'address-data' },
} as const;

export class DavClient {
    private readonly auth?: DavAuth;
    private readonly doFetch: FetchLike;

    constructor(options: DavClientOptions = {}) {
        this.auth = options.auth;
        this.doFetch = options.fetch ?? defaultFetch;
    }

    private async request(
        method: string,
        url: string,
        init: { headers?: Record<string, string>; body?: string } = {},
    ): Promise<Response> {
        const headers = { ...(await this.auth?.()), ...init.headers };
        return this.doFetch(url, { method, headers, body: init.body });
    }

    private async xml(
        method: 'PROPFIND' | 'REPORT',
        url: string,
        body: string,
        depth: '0' | '1',
    ): Promise<{ ms: Multistatus; url: string }> {
        const res = await this.request(method, url, {
            headers: { 'Content-Type': 'application/xml; charset=utf-8', Depth: depth },
            body,
        });
        if (res.status !== 207) {
            await res.text().catch(() => '');
            throw new DavError(res.status, url, method);
        }
        return { ms: parseMultistatus(await res.text()), url: res.url || url };
    }

    /**
     * Find the principal and the calendar/address-book home. `serverUrl` is the server root or any
     * URL the user typed; `/.well-known/caldav|carddav` (RFC 6764) is tried first, then `serverUrl`.
     */
    async discover(kind: DavKind, serverUrl: string): Promise<Discovery> {
        const origin = new URL(serverUrl).origin;
        const candidates = [`${origin}/.well-known/${kind === 'caldav' ? 'caldav' : 'carddav'}`, serverUrl];
        let principalUrl: string | null = null;
        let lastError: unknown;
        for (const candidate of candidates) {
            try {
                const { ms, url } = await this.xml(
                    'PROPFIND',
                    candidate,
                    propfindBody(['D:current-user-principal']),
                    '0',
                );
                const prop = ms.responses.map(okProp).find((p) => p);
                const href = prop && directChildren(prop, NS_DAV, 'current-user-principal')[0];
                const value = href && childText(href, NS_DAV, 'href');
                principalUrl = new URL(value?.trim() || url, url).href;
                break;
            } catch (e) {
                lastError = e;
            }
        }
        if (!principalUrl) throw lastError instanceof Error ? lastError : new Error('DAV: discovery failed');

        const homeName = kind === 'caldav' ? 'calendar-home-set' : 'addressbook-home-set';
        const homeNs = kind === 'caldav' ? NS_CALDAV : NS_CARDDAV;
        const { ms, url } = await this.xml(
            'PROPFIND',
            principalUrl,
            propfindBody([`${kind === 'caldav' ? 'C' : 'A'}:${homeName}`]),
            '0',
        );
        const prop = ms.responses.map(okProp).find((p) => p);
        const home = prop && directChildren(prop, homeNs, homeName)[0];
        const href = home && childText(home, NS_DAV, 'href');
        if (!href) throw new Error(`DAV: server returned no ${homeName}`);
        return { principalUrl, homeUrl: new URL(href.trim(), url).href };
    }

    async listCollections(homeUrl: string, kind: DavKind): Promise<Collection[]> {
        const { ms, url } = await this.xml(
            'PROPFIND',
            homeUrl,
            propfindBody([
                'D:resourcetype',
                'D:displayname',
                'CS:getctag',
                'D:sync-token',
                'C:supported-calendar-component-set',
            ]),
            '1',
        );
        const type = kind === 'caldav' ? { ns: NS_CALDAV, name: 'calendar' } : { ns: NS_CARDDAV, name: 'addressbook' };
        const out: Collection[] = [];
        for (const r of ms.responses) {
            const prop = okProp(r);
            const rt = prop && directChildren(prop, NS_DAV, 'resourcetype')[0];
            if (!prop || !rt || !hasChild(rt, type.ns, type.name)) continue;
            const set = directChildren(prop, NS_CALDAV, 'supported-calendar-component-set')[0];
            out.push({
                url: new URL(r.href, url).href,
                kind,
                displayName: childText(prop, NS_DAV, 'displayname'),
                ctag: childText(prop, NS_CS, 'getctag'),
                syncToken: childText(prop, NS_DAV, 'sync-token'),
                components: set ? directChildren(set, NS_CALDAV, 'comp').map((c) => c.getAttribute('name') ?? '') : [],
            });
        }
        return out;
    }

    /** URLs and ETags of every object (optionally one component type and time range for calendars). */
    async listObjects(
        collectionUrl: string,
        kind: DavKind,
        filter: { component?: string; range?: TimeRange } = {},
    ): Promise<DavObject[]> {
        const body =
            kind === 'caldav' ? calendarQueryBody(filter.component ?? 'VEVENT', filter.range) : addressbookQueryBody();
        const { ms, url } = await this.xml('REPORT', collectionUrl, body, '1');
        return this.objects(ms.responses, kind, url);
    }

    /** Fetch full iCalendar/vCard text for the given object URLs (calendar-multiget / addressbook-multiget). */
    async getObjects(collectionUrl: string, kind: DavKind, urls: string[]): Promise<DavObject[]> {
        if (urls.length === 0) return [];
        const hrefs = urls.map((u) => new URL(u, collectionUrl).pathname);
        const { ms, url } = await this.xml('REPORT', collectionUrl, multigetBody(kind, hrefs), '1');
        return this.objects(ms.responses, kind, url);
    }

    /** RFC 6578 delta sync. Pass `null` for the initial sync. A 403/409/507 means the token is stale: resync. */
    async sync(collectionUrl: string, token: string | null): Promise<SyncResult> {
        const { ms, url } = await this.xml('REPORT', collectionUrl, syncCollectionBody(token), '1');
        const changed: DavObject[] = [];
        const deleted: string[] = [];
        for (const r of ms.responses) {
            const abs = new URL(r.href, url).href;
            if (r.status === 404 || r.propstats.some((p) => p.status === 404 && !okProp(r))) {
                deleted.push(abs);
                continue;
            }
            const prop = okProp(r);
            if (!prop || abs === new URL(collectionUrl, url).href) continue;
            changed.push({ url: abs, etag: childText(prop, NS_DAV, 'getetag') });
        }
        return { syncToken: ms.syncToken, changed, deleted };
    }

    /** Create or replace. Returns the new ETag, or null when the server does not send one (refetch then). */
    async put(url: string, data: string, options: WriteOptions = {}): Promise<{ etag: string | null }> {
        const headers: Record<string, string> = {
            'Content-Type':
                options.contentType ??
                (url.endsWith('.vcf') ? 'text/vcard; charset=utf-8' : 'text/calendar; charset=utf-8'),
        };
        if (options.ifMatch) headers['If-Match'] = options.ifMatch;
        if (options.ifNoneMatch) headers['If-None-Match'] = '*';
        const res = await this.request('PUT', url, { headers, body: data });
        await res.text().catch(() => '');
        if (res.status < 200 || res.status >= 300) throw new DavError(res.status, url, 'PUT');
        return { etag: res.headers.get('etag') };
    }

    async delete(url: string, options: { ifMatch?: string } = {}): Promise<void> {
        const headers: Record<string, string> = options.ifMatch ? { 'If-Match': options.ifMatch } : {};
        const res = await this.request('DELETE', url, { headers });
        await res.text().catch(() => '');
        if (res.status < 200 || res.status >= 300) throw new DavError(res.status, url, 'DELETE');
    }

    private objects(responses: DavResponse[], kind: DavKind, base: string): DavObject[] {
        const out: DavObject[] = [];
        for (const r of responses) {
            const prop = okProp(r);
            if (!prop) continue;
            const data = childText(prop, DATA[kind].ns, DATA[kind].name);
            out.push({
                url: new URL(r.href, base).href,
                etag: childText(prop, NS_DAV, 'getetag'),
                ...(data !== null ? { data } : {}),
            });
        }
        return out;
    }
}
