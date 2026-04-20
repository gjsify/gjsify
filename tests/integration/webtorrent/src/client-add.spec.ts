// SPDX-License-Identifier: MIT
// Ported from refs/webtorrent/test/client-add.js
// Original: Copyright (c) WebTorrent, LLC and WebTorrent contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import WebTorrent from 'webtorrent';
import fixtures from './fixtures.js';

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

function removeTorrent(client: any, torrentId: any): Promise<void> {
  return new Promise((resolve, reject) => {
    client.remove(torrentId, (err: Error | null | undefined) => (err ? reject(err) : resolve()));
  });
}

function waitForInfoHash(torrent: any): Promise<void> {
  return new Promise((resolve) => torrent.once('infoHash', resolve));
}

function waitForClientError(client: any): Promise<Error> {
  return new Promise((resolve) => client.once('error', resolve));
}

export default async () => {
  await describe('webtorrent/client-add: magnet URI (utf-8 string)', async () => {
    await it('parses magnet URI and yields expected infoHash', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      let emittedWarning: unknown = null;
      client.on('warning', (err: Error) => { emittedWarning = err; });

      const torrent: any = client.add(fixtures.leaves.magnetURI);
      expect(client.torrents.length).toBe(1);

      await waitForInfoHash(torrent);
      expect(torrent.infoHash).toBe(fixtures.leaves.parsedTorrent.infoHash);
      expect(torrent.magnetURI).toBe(fixtures.leaves.magnetURI);

      await removeTorrent(client, fixtures.leaves.magnetURI);
      expect(client.torrents.length).toBe(0);
      expect(emittedWarning).toBeFalsy();
      await destroyClient(client);
    });
  });

  await describe('webtorrent/client-add: torrent file buffer', async () => {
    await it('accepts a .torrent Buffer and yields expected infoHash', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      let emittedWarning: unknown = null;
      client.on('warning', (err: Error) => { emittedWarning = err; });

      const torrent: any = client.add(fixtures.leaves.torrent);
      expect(client.torrents.length).toBe(1);

      await waitForInfoHash(torrent);
      expect(torrent.infoHash).toBe(fixtures.leaves.parsedTorrent.infoHash);
      expect(torrent.magnetURI).toBe(fixtures.leaves.magnetURI);

      await removeTorrent(client, fixtures.leaves.torrent);
      expect(client.torrents.length).toBe(0);
      expect(emittedWarning).toBeFalsy();
      await destroyClient(client);
    });
  });

  await describe('webtorrent/client-add: info hash (hex string)', async () => {
    await it('accepts a hex infoHash and yields a magnetURI', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      const torrent: any = client.add(fixtures.leaves.parsedTorrent.infoHash);
      expect(client.torrents.length).toBe(1);

      await waitForInfoHash(torrent);
      expect(torrent.infoHash).toBe(fixtures.leaves.parsedTorrent.infoHash);
      expect(torrent.magnetURI).toBe(`magnet:?xt=urn:btih:${fixtures.leaves.parsedTorrent.infoHash}`);

      await removeTorrent(client, fixtures.leaves.parsedTorrent.infoHash);
      expect(client.torrents.length).toBe(0);
      await destroyClient(client);
    });
  });

  await describe('webtorrent/client-add: info hash (buffer)', async () => {
    await it('accepts a Buffer infoHash and yields a matching magnetURI prefix', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      const torrent: any = client.add(fixtures.leaves.parsedTorrent.infoHashBuffer);
      expect(client.torrents.length).toBe(1);

      await waitForInfoHash(torrent);
      expect(torrent.infoHash).toBe(fixtures.leaves.parsedTorrent.infoHash);
      expect(torrent.magnetURI.indexOf(`magnet:?xt=urn:btih:${fixtures.leaves.parsedTorrent.infoHash}`)).toBe(0);

      await removeTorrent(client, Buffer.from(fixtures.leaves.parsedTorrent.infoHash, 'hex'));
      expect(client.torrents.length).toBe(0);
      await destroyClient(client);
    });
  });

  await describe('webtorrent/client-add: parsed torrent', async () => {
    await it('accepts the output of parse-torrent directly', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      const torrent: any = client.add(fixtures.leaves.parsedTorrent);
      expect(client.torrents.length).toBe(1);

      await waitForInfoHash(torrent);
      expect(torrent.infoHash).toBe(fixtures.leaves.parsedTorrent.infoHash);
      expect(torrent.magnetURI).toBe(fixtures.leaves.magnetURI);

      await removeTorrent(client, fixtures.leaves.parsedTorrent);
      expect(client.torrents.length).toBe(0);
      await destroyClient(client);
    });
  });

  await describe('webtorrent/client-add: parsed torrent with string announce', async () => {
    await it('normalizes a string announce into an array and merges into magnetURI', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      const parsedTorrent = Object.assign({}, fixtures.leaves.parsedTorrent, {
        announce: 'http://tracker.local:80',
      });
      const torrent: any = client.add(parsedTorrent);
      expect(client.torrents.length).toBe(1);

      await waitForInfoHash(torrent);
      expect(torrent.infoHash).toBe(fixtures.leaves.parsedTorrent.infoHash);
      const expectedMagnetURI = `${fixtures.leaves.magnetURI}&tr=${encodeURIComponent('http://tracker.local:80')}`;
      expect(torrent.magnetURI).toBe(expectedMagnetURI);
      expect(torrent.announce).toStrictEqual(['http://tracker.local:80']);

      await removeTorrent(client, fixtures.leaves.parsedTorrent);
      expect(client.torrents.length).toBe(0);
      await destroyClient(client);
    });
  });

  await describe('webtorrent/client-add: parsed torrent with array announce', async () => {
    await it('keeps an array announce as-is and merges into magnetURI', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      const parsedTorrent = Object.assign({}, fixtures.leaves.parsedTorrent, {
        announce: ['http://tracker.local:80', 'http://tracker.local:81'],
      });
      const torrent: any = client.add(parsedTorrent);
      expect(client.torrents.length).toBe(1);

      await waitForInfoHash(torrent);
      expect(torrent.infoHash).toBe(fixtures.leaves.parsedTorrent.infoHash);
      const expectedMagnetURI = `${fixtures.leaves.magnetURI}&tr=${encodeURIComponent('http://tracker.local:80')}&tr=${encodeURIComponent('http://tracker.local:81')}`;
      expect(torrent.magnetURI).toBe(expectedMagnetURI);
      expect(torrent.announce).toStrictEqual(['http://tracker.local:80', 'http://tracker.local:81']);

      await removeTorrent(client, fixtures.leaves.parsedTorrent);
      expect(client.torrents.length).toBe(0);
      await destroyClient(client);
    });
  });

  await describe('webtorrent/client-add: invalid torrent id (empty string)', async () => {
    await it('emits an "error" with "Invalid torrent identifier"', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      const errorPromise = waitForClientError(client);
      client.add('');
      const err = await errorPromise;
      expect(err instanceof Error).toBeTruthy();
      expect(err.message.includes('Invalid torrent identifier')).toBeTruthy();
      await destroyClient(client);
    });
  });

  await describe('webtorrent/client-add: invalid torrent id (short buffer)', async () => {
    await it('emits an "error" with "Invalid torrent identifier" for a too-short Buffer', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      const errorPromise = waitForClientError(client);
      client.add(Buffer.from('abc'));
      const err = await errorPromise;
      expect(err instanceof Error).toBeTruthy();
      expect(err.message.includes('Invalid torrent identifier')).toBeTruthy();
      await destroyClient(client);
    });
  });

  await describe('webtorrent/client-add: paused torrent', async () => {
    await it('respects the paused flag', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      const torrent: any = client.add(fixtures.leaves.magnetURI, { paused: true });
      expect(client.torrents.length).toBe(1);

      await waitForInfoHash(torrent);
      expect(torrent.paused).toBe(true);

      await removeTorrent(client, fixtures.leaves.magnetURI);
      expect(client.torrents.length).toBe(0);
      await destroyClient(client);
    });
  });
};
