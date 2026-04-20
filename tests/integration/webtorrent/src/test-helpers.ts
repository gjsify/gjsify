// Shared helpers for webtorrent integration tests.
// The main concern is per-test storage isolation: webtorrent's default
// `path` for a given infoHash is deterministic (`<tmpdir>/webtorrent/<hash>`),
// so successive seed/add calls for the same fixture in one process will
// hit the previous test's on-disk chunks and mark the new torrent as done.
// `uniqueTempPath()` returns a fresh directory every call.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function uniqueTempPath(): string {
  return mkdtempSync(join(tmpdir(), 'gjsify-wt-'));
}
