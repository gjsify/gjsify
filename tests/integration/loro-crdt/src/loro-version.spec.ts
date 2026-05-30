// SPDX-License-Identifier: MIT
// Ported from refs/loro/crates/loro-wasm/tests/version.test.ts.
// Original: Copyright (c) 2023 Loro authors. MIT.
// Rewritten for @gjsify/unit — behaviour preserved, assertion dialect adapted.

import { describe, expect, it } from '@gjsify/unit';
import { LoroDoc, LoroMap, VersionVector, decodeImportBlobMeta } from 'loro-crdt/base64/index.js';

export default async () => {
    await describe('Frontiers — concurrent-aware version comparison', async () => {
        await it('two clients can compare frontiers correctly', async () => {
            const doc = new LoroDoc();
            doc.setPeerId(0n);
            const text = doc.getText('text');
            text.insert(0, '0');
            doc.commit();

            const v0 = doc.frontiers();
            const docB = new LoroDoc();
            docB.setPeerId(1n);
            docB.import(doc.export({ mode: 'update' }));
            // docB has applied doc's state, so it's equal to v0
            expect(docB.cmpWithFrontiers(v0)).toBe(0);

            text.insert(1, '0');
            doc.commit();
            // docB has not seen the new edit yet → docB < doc
            expect(docB.cmpWithFrontiers(doc.frontiers())).toBe(-1);

            const textB = docB.getText('text');
            textB.insert(0, '0');
            docB.commit();
            // Concurrent edits — docB still ordered as -1 vs doc
            expect(docB.cmpWithFrontiers(doc.frontiers())).toBe(-1);

            docB.import(doc.export({ mode: 'update' }));
            // After importing doc, docB has everything doc has + its own edit → docB > doc
            expect(docB.cmpWithFrontiers(doc.frontiers())).toBe(1);

            doc.import(docB.export({ mode: 'update' }));
            // After cross-import, both equal
            expect(docB.cmpWithFrontiers(doc.frontiers())).toBe(0);
        });

        await it('cmpFrontiers compares two arbitrary frontier vectors', async () => {
            const doc1 = new LoroDoc();
            doc1.setPeerId(1n);
            const doc2 = new LoroDoc();
            doc2.setPeerId(2n);

            doc1.getText('text').insert(0, '01234');
            doc2.import(doc1.export({ mode: 'update' }));
            doc2.getText('text').insert(0, '56789');
            doc1.import(doc2.export({ mode: 'update' }));
            doc1.getText('text').insert(0, '01234');
            doc1.commit();

            // empty vs non-empty → -1
            expect(doc1.cmpFrontiers([], [{ peer: '1', counter: 1 }])).toBe(-1);
            // empty vs empty → 0
            expect(doc1.cmpFrontiers([], [])).toBe(0);
            // ascending vs descending → -1 / 1 depending on peer ordering
            expect(
                doc1.cmpFrontiers(
                    [{ peer: '1', counter: 4 }],
                    [{ peer: '2', counter: 3 }],
                ),
            ).toBe(-1);
            expect(
                doc1.cmpFrontiers(
                    [{ peer: '1', counter: 5 }],
                    [{ peer: '2', counter: 3 }],
                ),
            ).toBe(1);
        });
    });

    await describe('peer-id representation', async () => {
        await it('is consistent across frontiers + version + container IDs', async () => {
            const doc = new LoroDoc();
            const id = doc.peerIdStr;
            doc.getText('text').insert(0, 'hello');
            doc.commit();
            const f = doc.frontiers();
            expect(f[0].peer).toBe(id);

            const child = new LoroMap();
            const map = doc.getList('list').insertContainer(0, child);
            const mapId = map.id;
            // Container IDs look like `cid:N@<peer>:Type` — extract the peer portion
            const peerIdInContainerId = mapId.split(':')[1].split('@')[1];
            expect(peerIdInContainerId).toBe(id);
            doc.commit();

            // text(5) + list(0=container init) + map(0=container init) = 6 ops on this peer
            expect(doc.version().get(id)).toBe(6);
            expect(doc.version().toJSON().get(id)).toBe(6);

            // Re-fetching the map by id should reach the same container
            const m = doc.getMap(mapId);
            m.set('0', 1);
            expect(map.get('0')).toBe(1);
        });
    });

    await describe('VersionVector ↔ Frontiers', async () => {
        // Set up a doc with cross-peer changes
        const a = new LoroDoc();
        a.setPeerId(0n);
        const b = new LoroDoc();
        b.setPeerId(1n);
        a.getText('text').insert(0, 'ha');
        b.getText('text').insert(0, 'yo');
        a.import(b.export({ mode: 'update' }));
        a.getText('text').insert(0, 'k');
        a.commit();

        await it('version vector matches the synced state', async () => {
            const vv = new Map();
            vv.set('0', 3);
            vv.set('1', 2);
            expect(a.version().toJSON()).toStrictEqual(vv);
        });

        await it('vvToFrontiers roundtrips through VersionVector', async () => {
            const vv = new Map();
            vv.set('0', 3);
            vv.set('1', 2);
            expect(a.vvToFrontiers(new VersionVector(vv))).toStrictEqual(a.frontiers());
            const v = a.version();
            const temp = a.vvToFrontiers(v);
            expect(temp).toStrictEqual(a.frontiers());
        });

        await it('current frontiers point at the latest op on peer 0', async () => {
            expect(a.frontiers()).toStrictEqual([{ peer: '0', counter: 2 }]);
        });

        await it('getAllChanges returns per-peer change list', async () => {
            const changes = a.getAllChanges();
            expect(typeof changes.get('0')?.[0].peer === 'string').toBeTruthy();
            expect(changes.size).toBe(2);
            expect(changes.get('0')?.length).toBe(2);
            expect(changes.get('1')?.length).toBe(1);
        });

        await it('getOpsInChange returns the ops of a specific change', async () => {
            const change = a.getOpsInChange({ peer: '0', counter: 2 });
            expect(change.length).toBe(1);
        });
    });

    await describe('decodeImportBlobMeta — inspect blob without applying', async () => {
        await it('reads metadata from an update-mode blob (single edit)', async () => {
            const doc = new LoroDoc();
            doc.setPeerId(0n);
            doc.getText('text').insert(0, '0');
            doc.commit();
            const bytes = doc.export({ mode: 'update' });
            const meta = decodeImportBlobMeta(bytes, false);
            expect(meta.changeNum).toBe(1);
            expect(meta.partialEndVersionVector.get('0')).toBe(1);
            expect(meta.mode).toBe('update');
            expect(meta.startFrontiers.length).toBe(0);
        });

        await it('reads metadata from a snapshot-mode blob (multi-peer)', async () => {
            const doc = new LoroDoc();
            doc.setPeerId(0n);
            doc.getText('text').insert(0, '01234');
            doc.commit();
            const bytes = doc.export({ mode: 'snapshot' });
            const meta = decodeImportBlobMeta(bytes, false);
            expect(meta.mode).toBe('snapshot');
            expect(meta.partialEndVersionVector.get('0')).toBe(5);
        });

        await it('reads multi-peer update blob metadata', async () => {
            const doc0 = new LoroDoc();
            doc0.setPeerId(0n);
            doc0.getText('text').insert(0, '0');
            doc0.commit();

            const doc1 = new LoroDoc();
            doc1.setPeerId(1n);
            doc1.getText('text').insert(0, '123');
            doc1.import(doc0.export({ mode: 'update' }));

            const bytes = doc1.export({ mode: 'update' });
            const meta = decodeImportBlobMeta(bytes, false);
            expect(meta.changeNum).toBe(2);
            expect(meta.partialEndVersionVector.get('0')).toBe(1);
            expect(meta.partialEndVersionVector.get('1')).toBe(3);
            expect(meta.mode).toBe('update');
        });

        await it('reads partial-from blob metadata (incremental export)', async () => {
            const doc0 = new LoroDoc();
            doc0.setPeerId(0n);
            doc0.getText('text').insert(0, '0');
            doc0.commit();

            const doc1 = new LoroDoc();
            doc1.setPeerId(1n);
            doc1.getText('text').insert(0, '123');
            doc1.import(doc0.export({ mode: 'update' }));

            const bytes = doc1.export({ mode: 'update', from: doc0.oplogVersion() });
            const meta = decodeImportBlobMeta(bytes, false);
            expect(meta.changeNum).toBe(1);
            expect(meta.partialEndVersionVector.get('1')).toBe(3);
            expect(meta.mode).toBe('update');
            expect(meta.startFrontiers).toStrictEqual([]);
        });
    });
};
