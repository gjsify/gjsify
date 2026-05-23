// SPDX-License-Identifier: MIT
// Inspired by refs/loro/crates/loro-wasm/tests (the wasm-bindgen JS-API
// surface tests). Re-derived from Loro's documented LoroText API.
// Original: Copyright (c) 2023 Loro authors. MIT.
// Rewritten for @gjsify/unit — behaviour preserved, assertion dialect adapted.

import { describe, expect, it } from '@gjsify/unit';
import { LoroDoc } from 'loro-crdt/base64/index.js';

export default async () => {
    await describe('LoroText — basic CRDT text container', async () => {
        await it('inserts characters at index 0 (empty doc)', async () => {
            const doc = new LoroDoc();
            const text = doc.getText('greeting');
            text.insert(0, 'Hello');
            expect(text.toString()).toBe('Hello');
            expect(text.length).toBe(5);
        });

        await it('inserts characters in the middle of existing text', async () => {
            const doc = new LoroDoc();
            const text = doc.getText('t');
            text.insert(0, 'HelWorld');
            text.insert(3, 'lo, ');
            expect(text.toString()).toBe('Hello, World');
        });

        await it('appends via insert at the end', async () => {
            const doc = new LoroDoc();
            const text = doc.getText('t');
            text.insert(0, 'Hello');
            text.insert(5, ', World');
            expect(text.toString()).toBe('Hello, World');
        });

        await it('deletes a range', async () => {
            const doc = new LoroDoc();
            const text = doc.getText('t');
            text.insert(0, 'Hello, World');
            // Delete the comma + space + "World" → "Hello"
            text.delete(5, 7);
            expect(text.toString()).toBe('Hello');
        });

        await it('supports unicode (multi-byte) characters', async () => {
            const doc = new LoroDoc();
            const text = doc.getText('t');
            text.insert(0, 'Café ☕');
            // Loro counts in UTF-16 code units (matching JS string semantics
            // and the wasm-bindgen contract). "Café ☕" = 6 code units.
            expect(text.length).toBe(6);
            expect(text.toString()).toBe('Café ☕');
        });

        await it('round-trips through commit() without changing visible content', async () => {
            const doc = new LoroDoc();
            const text = doc.getText('t');
            text.insert(0, 'Pre-commit');
            doc.commit();
            expect(text.toString()).toBe('Pre-commit');
            text.insert(text.length, ' / Post-commit');
            doc.commit();
            expect(text.toString()).toBe('Pre-commit / Post-commit');
        });

        await it('exposes the peer-id as a stable identifier per doc', async () => {
            const doc = new LoroDoc();
            const peer1 = doc.peerIdStr;
            const peer2 = doc.peerIdStr;
            expect(typeof peer1).toBe('string');
            expect(peer1).toBe(peer2);
            // Two independent docs get distinct peer-ids (random by default).
            const otherDoc = new LoroDoc();
            expect(otherDoc.peerIdStr).not.toBe(peer1);
        });

        await it('peer-id can be set explicitly to a fixed value', async () => {
            const doc = new LoroDoc();
            doc.setPeerId('1234567890');
            expect(doc.peerIdStr).toBe('1234567890');
            const text = doc.getText('t');
            text.insert(0, 'Anchored');
            expect(text.toString()).toBe('Anchored');
        });
    });
};
