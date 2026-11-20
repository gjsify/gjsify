/**
 * An in-process CalDAV server on localhost: just enough PROPFIND / REPORT / PUT to drive the
 * backend, answering fixture multistatus XML. Records every request so tests can assert on it.
 */

import { createServer, type Server, type ServerResponse } from 'node:http';

export interface RecordedRequest {
    method: string;
    path: string;
    body: string;
    ifNoneMatch: string | undefined;
    ifMatch: string | undefined;
}

export interface FakeDav {
    url: string;
    requests: RecordedRequest[];
    /** Resources by path, e.g. `/cal/events/a.ics`. */
    resources: Map<string, string>;
    /** Replace a resource as another client would: new content, new etag. */
    tamper(path: string, data: string): void;
    /** Delete a resource as another client would. */
    remove(path: string): void;
    /** From now on every sync token the server handed out is answered with 403 valid-sync-token. */
    expireTokens(): void;
    /** From now on every authenticated request is answered with this status and Retry-After header. */
    throttle(status: number, retryAfter: string): void;
    close(): Promise<void>;
}

const NS = 'xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/"';

const response = (href: string, prop: string) =>
    `<D:response><D:href>${href}</D:href><D:propstat><D:prop>${prop}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
const multistatus = (inner: string) =>
    `<?xml version="1.0" encoding="utf-8"?><D:multistatus ${NS}>${inner}</D:multistatus>`;

const collection = (href: string, name: string, comps: string[], version: string) =>
    response(
        href,
        `<D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>${name}</D:displayname>` +
            version +
            `<C:supported-calendar-component-set>${comps.map((c) => `<C:comp name="${c}"/>`).join('')}</C:supported-calendar-component-set>`,
    );

export async function startFakeDav(options: {
    user: string;
    password: string;
    resources: Record<string, string>;
    /** `token` (default): ctag + RFC 6578 sync-collection. `ctag`: a ctag only, no sync-token. */
    sync?: 'token' | 'ctag';
}): Promise<FakeDav> {
    const resources = new Map(Object.entries(options.resources));
    const requests: RecordedRequest[] = [];
    const expected = `Basic ${Buffer.from(`${options.user}:${options.password}`).toString('base64')}`;
    // Every resource starts at "e"; a write moves it on, which is what If-Match is checked against.
    const etags = new Map<string, string>();
    const etagOf = (path: string) => etags.get(path) ?? '"e"';
    let revision = 0;
    // Collection state: one counter, a change log, and the ctag / sync token derived from it.
    let rev = 0;
    let tokensExpired = false;
    let throttled: { status: number; retryAfter: string } | null = null;
    const log: { rev: number; path: string; deleted: boolean }[] = [];
    const touch = (path: string, deleted: boolean) => log.push({ rev: ++rev, path, deleted });
    const versionProps = () =>
        `<CS:getctag>ctag-${rev}</CS:getctag>` +
        (options.sync === 'ctag' ? '' : `<D:sync-token>tok-${rev}</D:sync-token>`);

    const send = (res: ServerResponse, status: number, body = '', headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/xml; charset=utf-8', ...headers });
        res.end(body);
    };

    const server: Server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            const path = (req.url ?? '/').split('?')[0];
            const method = req.method ?? 'GET';
            requests.push({
                method,
                path,
                body,
                ifNoneMatch: req.headers['if-none-match'] as string | undefined,
                ifMatch: req.headers['if-match'] as string | undefined,
            });
            if (req.headers.authorization !== expected)
                return send(res, 401, '', { 'WWW-Authenticate': 'Basic realm="x"' });
            if (throttled) return send(res, throttled.status, '', { 'Retry-After': throttled.retryAfter });

            if (method === 'PROPFIND') {
                if (path === '/.well-known/caldav')
                    return send(
                        res,
                        207,
                        multistatus(
                            response(
                                path,
                                '<D:current-user-principal><D:href>/principals/me/</D:href></D:current-user-principal>',
                            ),
                        ),
                    );
                if (path === '/principals/me/')
                    return send(
                        res,
                        207,
                        multistatus(
                            response(path, '<C:calendar-home-set><D:href>/cal/</D:href></C:calendar-home-set>'),
                        ),
                    );
                if (path === '/cal/')
                    return send(
                        res,
                        207,
                        multistatus(
                            response('/cal/', '<D:resourcetype><D:collection/></D:resourcetype>') +
                                collection('/cal/events/', 'Events', ['VEVENT'], versionProps()) +
                                collection('/cal/tasks/', 'Tasks', ['VTODO'], versionProps()),
                        ),
                    );
                return send(res, 404);
            }
            if (method === 'REPORT') {
                const dir = path;
                const inDir = [...resources.keys()].filter((p) => p.startsWith(dir));
                if (body.includes('sync-collection')) {
                    const token = /<D:sync-token>([^<]*)<\/D:sync-token>/.exec(body)?.[1] ?? '';
                    const since = /^tok-(\d+)$/.exec(token)?.[1];
                    if (options.sync === 'ctag' || tokensExpired || (token !== '' && since === undefined))
                        return send(res, 403, '<D:error xmlns:D="DAV:"><D:valid-sync-token/></D:error>');
                    const after = since === undefined ? -1 : Number(since);
                    const latest = new Map<string, boolean>();
                    for (const c of log) if (c.rev > after && c.path.startsWith(dir)) latest.set(c.path, c.deleted);
                    if (since === undefined) for (const p of inDir) latest.set(p, false);
                    const rows = [...latest].map(([p, deleted]) =>
                        deleted
                            ? `<D:response><D:href>${p}</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>`
                            : response(p, `<D:getetag>${etagOf(p)}</D:getetag>`),
                    );
                    return send(res, 207, multistatus(rows.join('') + `<D:sync-token>tok-${rev}</D:sync-token>`));
                }
                if (body.includes('calendar-multiget')) {
                    const hrefs = [...body.matchAll(/<D:href>([^<]*)<\/D:href>/g)].map((m) => m[1]);
                    return send(
                        res,
                        207,
                        multistatus(
                            hrefs
                                .filter((h) => resources.has(h))
                                .map((h) =>
                                    response(
                                        h,
                                        `<D:getetag>${etagOf(h)}</D:getetag><C:calendar-data><![CDATA[${resources.get(h)}]]></C:calendar-data>`,
                                    ),
                                )
                                .join(''),
                        ),
                    );
                }
                const wanted = /comp-filter name="(VEVENT|VTODO)"/.exec(body)?.[1] ?? 'VEVENT';
                const wantedUid = /<C:text-match[^>]*>([^<]*)<\/C:text-match>/.exec(body)?.[1];
                return send(
                    res,
                    207,
                    multistatus(
                        inDir
                            .filter((p) => resources.get(p)!.includes(`BEGIN:${wanted}`))
                            .filter(
                                (p) => wantedUid === undefined || resources.get(p)!.includes(`UID:${wantedUid}\r\n`),
                            )
                            .map((p) => response(p, `<D:getetag>${etagOf(p)}</D:getetag>`))
                            .join(''),
                    ),
                );
            }
            if (method === 'PUT') {
                if (req.headers['if-none-match'] === '*' && resources.has(path)) return send(res, 412);
                const ifMatch = req.headers['if-match'] as string | undefined;
                if (ifMatch !== undefined && ifMatch !== etagOf(path)) return send(res, 412);
                resources.set(path, body);
                touch(path, false);
                const etag = `"r${++revision}"`;
                etags.set(path, etag);
                return send(res, 201, '', { ETag: etag });
            }
            return send(res, 405);
        });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;
    return {
        url: `http://127.0.0.1:${port}/`,
        requests,
        resources,
        tamper(path, data) {
            resources.set(path, data);
            etags.set(path, `"r${++revision}"`);
            touch(path, false);
        },
        remove(path) {
            resources.delete(path);
            touch(path, true);
        },
        expireTokens() {
            tokensExpired = true;
        },
        throttle(status, retryAfter) {
            throttled = { status, retryAfter };
        },
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
}
