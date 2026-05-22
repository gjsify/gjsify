// SPDX-License-Identifier: MIT
// Inspired by refs/loro LoroTree API tests.
// Original: Copyright (c) 2023 Loro authors. MIT.
// Rewritten for @gjsify/unit — behaviour preserved, assertion dialect adapted.

import { describe, expect, it } from '@gjsify/unit';
import { LoroDoc } from 'loro-crdt/base64/index.js';

export default async () => {
    await describe('LoroTree — hierarchical CRDT tree', async () => {
        await it('creates a root node', async () => {
            const doc = new LoroDoc();
            const tree = doc.getTree('outline');
            const root = tree.createNode();
            expect(typeof root.id).toBe('string');
            // Roots have undefined parent.
            expect(root.parent()).toBe(undefined);
        });

        await it('creates child nodes and walks the parent chain', async () => {
            const doc = new LoroDoc();
            const tree = doc.getTree('outline');
            const root = tree.createNode();
            const child = root.createNode();
            const grandchild = child.createNode();
            expect(child.parent()?.id).toBe(root.id);
            expect(grandchild.parent()?.id).toBe(child.id);
        });

        await it('children() returns ordered child nodes', async () => {
            const doc = new LoroDoc();
            const tree = doc.getTree('outline');
            const root = tree.createNode();
            const a = root.createNode();
            const b = root.createNode();
            const c = root.createNode();
            const ids = root.children()?.map((n) => n.id);
            expect(ids).toStrictEqual([a.id, b.id, c.id]);
        });

        await it('move() reparents a node', async () => {
            const doc = new LoroDoc();
            const tree = doc.getTree('outline');
            const rootA = tree.createNode();
            const rootB = tree.createNode();
            const child = rootA.createNode();
            expect(child.parent()?.id).toBe(rootA.id);
            child.move(rootB);
            expect(child.parent()?.id).toBe(rootB.id);
        });

        await it('nodes carry a LoroMap of data', async () => {
            const doc = new LoroDoc();
            const tree = doc.getTree('outline');
            const node = tree.createNode();
            const data = node.data;
            data.set('title', 'Chapter 1');
            data.set('order', 1);
            expect(data.get('title')).toBe('Chapter 1');
            expect(data.get('order')).toBe(1);
        });
    });
};
