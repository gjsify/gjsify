// SPDX-License-Identifier: MIT
// Ported from refs/webtorrent/test/rarity-map.js
// Original: Copyright (c) WebTorrent, LLC and WebTorrent contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import fixtures from './fixtures.js';
import randombytes from 'randombytes';
import Wire from 'bittorrent-protocol';
import Torrent from 'webtorrent/lib/torrent.js';

const stubClient = {
  listening: true,
  peerId: randombytes(20).toString('hex'),
  torrentPort: 6889,
  dht: false,
  tracker: false,
  lsd: false,
  _remove() {
    /* no-op */
  },
};

function waitForMetadata(torrent: any): Promise<void> {
  return new Promise((resolve) => torrent.once('metadata', resolve));
}

export default async () => {
  await describe('webtorrent/rarity-map usage', async () => {
    const numPieces = 4;
    const torrentId = Object.assign({}, fixtures.numbers.parsedTorrent, {
      pieces: Array(numPieces),
    });
    const torrent: any = new (Torrent as any)(torrentId, stubClient, {});

    await waitForMetadata(torrent);
    torrent._onWire(new (Wire as any)());
    torrent._onWire(new (Wire as any)());

    const rarityMap = torrent._rarityMap;

    const validateInitial = () => {
      for (let i = 0; i < 4; i++) {
        const piece = rarityMap.getRarestPiece();
        expect(piece >= 0 && piece < numPieces).toBeTruthy();
      }
    };

    const setPiece = (wire: any, index: number) => {
      wire.peerPieces.set(index);
      wire.emit('have', index);
    };

    const addWire = () => {
      const wire: any = new (Wire as any)();
      wire.peerPieces.set(1);
      wire.peerPieces.set(2);
      torrent._onWire(wire);
    };

    const removeWire = (index: number) => {
      const wire = torrent.wires.splice(index, 1)[0];
      wire.destroy();
    };

    await it('initial rarest pick is within bounds', () => {
      validateInitial();
    });

    await it('initial rarest pick is within bounds after recalc', () => {
      rarityMap.recalculate();
      validateInitial();
    });

    await it('after setting pieces, rarest is 2', () => {
      setPiece(torrent.wires[0], 0);
      setPiece(torrent.wires[1], 0);
      setPiece(torrent.wires[0], 1);
      setPiece(torrent.wires[1], 3);
      expect(rarityMap.getRarestPiece()).toBe(2);
    });

    await it('after recalc, rarest is still 2', () => {
      rarityMap.recalculate();
      expect(rarityMap.getRarestPiece()).toBe(2);
    });

    await it('after adding wires, rarest is 3', () => {
      addWire();
      addWire();
      expect(rarityMap.getRarestPiece()).toBe(3);
    });

    await it('after adding wires + recalc, rarest is 3', () => {
      rarityMap.recalculate();
      expect(rarityMap.getRarestPiece()).toBe(3);
    });

    await it('after removing wires, rarest is 3', () => {
      removeWire(3);
      removeWire(1);
      expect(rarityMap.getRarestPiece()).toBe(3);
    });

    await it('after removing wires + recalc, rarest is 3', () => {
      rarityMap.recalculate();
      expect(rarityMap.getRarestPiece()).toBe(3);
    });

    await it('rarest piece filter: i <= 1 → 0', () => {
      expect(rarityMap.getRarestPiece((i: number) => i <= 1)).toBe(0);
    });

    await it('rarest piece filter: i === 1 || i === 2 → 2', () => {
      expect(rarityMap.getRarestPiece((i: number) => i === 1 || i === 2)).toBe(2);
    });

    // Cleanup
    for (const wire of torrent.wires) wire.destroy();
    torrent.destroy();
  });
};
