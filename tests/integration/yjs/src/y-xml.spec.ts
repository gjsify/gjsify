// SPDX-License-Identifier: MIT
// Ported from yjs 13.6.31 upstream tests
// Original: Copyright (c) 2014 Kevin Jahns and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Source: yjs/tests/y-xml.tests.js (testSetProperty, testHasProperty,
// testSiblings, testInsertafter). Single-doc + applyUpdate round-trips
// replace the upstream init(). XmlElement/XmlFragment back ProseMirror,
// TipTap, and BlockNote — every Yjs collaborative editor relies on this
// surface staying intact.

import { describe, expect, it } from '@gjsify/unit';
import * as Y from 'yjs';

export default async () => {
    await describe('Y.XmlElement / Y.XmlFragment — DOM-shaped CRDT tree', async () => {
        await it('setAttribute() + getAttribute() round-trip a string', async () => {
            const doc = new Y.Doc();
            const xml = doc.get('xml', Y.XmlElement) as Y.XmlElement;
            xml.setAttribute('height', '10');
            expect(xml.getAttribute('height')).toBe('10');
        });

        await it('hasAttribute() reflects setAttribute + removeAttribute', async () => {
            const doc = new Y.Doc();
            const xml = doc.get('xml', Y.XmlElement) as Y.XmlElement;
            xml.setAttribute('height', '10');
            expect(xml.hasAttribute('height')).toBe(true);
            xml.removeAttribute('height');
            expect(xml.hasAttribute('height')).toBe(false);
        });

        await it('insertAfter() places a sibling at the requested position', async () => {
            const doc = new Y.Doc();
            const xml = doc.get('xml', Y.XmlElement) as Y.XmlElement;
            const a = new Y.XmlElement('a');
            const b = new Y.XmlElement('b');
            const c = new Y.XmlElement('c');
            xml.insert(0, [a, b]);
            // Insert `c` after `a` → ['a', 'c', 'b'].
            xml.insertAfter(a, [c]);
            const childNames = xml.toArray().map((n) => {
                if (n instanceof Y.XmlElement) return n.nodeName;
                return '?';
            });
            expect(childNames).toStrictEqual(['a', 'c', 'b']);
        });

        await it('nextSibling / prevSibling walk the linked list of children', async () => {
            const doc = new Y.Doc();
            const xml = doc.get('xml', Y.XmlElement) as Y.XmlElement;
            const a = new Y.XmlElement('a');
            const b = new Y.XmlElement('b');
            const c = new Y.XmlElement('c');
            xml.insert(0, [a, b, c]);
            expect(a.nextSibling === b).toBe(true);
            expect(b.nextSibling === c).toBe(true);
            expect(c.nextSibling).toBe(null);
            expect(c.prevSibling === b).toBe(true);
            expect(a.prevSibling).toBe(null);
        });

        await it('toString() renders an XML-like serialization', async () => {
            const doc = new Y.Doc();
            const xml = doc.get('root', Y.XmlElement) as Y.XmlElement;
            xml.setAttribute('class', 'page');
            const para = new Y.XmlElement('p');
            const txt = new Y.XmlText();
            txt.insert(0, 'Hello');
            para.insert(0, [txt]);
            xml.insert(0, [para]);
            // Yjs's toString uses lowercased element names + sorted attributes.
            const s = xml.toString();
            expect(s).toContain('<p>');
            expect(s).toContain('Hello');
            expect(s).toContain('class="page"');
        });

        await it('XmlFragment iterates its children and round-trips via applyUpdate', async () => {
            const doc1 = new Y.Doc();
            const frag = doc1.getXmlFragment('frag');
            const e1 = new Y.XmlElement('p');
            const e2 = new Y.XmlElement('p');
            frag.push([e1, e2]);
            const doc2 = new Y.Doc();
            Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
            const restored = doc2.getXmlFragment('frag');
            expect(restored.length).toBe(2);
            const names = restored
                .toArray()
                .map((n) => (n instanceof Y.XmlElement ? n.nodeName : '?'));
            expect(names).toStrictEqual(['p', 'p']);
        });
    });
};
