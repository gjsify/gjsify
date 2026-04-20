// Local fixture loader — reads copied torrent/content files from ./fixtures/
// and parses them via parse-torrent. Replaces `import fixtures from
// 'webtorrent-fixtures'` because that CJS module uses `__dirname`, which
// collides with top-level await in the ESM bundle (ERR_AMBIGUOUS_MODULE_SYNTAX).
//
// The fixtures/ directory is populated at prebuild time by
// scripts/copy-fixtures.mjs.

import { readFileSync } from 'node:fs';
// parse-torrent is ESM only from v9; v7 exports CJS with named default.
// Typings are loose on purpose — we call the same shape webtorrent's
// own tests see from the `webtorrent-fixtures` package.
import parseTorrent from 'parse-torrent';

interface TorrentFixture {
  contentPath: URL;
  torrentPath: URL;
  content: Buffer;
  torrent: Buffer;
  parsedTorrent: any;
  magnetURI: string;
}

interface TorrentOnlyFixture {
  torrentPath: URL;
  torrent: Buffer;
  parsedTorrent: any;
  magnetURI: string;
}

function fixtureUrl(filename: string): URL {
  return new URL(`../fixtures/${filename}`, import.meta.url);
}

function loadTorrent(filename: string): Buffer {
  return readFileSync(fixtureUrl(filename));
}

function loadContent(filename: string): Buffer {
  return readFileSync(fixtureUrl(filename));
}

function buildTorrent(contentFile: string, torrentFile: string): TorrentFixture {
  const torrent = loadTorrent(torrentFile);
  const content = loadContent(contentFile);
  const parsed = (parseTorrent as any)(torrent);
  return {
    contentPath: fixtureUrl(contentFile),
    torrentPath: fixtureUrl(torrentFile),
    content,
    torrent,
    parsedTorrent: parsed,
    magnetURI: (parseTorrent as any).toMagnetURI(parsed),
  };
}

function buildTorrentOnly(torrentFile: string): TorrentOnlyFixture {
  const torrent = loadTorrent(torrentFile);
  const parsed = (parseTorrent as any)(torrent);
  return {
    torrentPath: fixtureUrl(torrentFile),
    torrent,
    parsedTorrent: parsed,
    magnetURI: (parseTorrent as any).toMagnetURI(parsed),
  };
}

const fixtures = {
  leaves: buildTorrent('Leaves of Grass by Walt Whitman.epub', 'leaves.torrent'),
  alice: buildTorrent('alice.txt', 'alice.torrent'),
  numbers: buildTorrentOnly('numbers.torrent'),
};

export default fixtures;
