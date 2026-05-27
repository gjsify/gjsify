// SPDX-License-Identifier: MIT
// Ported from refs/webtorrent/test/file-buffer.js
// Original: Copyright (c) WebTorrent, LLC and WebTorrent contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import WebTorrent from 'webtorrent';
import type { Instance as WebTorrentInstance, Torrent } from 'webtorrent';
import fixtures from './fixtures.js';
import { uniqueTempPath } from './test-helpers.js';

// @types/webtorrent omits a few real runtime members exercised here:
//   - Instance emits 'warning' (typings only declare 'torrent'/'error');
//   - TorrentFile.arrayBuffer(range) returns a Promise<ArrayBuffer>.
// Narrow at the use site rather than augment the third-party module.
type EmitterLike = NodeJS.EventEmitter;
interface TorrentFileWithArrayBuffer {
    arrayBuffer(opts: { start: number; end: number }): Promise<ArrayBuffer>;
}

const disabledClientOpts = {
    dht: false,
    tracker: false,
    lsd: false,
    natUpnp: false,
    natPmp: false,
} as const;

function destroyClient(client: WebTorrentInstance): Promise<void> {
    return new Promise((resolve, reject) => {
        client.destroy((err) => (err ? reject(err) : resolve()));
    });
}

function removeTorrent(client: WebTorrentInstance, torrent: Torrent | string | Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        // @types/webtorrent only models remove(id, opts, cb); the runtime also
        // accepts remove(id, cb). Explicit `undefined` opts matches the typed
        // overload (webtorrent treats a function in the opts slot as the cb).
        client.remove(torrent, undefined, (err) => (err ? reject(err) : resolve()));
    });
}

function seedFile(client: WebTorrentInstance, content: Buffer, opts: object): Promise<Torrent> {
    return new Promise((resolve) => {
        client.seed(content, opts as WebTorrent.TorrentOptions, (torrent) => resolve(torrent));
    });
}

export default async () => {
    await describe('webtorrent/file-buffer: chunk store iterator when done', async () => {
        await it('reads first 100 bytes via file.arrayBuffer after seed completes', async () => {
            const client = new WebTorrent(disabledClientOpts as WebTorrent.Options);
            let clientError: unknown = null;
            client.on('error', (err: Error) => {
                clientError = err;
            });
            (client as EmitterLike).on('warning', (err: Error) => {
                clientError = err;
            });

            const torrent = await seedFile(client, fixtures.leaves.content, {
                name: 'Leaves of Grass by Walt Whitman.epub',
                announce: [],
                path: uniqueTempPath(),
            });

            expect(client.torrents.length).toBe(1);
            expect(torrent.infoHash).toBe(fixtures.leaves.parsedTorrent.infoHash);
            expect(torrent.magnetURI).toBe(fixtures.leaves.magnetURI);

            const buffer: ArrayBuffer = await (
                torrent.files[0] as unknown as TorrentFileWithArrayBuffer
            ).arrayBuffer({ start: 0, end: 99 });
            expect(buffer.byteLength).toBe(100);

            const orig = fixtures.leaves.content.buffer.slice(0, 100);
            expect([...new Uint8Array(orig)]).toStrictEqual([...new Uint8Array(buffer)]);

            await removeTorrent(client, torrent);
            expect(client.torrents.length).toBe(0);
            expect(clientError).toBeFalsy();

            await destroyClient(client);
        });
    });
};
