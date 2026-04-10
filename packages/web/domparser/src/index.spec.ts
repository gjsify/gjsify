// Ported from refs/wpt/domparsing and refs/happy-dom/packages/happy-dom/test/xml-parser/
// Original: web-platform-tests contributors (3-Clause BSD) and David Ortner (MIT).
// Tests target the minimal DOM API surface consumed by @excaliburjs/plugin-tiled:
//   DOMParser.parseFromString, Document.documentElement, Element.querySelector,
//   Element.children, Element.getAttribute, Element.tagName.

import { describe, it, expect } from '@gjsify/unit';
import { DOMParser } from '@gjsify/domparser';

export default async () => {
    await describe('DOMParser', async () => {

        await describe('parseFromString — basic XML', async () => {
            await it('parses a simple element with no children', async () => {
                const doc = new DOMParser().parseFromString('<root/>', 'application/xml');
                expect(doc.documentElement).not.toBeNull();
                expect(doc.documentElement!.tagName).toBe('root');
                expect(doc.documentElement!.children.length).toBe(0);
            });

            await it('parses nested elements and preserves order', async () => {
                const xml = '<map><layer/><tileset/><object/></map>';
                const doc = new DOMParser().parseFromString(xml, 'application/xml');
                const map = doc.documentElement!;
                expect(map.tagName).toBe('map');
                expect(map.children.length).toBe(3);
                expect(map.children[0].tagName).toBe('layer');
                expect(map.children[1].tagName).toBe('tileset');
                expect(map.children[2].tagName).toBe('object');
            });

            await it('skips XML processing instruction at the start', async () => {
                const xml = '<?xml version="1.0" encoding="UTF-8"?><root><child/></root>';
                const doc = new DOMParser().parseFromString(xml, 'application/xml');
                expect(doc.documentElement!.tagName).toBe('root');
                expect(doc.documentElement!.children.length).toBe(1);
            });

            await it('handles deeply nested elements', async () => {
                const xml = '<a><b><c><d><e/></d></c></b></a>';
                const doc = new DOMParser().parseFromString(xml, 'application/xml');
                const a = doc.documentElement!;
                expect(a.tagName).toBe('a');
                expect(a.children[0].tagName).toBe('b');
                expect(a.children[0].children[0].tagName).toBe('c');
                expect(a.children[0].children[0].children[0].tagName).toBe('d');
                expect(a.children[0].children[0].children[0].children[0].tagName).toBe('e');
            });
        });

        await describe('parseFromString — attributes', async () => {
            await it('reads double-quoted string attributes', async () => {
                const doc = new DOMParser().parseFromString('<tile id="42" name="stone"/>', 'application/xml');
                const tile = doc.documentElement!;
                expect(tile.getAttribute('id')).toBe('42');
                expect(tile.getAttribute('name')).toBe('stone');
            });

            await it('reads single-quoted string attributes', async () => {
                const doc = new DOMParser().parseFromString("<tile id='7' name='grass'/>", 'application/xml');
                expect(doc.documentElement!.getAttribute('id')).toBe('7');
                expect(doc.documentElement!.getAttribute('name')).toBe('grass');
            });

            await it('returns null for missing attributes', async () => {
                const doc = new DOMParser().parseFromString('<tile/>', 'application/xml');
                expect(doc.documentElement!.getAttribute('id')).toBeNull();
            });

            await it('preserves TMX-style numeric attributes as strings', async () => {
                const xml = '<map version="1.10" width="260" height="30" tilewidth="16" tileheight="16" infinite="0"/>';
                const doc = new DOMParser().parseFromString(xml, 'application/xml');
                const map = doc.documentElement!;
                expect(map.getAttribute('version')).toBe('1.10');
                expect(map.getAttribute('width')).toBe('260');
                expect(map.getAttribute('height')).toBe('30');
                expect(map.getAttribute('infinite')).toBe('0');
            });

            await it('handles attributes containing the > character', async () => {
                // Real-world TMX does not include literal > in attributes, but
                // the parser must not prematurely end the tag on one if it ever
                // appears inside quoted values.
                const doc = new DOMParser().parseFromString('<e a="x>y" b="z"/>', 'application/xml');
                expect(doc.documentElement!.getAttribute('a')).toBe('x>y');
                expect(doc.documentElement!.getAttribute('b')).toBe('z');
            });
        });

        await describe('parseFromString — self-closing tags', async () => {
            await it('handles self-closing tag with attributes', async () => {
                const doc = new DOMParser().parseFromString('<image source="foo.png" width="16" height="16"/>', 'application/xml');
                const img = doc.documentElement!;
                expect(img.tagName).toBe('image');
                expect(img.children.length).toBe(0);
                expect(img.getAttribute('source')).toBe('foo.png');
            });

            await it('handles self-closing tag inside a parent', async () => {
                const doc = new DOMParser().parseFromString('<parent><child1/><child2/></parent>', 'application/xml');
                const parent = doc.documentElement!;
                expect(parent.children.length).toBe(2);
                expect(parent.children[0].tagName).toBe('child1');
                expect(parent.children[1].tagName).toBe('child2');
            });
        });

        await describe('parseFromString — comments and CDATA', async () => {
            await it('skips XML comments', async () => {
                const xml = '<root><!-- this is a comment --><child/></root>';
                const doc = new DOMParser().parseFromString(xml, 'application/xml');
                const root = doc.documentElement!;
                expect(root.children.length).toBe(1);
                expect(root.children[0].tagName).toBe('child');
            });

            await it('preserves CDATA content as text', async () => {
                const xml = '<data><![CDATA[raw <content> & stuff]]></data>';
                const doc = new DOMParser().parseFromString(xml, 'application/xml');
                expect(doc.documentElement!.textContent).toBe('raw <content> & stuff');
            });

            await it('handles CDATA with embedded ]]', async () => {
                // CDATA terminates at the FIRST ]]>, so we just verify the
                // happy path here (single ]]).
                const xml = '<data><![CDATA[ok]]></data>';
                const doc = new DOMParser().parseFromString(xml, 'application/xml');
                expect(doc.documentElement!.textContent).toBe('ok');
            });
        });

        await describe('Element.querySelector', async () => {
            const xml = `<map>
                <tileset firstgid="1" name="ts1"/>
                <tileset firstgid="100" name="ts2"/>
                <layer><data/></layer>
                <objectgroup><object id="1"/><object id="2"/></objectgroup>
            </map>`;

            await it('finds the first matching descendant by tag name', async () => {
                const doc = new DOMParser().parseFromString(xml, 'application/xml');
                const ts = doc.querySelector('tileset');
                expect(ts).not.toBeNull();
                expect(ts!.getAttribute('name')).toBe('ts1');
            });

            await it('returns null when no element matches', async () => {
                const doc = new DOMParser().parseFromString(xml, 'application/xml');
                expect(doc.querySelector('imagelayer')).toBeNull();
            });

            await it('finds nested elements (data inside layer)', async () => {
                const doc = new DOMParser().parseFromString(xml, 'application/xml');
                const data = doc.querySelector('data');
                expect(data).not.toBeNull();
                expect(data!.tagName).toBe('data');
            });

            await it('querySelectorAll returns all matches', async () => {
                const doc = new DOMParser().parseFromString(xml, 'application/xml');
                const tilesets = doc.querySelectorAll('tileset');
                expect(tilesets.length).toBe(2);
                expect(tilesets[0].getAttribute('name')).toBe('ts1');
                expect(tilesets[1].getAttribute('name')).toBe('ts2');
            });

            await it('querySelectorAll finds nested matches', async () => {
                const doc = new DOMParser().parseFromString(xml, 'application/xml');
                const objects = doc.querySelectorAll('object');
                expect(objects.length).toBe(2);
                expect(objects[0].getAttribute('id')).toBe('1');
                expect(objects[1].getAttribute('id')).toBe('2');
            });
        });

        await describe('TMX real-world subset', async () => {
            // Minimal subset of an actual Tiled .tmx map — validates that the
            // parser handles the concrete structure used by excalibur-tiled.
            const tmx = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" tiledversion="1.10.2" orientation="orthogonal" width="260" height="30" tilewidth="16" tileheight="16" infinite="0">
 <properties>
  <property name="excalibur" type="bool" value="true"/>
 </properties>
 <tileset firstgid="1" name="tileset" tilewidth="16" tileheight="16" tilecount="512" columns="32">
  <image source="../images/tileset.png" width="512" height="256"/>
  <tile id="17">
   <properties>
    <property name="ladder" type="bool" value="true"/>
   </properties>
  </tile>
 </tileset>
</map>`;

            await it('parses the map element and its attributes', async () => {
                const doc = new DOMParser().parseFromString(tmx, 'application/xml');
                const map = doc.documentElement!;
                expect(map.tagName).toBe('map');
                expect(map.getAttribute('version')).toBe('1.10');
                expect(map.getAttribute('width')).toBe('260');
                expect(map.getAttribute('orientation')).toBe('orthogonal');
            });

            await it('finds the properties child of the map', async () => {
                const doc = new DOMParser().parseFromString(tmx, 'application/xml');
                const props = doc.querySelector('properties');
                expect(props).not.toBeNull();
                expect(props!.children[0].tagName).toBe('property');
                expect(props!.children[0].getAttribute('name')).toBe('excalibur');
            });

            await it('iterates tileset children and finds the image source', async () => {
                const doc = new DOMParser().parseFromString(tmx, 'application/xml');
                const tileset = doc.querySelector('tileset');
                expect(tileset).not.toBeNull();
                // Replicates excalibur-tiled's `for (let child of tilesetNode.children)` loop
                let imageSource: string | null = null;
                for (const child of tileset!.children) {
                    if (child.tagName === 'image') {
                        imageSource = child.getAttribute('source');
                    }
                }
                expect(imageSource).toBe('../images/tileset.png');
            });

            await it('finds nested tile properties', async () => {
                const doc = new DOMParser().parseFromString(tmx, 'application/xml');
                const tile = doc.querySelector('tile');
                expect(tile).not.toBeNull();
                expect(tile!.getAttribute('id')).toBe('17');
                const tileProps = tile!.querySelector('properties');
                expect(tileProps).not.toBeNull();
                expect(tileProps!.children[0].getAttribute('name')).toBe('ladder');
            });
        });
    });
};
