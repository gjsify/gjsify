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
import fixtures from './fixtures.js';

const disabledClientOpts = {
  dht: false,
  utp: false,
  tracker: false,
  lsd: false,
  natUpnp: false,
  natPmp: false,
} as const;

function destroyClient(client: any): Promise<void> {
  return new Promise((resolve, reject) => {
    client.destroy((err: Error | null | undefined) => (err ? reject(err) : resolve()));
  });
}

function destroyTorrentWithStore(torrent: any): Promise<void> {
  return new Promise((resolve) => {
    torrent.destroy({ destroyStore: true }, () => resolve());
  });
}

function seedFiles(client: any, content: Buffer, opts: object): Promise<void> {
  return new Promise((resolve) => {
    client.seed(content, opts, () => resolve());
  });
}

function waitForReady(torrent: any): Promise<void> {
  return new Promise((resolve) => torrent.once('ready', resolve));
}

export default async () => {
  await describe('webtorrent/bitfield: preloaded bitfield', async () => {
    await it('load files into filesystem (seed)', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      let clientError: unknown = null;
      client.on('error', (err: Error) => { clientError = err; });
      client.on('warning', (err: Error) => { clientError = err; });

      await seedFiles(client, fixtures.leaves.content, {
        name: 'Leaves of Grass by Walt Whitman.epub',
        announce: [],
      });

      expect(clientError).toBeFalsy();
      await destroyClient(client);
    });

    await it('full bitfield, files exist', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      let clientError: unknown = null;
      client.on('error', (err: Error) => { clientError = err; });
      client.on('warning', (err: Error) => { clientError = err; });

      const torrent = client.add(fixtures.leaves.torrent, { bitfield: new Uint8Array([255, 255, 254]) });
      let verifiedIndex = -1;
      torrent.on('verified', (i: number) => { verifiedIndex = i; });

      await waitForReady(torrent);
      expect(verifiedIndex).toBe(1);
      expect(torrent._hasStartupBitfield).toBeTruthy();
      expect(clientError).toBeFalsy();

      await destroyClient(client);
    });

    await it('partial bitfield, files exist, not done', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      let clientError: unknown = null;
      client.on('error', (err: Error) => { clientError = err; });
      client.on('warning', (err: Error) => { clientError = err; });

      const torrent = client.add(fixtures.leaves.torrent, { bitfield: new Uint8Array([0, 0, 255]) });
      let verifiedIndex = -1;
      torrent.on('verified', (i: number) => { verifiedIndex = i; });

      await waitForReady(torrent);
      expect(verifiedIndex).toBe(17);
      expect(torrent._hasStartupBitfield).toBeTruthy();
      expect(torrent.done).toBeFalsy();
      expect(clientError).toBeFalsy();

      await destroyClient(client);
    });

    await it('wrong size bitfield, files exist → rescan all pieces', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      let clientError: unknown = null;
      client.on('error', (err: Error) => { clientError = err; });
      client.on('warning', (err: Error) => { clientError = err; });

      const torrent = client.add(fixtures.leaves.torrent, { bitfield: new Uint8Array([255, 255]) });
      let verifiedPieces = 0;
      torrent.on('verified', () => { verifiedPieces += 1; });

      await waitForReady(torrent);
      expect(verifiedPieces).toBe(torrent.pieces.length);
      expect(torrent._hasStartupBitfield).toBeFalsy();
      expect(clientError).toBeFalsy();

      await destroyTorrentWithStore(torrent);
      await destroyClient(client);
    });

    await it('full bitfield, files don\u2019t exist → no verified pieces', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      let clientError: unknown = null;
      client.on('error', (err: Error) => { clientError = err; });
      client.on('warning', (err: Error) => { clientError = err; });

      const torrent = client.add(fixtures.leaves.torrent, { bitfield: new Uint8Array([255, 255, 254]) });
      let verifiedPieces = 0;
      torrent.on('verified', () => { verifiedPieces += 1; });

      await waitForReady(torrent);
      expect(verifiedPieces).toBe(0);
      expect(torrent._hasStartupBitfield).toBeTruthy();
      expect(clientError).toBeFalsy();

      await destroyClient(client);
    });

    await it('wrong size bitfield, files don\u2019t exist → no verified pieces', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      let clientError: unknown = null;
      client.on('error', (err: Error) => { clientError = err; });
      client.on('warning', (err: Error) => { clientError = err; });

      const torrent = client.add(fixtures.leaves.torrent, { bitfield: new Uint8Array([255, 255]) });
      let verifiedPieces = 0;
      torrent.on('verified', () => { verifiedPieces += 1; });

      await waitForReady(torrent);
      expect(verifiedPieces).toBe(0);
      expect(torrent._hasStartupBitfield).toBeFalsy();
      expect(clientError).toBeFalsy();

      await destroyClient(client);
    });
  });
};
