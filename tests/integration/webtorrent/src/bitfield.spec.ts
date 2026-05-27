// SPDX-License-Identifier: MIT
// Ported from refs/webtorrent/test/bitfield.js
// Original: Copyright (c) WebTorrent, LLC and WebTorrent contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Upstream depends on test-order side effects on disk: test 1 seeds the
// leaves fixture, tests 2-4 read from the same disk path, test 4 destroys
// the store, tests 5-6 verify no-chunk behavior. All share the default
// fs-chunk-store path. Do NOT inject per-test paths here.

import { describe, it, expect } from '@gjsify/unit';
import WebTorrent from 'webtorrent';
import type { Instance as WebTorrentInstance, Torrent } from 'webtorrent';
import fixtures from './fixtures.js';

// @types/webtorrent does not model every runtime member exercised by these
// upstream tests. Rather than augment the third-party module, narrow at the
// use site to the concrete runtime shape the test relies on:
//   - the `'warning'` / `'verified'` events (Instance/Torrent only declare a
//     subset of their real event surface — fall back to the EventEmitter
//     overload that accepts arbitrary event names);
//   - the `bitfield` add option (real runtime accepts it, the typings don't);
//   - the internal `_hasStartupBitfield` flag set by the bitfield-preload path.
type EmitterLike = NodeJS.EventEmitter;
interface TorrentWithStartupBitfield {
    _hasStartupBitfield: boolean;
}

const disabledClientOpts = {
    dht: false,
    utp: false,
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

function destroyTorrentWithStore(torrent: Torrent): Promise<void> {
    return new Promise((resolve) => {
        torrent.destroy({ destroyStore: true }, () => resolve());
    });
}

function seedFiles(client: WebTorrentInstance, content: Buffer, opts: object): Promise<void> {
    return new Promise((resolve) => {
        client.seed(content, opts as WebTorrent.TorrentOptions, () => resolve());
    });
}

function waitForReady(torrent: Torrent): Promise<void> {
    return new Promise((resolve) => torrent.once('ready', resolve));
}

export default async () => {
    await describe('webtorrent/bitfield: preloaded bitfield', async () => {
        await it('load files into filesystem (seed)', async () => {
            const client = new WebTorrent(disabledClientOpts as WebTorrent.Options);
            let clientError: unknown = null;
            client.on('error', (err: Error) => {
                clientError = err;
            });
            (client as EmitterLike).on('warning', (err: Error) => {
                clientError = err;
            });

            await seedFiles(client, fixtures.leaves.content, {
                name: 'Leaves of Grass by Walt Whitman.epub',
                announce: [],
            });

            expect(clientError).toBeFalsy();
            await destroyClient(client);
        });

        await it('full bitfield, files exist', async () => {
            const client = new WebTorrent(disabledClientOpts as WebTorrent.Options);
            let clientError: unknown = null;
            client.on('error', (err: Error) => {
                clientError = err;
            });
            (client as EmitterLike).on('warning', (err: Error) => {
                clientError = err;
            });

            const torrent = client.add(fixtures.leaves.torrent, {
                bitfield: new Uint8Array([255, 255, 254]),
            } as unknown as WebTorrent.TorrentOptions);
            let verifiedIndex = -1;
            (torrent as EmitterLike).on('verified', (i: number) => {
                verifiedIndex = i;
            });

            await waitForReady(torrent);
            expect(verifiedIndex).toBe(1);
            expect((torrent as unknown as TorrentWithStartupBitfield)._hasStartupBitfield).toBeTruthy();
            expect(clientError).toBeFalsy();

            await destroyClient(client);
        });

        await it('partial bitfield, files exist, not done', async () => {
            const client = new WebTorrent(disabledClientOpts as WebTorrent.Options);
            let clientError: unknown = null;
            client.on('error', (err: Error) => {
                clientError = err;
            });
            (client as EmitterLike).on('warning', (err: Error) => {
                clientError = err;
            });

            const torrent = client.add(fixtures.leaves.torrent, {
                bitfield: new Uint8Array([0, 0, 255]),
            } as unknown as WebTorrent.TorrentOptions);
            let verifiedIndex = -1;
            (torrent as EmitterLike).on('verified', (i: number) => {
                verifiedIndex = i;
            });

            await waitForReady(torrent);
            expect(verifiedIndex).toBe(17);
            expect((torrent as unknown as TorrentWithStartupBitfield)._hasStartupBitfield).toBeTruthy();
            expect(torrent.done).toBeFalsy();
            expect(clientError).toBeFalsy();

            await destroyClient(client);
        });

        await it('wrong size bitfield, files exist → rescan all pieces', async () => {
            const client = new WebTorrent(disabledClientOpts as WebTorrent.Options);
            let clientError: unknown = null;
            client.on('error', (err: Error) => {
                clientError = err;
            });
            (client as EmitterLike).on('warning', (err: Error) => {
                clientError = err;
            });

            const torrent = client.add(fixtures.leaves.torrent, {
                bitfield: new Uint8Array([255, 255]),
            } as unknown as WebTorrent.TorrentOptions);
            let verifiedPieces = 0;
            (torrent as EmitterLike).on('verified', () => {
                verifiedPieces += 1;
            });

            await waitForReady(torrent);
            expect(verifiedPieces).toBe(torrent.pieces.length);
            expect((torrent as unknown as TorrentWithStartupBitfield)._hasStartupBitfield).toBeFalsy();
            expect(clientError).toBeFalsy();

            await destroyTorrentWithStore(torrent);
            await destroyClient(client);
        });

        await it('full bitfield, files don\u2019t exist → no verified pieces', async () => {
            const client = new WebTorrent(disabledClientOpts as WebTorrent.Options);
            let clientError: unknown = null;
            client.on('error', (err: Error) => {
                clientError = err;
            });
            (client as EmitterLike).on('warning', (err: Error) => {
                clientError = err;
            });

            const torrent = client.add(fixtures.leaves.torrent, {
                bitfield: new Uint8Array([255, 255, 254]),
            } as unknown as WebTorrent.TorrentOptions);
            let verifiedPieces = 0;
            (torrent as EmitterLike).on('verified', () => {
                verifiedPieces += 1;
            });

            await waitForReady(torrent);
            expect(verifiedPieces).toBe(0);
            expect((torrent as unknown as TorrentWithStartupBitfield)._hasStartupBitfield).toBeTruthy();
            expect(clientError).toBeFalsy();

            await destroyClient(client);
        });

        await it('wrong size bitfield, files don\u2019t exist → no verified pieces', async () => {
            const client = new WebTorrent(disabledClientOpts as WebTorrent.Options);
            let clientError: unknown = null;
            client.on('error', (err: Error) => {
                clientError = err;
            });
            (client as EmitterLike).on('warning', (err: Error) => {
                clientError = err;
            });

            const torrent = client.add(fixtures.leaves.torrent, {
                bitfield: new Uint8Array([255, 255]),
            } as unknown as WebTorrent.TorrentOptions);
            let verifiedPieces = 0;
            (torrent as EmitterLike).on('verified', () => {
                verifiedPieces += 1;
            });

            await waitForReady(torrent);
            expect(verifiedPieces).toBe(0);
            expect((torrent as unknown as TorrentWithStartupBitfield)._hasStartupBitfield).toBeFalsy();
            expect(clientError).toBeFalsy();

            await destroyClient(client);
        });
    });
};
