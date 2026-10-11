import { describe, it, expect } from '@gjsify/unit';
import { DavClient, DavError, basicAuth, bearerAuth, parseMultistatus } from './index.js';

interface Call {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
}
type Reply = { status: number; body?: string; headers?: Record<string, string> };

function mock(replies: Reply[]) {
    const calls: Call[] = [];
    const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
        calls.push({
            method: String(init.method),
            url,
            headers: { ...(init.headers as Record<string, string>) },
            body: init.body as string | undefined,
        });
        const r = replies.shift();
        if (!r) throw new Error('unexpected request ' + url);
        return new Response(r.status === 204 ? null : (r.body ?? ''), { status: r.status, headers: r.headers });
    };
    return { calls, client: (auth = basicAuth('u', 'p')) => new DavClient({ auth, fetch: fetchFn }) };
}

const ms = (inner: string, extra = '') =>
    `<?xml version="1.0" encoding="utf-8" ?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" ` +
    `xmlns:A="urn:ietf:params:xml:ns:carddav" xmlns:CS="http://calendarserver.org/ns/">${inner}${extra}</D:multistatus>`;
const ok = 'HTTP/1.1 200 OK';

// RFC 6764 / 4791 section 7.1 / 6352 shaped responses
const PRINCIPAL = ms(
    `<D:response><D:href>/</D:href><D:propstat><D:prop><D:current-user-principal>` +
        `<D:href>/principals/users/bernard/</D:href></D:current-user-principal></D:prop><D:status>${ok}</D:status></D:propstat></D:response>`,
);
const HOME = ms(
    `<D:response><D:href>/principals/users/bernard/</D:href><D:propstat><D:prop><C:calendar-home-set>` +
        `<D:href>/calendars/bernard/</D:href></C:calendar-home-set></D:prop><D:status>${ok}</D:status></D:propstat></D:response>`,
);
const COLLECTIONS = ms(
    `<D:response><D:href>/calendars/bernard/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype>` +
        `</D:prop><D:status>${ok}</D:status></D:propstat></D:response>` +
        `<D:response><D:href>/calendars/bernard/work/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/><C:calendar/>` +
        `</D:resourcetype><D:displayname>Work</D:displayname><CS:getctag>ct-1</CS:getctag><D:sync-token>tok-1</D:sync-token>` +
        `<C:supported-calendar-component-set><C:comp name="VEVENT"/><C:comp name="VTODO"/></C:supported-calendar-component-set>` +
        `</D:prop><D:status>${ok}</D:status></D:propstat></D:response>`,
);
const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
const LIST = ms(
    `<D:response><D:href>/calendars/bernard/work/a.ics</D:href><D:propstat><D:prop><D:getetag>"e1"</D:getetag>` +
        `</D:prop><D:status>${ok}</D:status></D:propstat></D:response>`,
);
const MULTIGET = ms(
    `<D:response><D:href>/calendars/bernard/work/a.ics</D:href><D:propstat><D:prop><D:getetag>"e1"</D:getetag>` +
        `<C:calendar-data>${ICS.replace(/\r/g, '&#13;')}</C:calendar-data></D:prop><D:status>${ok}</D:status></D:propstat></D:response>`,
);
// RFC 6578 section 3.8 shape: a 404 response means deleted
const SYNC = ms(
    `<D:response><D:href>/calendars/bernard/work/a.ics</D:href><D:propstat><D:prop><D:getetag>"e2"</D:getetag></D:prop>` +
        `<D:status>${ok}</D:status></D:propstat></D:response>` +
        `<D:response><D:href>/calendars/bernard/work/gone.ics</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>`,
    '<D:sync-token>tok-2</D:sync-token>',
);

const MS = { status: 207 };

