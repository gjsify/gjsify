// XML namespaces: the scanner resolves `xmlns` / `xmlns:p` while it parses, so a
// WebDAV multistatus (RFC 4918 § 14, RFC 4791 § 7.8.3 examples) can be read by
// namespace + local name instead of by whatever prefix a server chose.

import { describe, it, expect } from '@gjsify/unit';
import { DOMParser } from '@gjsify/domparser';

const DAV = 'DAV:';
const CALDAV = 'urn:ietf:params:xml:ns:caldav';

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

export default async () => {
    await describe('XML namespaces', async () => {
        await it('resolves a prefix declared on the root', async () => {
            const root = parse('<D:multistatus xmlns:D="DAV:"><D:response/></D:multistatus>').documentElement!;
            expect(root.namespaceURI).toBe(DAV);
            expect(root.prefix).toBe('D');
            expect(root.localName).toBe('multistatus');
            expect(root.tagName).toBe('d:multistatus');
            expect(root.children[0].namespaceURI).toBe(DAV);
        });

        await it('applies the default namespace to unprefixed elements', async () => {
            const root = parse('<multistatus xmlns="DAV:"><response/></multistatus>').documentElement!;
            expect(root.namespaceURI).toBe(DAV);
            expect(root.prefix).toBeNull();
            expect(root.children[0].namespaceURI).toBe(DAV);
        });

        await it('lets an inner declaration shadow and leave again', async () => {
            const root = parse(
                '<a:x xmlns:a="urn:one"><a:y xmlns:a="urn:two"><a:z/></a:y><a:w/></a:x>',
            ).documentElement!;
            const [y, w] = root.children;
            expect(y.namespaceURI).toBe('urn:two');
            expect(y.children[0].namespaceURI).toBe('urn:two');
            expect(w.namespaceURI).toBe('urn:one');
        });

        await it('ends a default namespace with xmlns=""', async () => {
            const root = parse('<a xmlns="urn:one"><b xmlns=""><c/></b></a>').documentElement!;
            expect(root.namespaceURI).toBe('urn:one');
            expect(root.children[0].namespaceURI).toBeNull();
            expect(root.children[0].children[0].namespaceURI).toBeNull();
        });

        await it('reports null for an undeclared prefix and for no namespace', async () => {
            const root = parse('<x:a><b/></x:a>').documentElement!;
            expect(root.namespaceURI).toBeNull();
            expect(root.prefix).toBe('x');
            expect(root.children[0].namespaceURI).toBeNull();
        });

        await it('knows the xml prefix without a declaration', async () => {
            expect(parse('<xml:a/>').documentElement!.namespaceURI).toBe('http://www.w3.org/XML/1998/namespace');
        });

        await it('keeps the xmlns attributes readable', async () => {
            const root = parse('<D:a xmlns:D="DAV:" xmlns="urn:d"/>').documentElement!;
            expect(root.getAttribute('xmlns:D')).toBe(DAV);
            expect(root.getAttribute('xmlns')).toBe('urn:d');
        });

        await describe('getElementsByTagNameNS', async () => {
            const doc = parse(`<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/cal/a.ics</D:href>
    <D:propstat><D:prop><D:getetag>"a"</D:getetag><C:calendar-data>BEGIN:VCALENDAR&#13;
END:VCALENDAR</C:calendar-data></D:prop></D:propstat>
  </D:response>
  <D:response><D:href>/cal/b.ics</D:href></D:response>
</D:multistatus>`);

            await it('finds descendants by namespace and local name, in document order', async () => {
                const hrefs = doc.getElementsByTagNameNS(DAV, 'href');
                expect(hrefs.length).toBe(2);
                expect(hrefs[0].textContent).toBe('/cal/a.ics');
                expect(hrefs[1].textContent).toBe('/cal/b.ics');
            });

            await it('separates two namespaces that share a local name', async () => {
                expect(doc.getElementsByTagNameNS(CALDAV, 'href').length).toBe(0);
                expect(doc.getElementsByTagNameNS(CALDAV, 'calendar-data').length).toBe(1);
            });

            await it('reads character references inside the matched element', async () => {
                const data = doc.getElementsByTagNameNS(CALDAV, 'calendar-data')[0];
                expect(data.textContent).toBe('BEGIN:VCALENDAR\r\nEND:VCALENDAR');
            });

            await it('treats * as any namespace or any name', async () => {
                expect(doc.getElementsByTagNameNS('*', 'href').length).toBe(2);
                expect(doc.getElementsByTagNameNS(DAV, '*').length).toBe(8);
            });

            await it('does not return the element it is called on', async () => {
                const root = doc.documentElement!;
                expect(root.getElementsByTagNameNS(DAV, 'multistatus').length).toBe(0);
                expect(doc.getElementsByTagNameNS(DAV, 'multistatus').length).toBe(1);
            });

            await it('matches null against elements in no namespace', async () => {
                const plain = parse('<a><b/><c xmlns="urn:x"/></a>');
                expect(plain.getElementsByTagNameNS(null, 'b').length).toBe(1);
                expect(plain.getElementsByTagNameNS(null, 'c').length).toBe(0);
            });
        });

        await it('lets a type selector match a prefixed element by its local name', async () => {
            const doc = parse('<D:a xmlns:D="DAV:"><D:b/></D:a>');
            expect(doc.querySelectorAll('b').length).toBe(1);
        });

        await it('leaves HTML elements without a namespace', async () => {
            const doc = new DOMParser().parseFromString('<p>x</p>', 'text/html');
            expect(doc.querySelector('p')!.namespaceURI).toBeNull();
        });
    });
};
