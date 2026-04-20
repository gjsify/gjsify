// SPDX-License-Identifier: MIT
// Ported from refs/webtorrent/test/iterator.js
// Original: Copyright (c) WebTorrent, LLC and WebTorrent contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import WebTorrent from 'webtorrent';
import fixtures from './fixtures.js';
import { uniqueTempPath } from './test-helpers.js';
import FileIterator from 'webtorrent/lib/file-iterator.js';

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

function waitForReady(torrent: any): Promise<void> {
  return new Promise((resolve) => torrent.once('ready', resolve));
}

export default async () => {
  await describe('webtorrent/iterator: async iterator when file done', async () => {
    await it('uses the chunk store iterator after seed completes', async () => {
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

      const iterator = torrent.files[0][Symbol.asyncIterator]();
      expect(torrent.files[0].done).toBeTruthy();
      expect(iterator instanceof (FileIterator as any)).toBe(false);
      iterator.return?.();

      await removeTorrent(client, torrent);
      expect(client.torrents.length).toBe(0);
      expect(clientError).toBeFalsy();

      await destroyClient(client);
    });
  });

  await describe('webtorrent/iterator: async iterator when file not done', async () => {
    await it('uses FileIterator when torrent has not completed', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      let clientError: unknown = null;
      client.on('error', (err: Error) => { clientError = err; });
      client.on('warning', (err: Error) => { clientError = err; });

      const torrent: any = client.add(fixtures.leaves.torrent, { path: uniqueTempPath() });
      expect(client.torrents.length).toBe(1);

      await waitForReady(torrent);
      expect(torrent.infoHash).toBe(fixtures.leaves.parsedTorrent.infoHash);
      expect(torrent.magnetURI).toBe(fixtures.leaves.magnetURI);

      expect(torrent.files[0].done).toBeFalsy();
      const iterator = torrent.files[0][Symbol.asyncIterator]();
      expect(iterator instanceof (FileIterator as any)).toBe(true);
      iterator.return?.();

      await removeTorrent(client, fixtures.leaves.torrent);
      expect(client.torrents.length).toBe(0);
      expect(clientError).toBeFalsy();

      await destroyClient(client);
    });
  });
};
