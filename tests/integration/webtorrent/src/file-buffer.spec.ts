// SPDX-License-Identifier: MIT
// Ported from refs/webtorrent/test/file-buffer.js
// Original: Copyright (c) WebTorrent, LLC and WebTorrent contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import WebTorrent from 'webtorrent';
import fixtures from './fixtures.js';
import { uniqueTempPath } from './test-helpers.js';

const disabledClientOpts = {
  dht: false,
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

function removeTorrent(client: any, torrent: any): Promise<void> {
  return new Promise((resolve, reject) => {
    client.remove(torrent, (err: Error | null | undefined) => (err ? reject(err) : resolve()));
  });
}

function seedFile(client: any, content: Buffer, opts: object): Promise<any> {
  return new Promise((resolve) => {
    client.seed(content, opts, (torrent: any) => resolve(torrent));
  });
}

export default async () => {
  await describe('webtorrent/file-buffer: chunk store iterator when done', async () => {
    await it('reads first 100 bytes via file.arrayBuffer after seed completes', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      let clientError: unknown = null;
      client.on('error', (err: Error) => { clientError = err; });
      client.on('warning', (err: Error) => { clientError = err; });

      const torrent = await seedFile(client, fixtures.leaves.content, {
        name: 'Leaves of Grass by Walt Whitman.epub',
        announce: [],
        path: uniqueTempPath(),
      });

      expect(client.torrents.length).toBe(1);
      expect(torrent.infoHash).toBe(fixtures.leaves.parsedTorrent.infoHash);
      expect(torrent.magnetURI).toBe(fixtures.leaves.magnetURI);

      const buffer: ArrayBuffer = await torrent.files[0].arrayBuffer({ start: 0, end: 99 });
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
