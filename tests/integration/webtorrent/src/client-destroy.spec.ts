// SPDX-License-Identifier: MIT
// Ported from refs/webtorrent/test/client-destroy.js
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

export default async () => {
  await describe('webtorrent/client-destroy: add/seed reject after destroy', async () => {
    await it('client.add and client.seed throw after destroy', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      let emittedError: unknown = null;
      client.on('error', (err: Error) => { emittedError = err; });
      client.on('warning', (err: Error) => { emittedError = err; });

      await destroyClient(client);
      expect(emittedError).toBeFalsy();

      expect(() => {
        client.add(`magnet:?xt=urn:btih:${fixtures.leaves.parsedTorrent.infoHash}`);
      }).toThrow();

      expect(() => {
        client.seed(Buffer.from('sup'));
      }).toThrow();
    });
  });

  await describe('webtorrent/client-destroy: no torrent/ready events after destroy', async () => {
    await it('destroy is called without emitting torrent or ready', async () => {
      const client = new (WebTorrent as any)(disabledClientOpts);
      let errorEmitted: unknown = null;
      let unexpectedEvent = false;

      client.on('error', (err: Error) => { errorEmitted = err; });
      client.on('warning', (err: Error) => { errorEmitted = err; });
      client.on('ready', () => { unexpectedEvent = true; });

      client.add(fixtures.leaves.torrent, { name: 'leaves' }, () => {
        unexpectedEvent = true;
      });
      client.seed(fixtures.leaves.content, { name: 'leaves' }, () => {
        unexpectedEvent = true;
      });

      await destroyClient(client);

      expect(errorEmitted).toBeFalsy();
      expect(unexpectedEvent).toBe(false);
    });
  });
};
