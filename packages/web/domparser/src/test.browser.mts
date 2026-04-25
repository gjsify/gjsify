import { run, describe, it, expect } from '@gjsify/unit';

run({
    async DOMParserTest() {
        await describe('DOMParser', async () => {
            await it('parses simple XML', async () => {
                const doc = new DOMParser().parseFromString('<root><child/></root>', 'text/xml');
                expect(doc.documentElement.tagName).toBe('root');
                expect(doc.documentElement.children.length).toBe(1);
            });

            await it('parses XML attributes', async () => {
                const doc = new DOMParser().parseFromString('<item id="42" name="test"/>', 'text/xml');
                const item = doc.documentElement;
                expect(item.getAttribute('id')).toBe('42');
                expect(item.getAttribute('name')).toBe('test');
                expect(item.getAttribute('missing')).toBeNull();
            });

            await it('parses nested elements and text content', async () => {
                const xml = '<map><layer name="base"><data>1,2,3</data></layer></map>';
                const doc = new DOMParser().parseFromString(xml, 'text/xml');
                const layer = doc.querySelector('layer')!;
                expect(layer.getAttribute('name')).toBe('base');
                expect(layer.querySelector('data')!.textContent).toBe('1,2,3');
            });

            await it('parses HTML', async () => {
                const doc = new DOMParser().parseFromString('<p class="test">Hello</p>', 'text/html');
                const p = doc.querySelector('p')!;
                expect(p.className).toBe('test');
                expect(p.textContent).toBe('Hello');
            });

            await it('querySelector returns null for missing element', async () => {
                const doc = new DOMParser().parseFromString('<root/>', 'text/xml');
                expect(doc.querySelector('missing')).toBeNull();
            });

            await it('querySelectorAll returns all matching elements', async () => {
                const xml = '<root><item id="1"/><item id="2"/><item id="3"/></root>';
                const doc = new DOMParser().parseFromString(xml, 'text/xml');
                const items = doc.querySelectorAll('item');
                expect(items.length).toBe(3);
            });
        });
    },
});