export default async () => {
    await describe('multistatus parser', async () => {
        await it('reads hrefs, statuses and the sync token by namespace', async () => {
            const parsed = parseMultistatus(SYNC);
            expect(parsed.syncToken).toBe('tok-2');
            expect(parsed.responses.length).toBe(2);
            expect(parsed.responses[0].propstats[0].status).toBe(200);
            expect(parsed.responses[1].status).toBe(404);
        });
        await it('does not depend on the prefix', async () => {
            const parsed = parseMultistatus(
                '<x:multistatus xmlns:x="DAV:"><x:response><x:href>/a</x:href><x:status>HTTP/1.1 404 Not Found</x:status></x:response></x:multistatus>',
            );
            expect(parsed.responses[0].href).toBe('/a');
        });
        await it('rejects a non-multistatus root', async () => {
            let failed = false;
            try {
                parseMultistatus('<html/>');
            } catch {
                failed = true;
            }
            expect(failed).toBe(true);
        });
    });

    await describe('DavClient', async () => {
        await it('discovers principal and calendar home, sending Depth and auth', async () => {
            const m = mock([
                { ...MS, body: PRINCIPAL },
                { ...MS, body: HOME },
            ]);
            const d = await m.client().discover('caldav', 'https://dav.example.org/');
            expect(d.principalUrl).toBe('https://dav.example.org/principals/users/bernard/');
            expect(d.homeUrl).toBe('https://dav.example.org/calendars/bernard/');
            expect(m.calls[0].url).toBe('https://dav.example.org/.well-known/caldav');
            expect(m.calls[0].method).toBe('PROPFIND');
            expect(m.calls[0].headers['Depth']).toBe('0');
            expect(m.calls[0].headers['Authorization']).toBe('Basic dTpw');
        });
        await it('falls back to the given URL when well-known fails', async () => {
            const m = mock([{ status: 404 }, { ...MS, body: PRINCIPAL }, { ...MS, body: HOME }]);
            await m.client().discover('caldav', 'https://dav.example.org/dav/');
            expect(m.calls[1].url).toBe('https://dav.example.org/dav/');
        });
        await it('lists only real collections with metadata', async () => {
            const m = mock([{ ...MS, body: COLLECTIONS }]);
            const list = await m.client().listCollections('https://dav.example.org/calendars/bernard/', 'caldav');
            expect(list.length).toBe(1);
            expect(list[0].url).toBe('https://dav.example.org/calendars/bernard/work/');
            expect(list[0].displayName).toBe('Work');
            expect(list[0].ctag).toBe('ct-1');
            expect(list[0].syncToken).toBe('tok-1');
            expect(list[0].components.join(',')).toBe('VEVENT,VTODO');
            expect(m.calls[0].headers['Depth']).toBe('1');
        });
        await it('lists objects with calendar-query and fetches data with multiget', async () => {
            const m = mock([
                { ...MS, body: LIST },
                { ...MS, body: MULTIGET },
            ]);
            const c = m.client();
            const base = 'https://dav.example.org/calendars/bernard/work/';
            const objs = await c.listObjects(base, 'caldav', { range: { start: '20260101T000000Z' } });
            expect(objs[0].etag).toBe('"e1"');
            expect(m.calls[0].method).toBe('REPORT');
            expect(m.calls[0].body!.includes('calendar-query')).toBe(true);
            expect(m.calls[0].body!.includes('time-range')).toBe(true);
            const full = await c.getObjects(base, 'caldav', [objs[0].url]);
            expect(full[0].data).toBe(ICS);
            expect(m.calls[1].body!.includes('/calendars/bernard/work/a.ics')).toBe(true);
        });
        await it('syncs: changed objects, 404 as deleted, new token', async () => {
            const m = mock([{ ...MS, body: SYNC }]);
            const r = await m.client().sync('https://dav.example.org/calendars/bernard/work/', 'tok-1');
            expect(r.syncToken).toBe('tok-2');
            expect(r.changed.length).toBe(1);
            expect(r.changed[0].etag).toBe('"e2"');
            expect(r.deleted[0]).toBe('https://dav.example.org/calendars/bernard/work/gone.ics');
            expect(m.calls[0].body!.includes('<D:sync-token>tok-1</D:sync-token>')).toBe(true);
        });
        await it('PUT sends If-None-Match for create and If-Match for update', async () => {
            const m = mock([{ status: 201, headers: { ETag: '"n1"' } }, { status: 204 }]);
            const c = m.client();
            const url = 'https://dav.example.org/calendars/bernard/work/a.ics';
            expect((await c.put(url, ICS, { ifNoneMatch: true })).etag).toBe('"n1"');
            expect(m.calls[0].headers['If-None-Match']).toBe('*');
            expect((await c.put(url, ICS, { ifMatch: '"n1"' })).etag).toBe(null);
            expect(m.calls[1].headers['If-Match']).toBe('"n1"');
            expect(m.calls[1].headers['Content-Type']).toBe('text/calendar; charset=utf-8');
        });
        await it('reports a failed precondition as DavError 412', async () => {
            const m = mock([{ status: 412 }, { status: 412 }]);
            const c = m.client();
            const url = 'https://dav.example.org/c/a.vcf';
            for (const run of [
                () => c.put(url, 'x', { ifMatch: '"old"' }),
                () => c.delete(url, { ifMatch: '"old"' }),
            ]) {
                let err: unknown;
                try {
                    await run();
                } catch (e) {
                    err = e;
                }
                expect(err instanceof DavError && err.isPreconditionFailed).toBe(true);
            }
        });
        await it('DELETE sends If-Match', async () => {
            const m = mock([{ status: 204 }]);
            await m.client().delete('https://dav.example.org/c/a.ics', { ifMatch: '"e"' });
            expect(m.calls[0].method).toBe('DELETE');
            expect(m.calls[0].headers['If-Match']).toBe('"e"');
        });
        await it('accepts a Bearer provider that refreshes per request', async () => {
            const m = mock([{ status: 204 }, { status: 204 }]);
            let n = 0;
            const c = m.client(bearerAuth(() => `t${++n}`));
            await c.delete('https://x.example/a');
            await c.delete('https://x.example/b');
            expect(m.calls[0].headers['Authorization']).toBe('Bearer t1');
            expect(m.calls[1].headers['Authorization']).toBe('Bearer t2');
        });
    });
};
