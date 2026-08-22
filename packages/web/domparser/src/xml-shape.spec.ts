// The XML tree shape, frozen (ADR 0026 § Decision 4).
//
// The XML mode keeps every observable it has today, including the two that are
// WRONG by the XML spec — `tagName` lowercased, `nodeName` uppercased — because
// the one measured consumer (@excaliburjs/plugin-tiled) switches on lowercase tag
// literals at 24 sites. A note saying "careful, XML lowercases" is read by nobody;
// a golden that fails is read by whoever changed it.
//
// The fixture is TMX-shaped and exercises exactly the seven members that
// consumer uses — getAttribute, querySelector, children, tagName, textContent,
// innerHTML, attributes — and nothing else, so the freeze covers the contract
// rather than the implementation.

import { describe, expect, it } from '@gjsify/unit';
import { canonicalize, DOMParser, domTreeReader } from '@gjsify/domparser';

const TMX = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<map version="1.10" tiledversion="1.10.2" orientation="orthogonal" renderorder="right-down"',
    '     width="30" height="20" tilewidth="16" tileheight="16" infinite="0">',
    ' <properties>',
    '  <property name="title" value="Jelly Jumper"/>',
    '  <property name="credits" value="a &amp; b"/>',
    ' </properties>',
    ' <tileset firstgid="1" name="terrain" tilewidth="16" tileheight="16" tilecount="120" columns="12">',
    '  <image source="terrain.png" width="192" height="160"/>',
    '  <tile id="3">',
    '   <properties>',
    '    <property name="solid" type="bool" value="true"/>',
    '   </properties>',
    '  </tile>',
    ' </tileset>',
    ' <layer id="1" name="ground" width="4" height="2">',
    '  <data encoding="csv">1,2,3,4,5,6,7,8</data>',
    ' </layer>',
    ' <objectgroup id="2" name="objects">',
    '  <object id="1" name="spawn" x="32" y="48" width="16" height="16">',
    '   <properties>',
    '    <property name="note" value="start &gt; here"/>',
    '   </properties>',
    '  </object>',
    ' </objectgroup>',
    ' <!-- authored by hand -->',
    '</map>',
].join('\n');

const GOLDEN = [
    '#document',
    '  map height="20" infinite="0" orientation="orthogonal" renderorder="right-down" tiledversion="1.10.2" tileheight="16" tilewidth="16" version="1.10" width="30"',
    '    properties',
    '      property name="title" value="Jelly Jumper"',
    '      property name="credits" value="a & b"',
    '    tileset columns="12" firstgid="1" name="terrain" tilecount="120" tileheight="16" tilewidth="16"',
    '      image height="160" source="terrain.png" width="192"',
    '      tile id="3"',
    '        properties',
    '          property name="solid" type="bool" value="true"',
    '    layer height="2" id="1" name="ground" width="4"',
    '      data encoding="csv"',
    '        #text "1,2,3,4,5,6,7,8"',
    '    objectgroup id="2" name="objects"',
    '      object height="16" id="1" name="spawn" width="16" x="32" y="48"',
    '        properties',
    '          property name="note" value="start > here"',
    // A comment is a NODE now, not a skipped range (ADR 0026 § Decision 4). It is
    // the only line that moved when that landed, and it moves `children` and
    // `textContent` not at all — which is the whole reason the addition is safe.
    '    #comment " authored by hand "',
].join('\n');

export default async () => {
    await describe('XML tree shape (frozen)', async () => {
        await it('has a golden that describes a real tree', async () => {
            // Discriminators for the golden itself: a comparison of an empty
            // string with an empty string would otherwise be a passing test.
            expect(GOLDEN.split('\n').length).toBeGreaterThan(10);
            expect(GOLDEN).toContain('layer ');
            expect(GOLDEN).toContain('#text "1,2,3,4,5,6,7,8"');
        });

        await it('canonicalizes to the committed golden', async () => {
            const doc = new DOMParser().parseFromString(TMX, 'application/xml');
            expect(canonicalize(domTreeReader, doc)).toBe(GOLDEN);
        });

        await it('keeps tagName lowercase and nodeName uppercase', async () => {
            const doc = new DOMParser().parseFromString(TMX, 'application/xml');
            const map = doc.documentElement!;
            expect(map.tagName).toBe('map');
            expect(map.nodeName).toBe('MAP');
            expect(map.localName).toBe('map');
        });

        await it('exposes attributes as iterable name/value records', async () => {
            const doc = new DOMParser().parseFromString(TMX, 'application/xml');
            const image = doc.querySelector('image')!;
            expect(image).not.toBeNull();
            const seen: string[] = [];
            for (const attr of image.attributes) seen.push(attr.name + '=' + attr.value);
            expect(seen.length).toBe(3);
            expect(seen).toContain('source=terrain.png');
            expect(image.getAttribute('width')).toBe('192');
            expect(image.getAttribute('missing')).toBeNull();
        });

        await it('walks children, textContent and innerHTML', async () => {
            const doc = new DOMParser().parseFromString(TMX, 'application/xml');
            const map = doc.documentElement!;
            expect(map.children.length).toBe(4);
            expect(map.children.map((c) => c.tagName).join(',')).toBe('properties,tileset,layer,objectgroup');

            const layer = doc.querySelector('layer')!;
            expect(layer).not.toBeNull();
            expect(layer.getAttribute('name')).toBe('ground');
            expect(layer.querySelector('data')!.textContent).toBe('1,2,3,4,5,6,7,8');
            expect(layer.innerHTML).toContain('<data encoding="csv">1,2,3,4,5,6,7,8</data>');

            // Strict decoding is wired into the XML path too.
            const credits = doc.querySelectorAll('property')[1];
            expect(credits.getAttribute('value')).toBe('a & b');
        });

        await it('keeps comments and the doctype as nodes, and nothing else moves', async () => {
            const doc = new DOMParser().parseFromString(
                '<!DOCTYPE map SYSTEM "map.dtd"><map><!-- c --><layer/></map>',
                'application/xml',
            );
            expect(doc.doctype).not.toBeNull();
            expect(doc.doctype!.name).toBe('map');

            const map = doc.documentElement!;
            expect(map.childNodes.length).toBe(2);
            expect(map.childNodes[0].nodeType).toBe(8);
            expect(map.childNodes[0].nodeValue).toBe(' c ');

            // The two members the measured consumer reads are unchanged by it:
            // `children` is element-only and `textContent` excludes comments.
            expect(map.children.map((c) => c.tagName).join(',')).toBe('layer');
            expect(map.textContent).toBe('');
            // `innerHTML` is the one that moves, and it moves toward a real DOM.
            expect(map.innerHTML).toBe('<!-- c --><layer/>');
        });
    });
};
