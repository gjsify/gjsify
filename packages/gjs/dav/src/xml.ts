import { DOMParser } from '@gjsify/domparser';

export const NS_DAV = 'DAV:';
export const NS_CALDAV = 'urn:ietf:params:xml:ns:caldav';
export const NS_CARDDAV = 'urn:ietf:params:xml:ns:carddav';
export const NS_CS = 'http://calendarserver.org/ns/';

type Node = ReturnType<DOMParser['parseFromString']>['documentElement'];
type El = NonNullable<Node>;

export interface PropStat {
    /** HTTP status code from the `D:status` line, 0 when unparsable. */
    status: number;
    /** The `D:prop` element; query it with {@link childText} and {@link hasChild}. */
    prop: El;
}

export interface DavResponse {
    href: string;
    /** Set on responses that carry a status instead of propstats (sync-collection deletions). */
    status: number | null;
    propstats: PropStat[];
}

export interface Multistatus {
    responses: DavResponse[];
    syncToken: string | null;
}

export function parseStatus(line: string | null | undefined): number {
    const m = /\s(\d{3})(\s|$)/.exec(line ?? '');
    return m ? Number(m[1]) : 0;
}

export function directChildren(el: El, ns: string, local: string): El[] {
    return el.children.filter((c) => c.namespaceURI === ns && c.localName === local.toLowerCase()) as El[];
}

export function childText(el: El, ns: string, local: string): string | null {
    const c = directChildren(el, ns, local)[0];
    return c ? (c.textContent ?? '') : null;
}

export function hasChild(el: El, ns: string, local: string): boolean {
    return directChildren(el, ns, local).length > 0;
}

export function parseXml(text: string): El {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const root = doc.documentElement;
    if (!root) throw new Error('DAV: empty XML response');
    return root as El;
}

export function parseMultistatus(text: string): Multistatus {
    const root = parseXml(text);
    if (root.namespaceURI !== NS_DAV || root.localName !== 'multistatus') {
        throw new Error(`DAV: expected D:multistatus, got ${root.tagName}`);
    }
    const responses: DavResponse[] = [];
    for (const r of directChildren(root, NS_DAV, 'response')) {
        const status = childText(r, NS_DAV, 'status');
        responses.push({
            href: (childText(r, NS_DAV, 'href') ?? '').trim(),
            status: status === null ? null : parseStatus(status),
            propstats: directChildren(r, NS_DAV, 'propstat').flatMap((ps) => {
                const prop = directChildren(ps, NS_DAV, 'prop')[0];
                return prop ? [{ status: parseStatus(childText(ps, NS_DAV, 'status')), prop }] : [];
            }),
        });
    }
    return { responses, syncToken: childText(root, NS_DAV, 'sync-token') };
}

/** The first propstat that succeeded (2xx), or undefined. */
export function okProp(r: DavResponse): El | undefined {
    return r.propstats.find((p) => p.status >= 200 && p.status < 300)?.prop;
}

export function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const HEAD = '<?xml version="1.0" encoding="utf-8"?>\n';
const NSDECL = `xmlns:D="${NS_DAV}" xmlns:C="${NS_CALDAV}" xmlns:A="${NS_CARDDAV}" xmlns:CS="${NS_CS}"`;

/** `props` are prefixed names such as `D:getetag`, using the D/C/A/CS prefixes declared above. */
export function propfindBody(props: string[]): string {
    return `${HEAD}<D:propfind ${NSDECL}><D:prop>${props.map((p) => `<${p}/>`).join('')}</D:prop></D:propfind>`;
}

export interface TimeRange {
    /** iCalendar UTC date-time, e.g. 20260101T000000Z */
    start: string;
    end?: string;
}

/** `uid` adds an RFC 4791 §9.7.5 prop-filter; `i;octet` because UIDs are case-sensitive. */
export function calendarQueryBody(component: string, range?: TimeRange, uid?: string): string {
    const tr = range
        ? `<C:time-range start="${escapeXml(range.start)}"${range.end ? ` end="${escapeXml(range.end)}"` : ''}/>`
        : '';
    const uidFilter =
        uid === undefined
            ? ''
            : `<C:prop-filter name="UID"><C:text-match collation="i;octet">${escapeXml(uid)}</C:text-match></C:prop-filter>`;
    return (
        `${HEAD}<C:calendar-query ${NSDECL}><D:prop><D:getetag/></D:prop>` +
        `<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="${escapeXml(component)}">${tr}${uidFilter}` +
        `</C:comp-filter></C:comp-filter></C:filter></C:calendar-query>`
    );
}

export function addressbookQueryBody(): string {
    return `${HEAD}<A:addressbook-query ${NSDECL}><D:prop><D:getetag/></D:prop></A:addressbook-query>`;
}

export function multigetBody(kind: 'caldav' | 'carddav', hrefs: string[]): string {
    const p = kind === 'caldav' ? 'C' : 'A';
    const data = kind === 'caldav' ? 'C:calendar-data' : 'A:address-data';
    return (
        `${HEAD}<${p}:${kind === 'caldav' ? 'calendar' : 'addressbook'}-multiget ${NSDECL}>` +
        `<D:prop><D:getetag/><${data}/></D:prop>${hrefs.map((h) => `<D:href>${escapeXml(h)}</D:href>`).join('')}` +
        `</${p}:${kind === 'caldav' ? 'calendar' : 'addressbook'}-multiget>`
    );
}

export function syncCollectionBody(token: string | null): string {
    return (
        `${HEAD}<D:sync-collection ${NSDECL}><D:sync-token>${token ? escapeXml(token) : ''}</D:sync-token>` +
        `<D:sync-level>1</D:sync-level><D:prop><D:getetag/></D:prop></D:sync-collection>`
    );
}
