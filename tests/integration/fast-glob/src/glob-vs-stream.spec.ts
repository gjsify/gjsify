// SPDX-License-Identifier: MIT
// Inspired by fast-glob's public API surface (async/sync/stream parity).
// Original: Copyright (c) Denis Malinochkin. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import fg from 'fast-glob';
import { FIXTURES_DIR } from './fixtures.js';

const sorted = (arr: string[]) => [...arr].sort();

function collectStream(stream: NodeJS.ReadableStream): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const out: string[] = [];
    stream.on('data', (chunk: Buffer | string) => out.push(chunk.toString()));
    stream.on('error', reject);
    stream.on('end', () => resolve(out));
  });
}

export default async () => {
  await describe('fast-glob async / sync / stream parity', async () => {

    await it('async fg() and fg.sync() produce the same set', async () => {
      const opts = { cwd: FIXTURES_DIR };
      const asyncFiles = sorted(await fg('**/*.ts', opts));
      const syncFiles = sorted(fg.sync('**/*.ts', opts));
      expect(asyncFiles).toStrictEqual(syncFiles);
    });

    await it('fg.stream() emits the same entries as fg()', async () => {
      const opts = { cwd: FIXTURES_DIR };
      const asyncFiles = sorted(await fg('**/*.{ts,js}', opts));
      const streamFiles = sorted(await collectStream(fg.stream('**/*.{ts,js}', opts)));
      expect(streamFiles).toStrictEqual(asyncFiles);
    });

    await it('stream emits zero entries on an empty match', async () => {
      const files = await collectStream(fg.stream('**/*.tsx', { cwd: FIXTURES_DIR }));
      expect(files).toStrictEqual([]);
    });

    await it('stream supports stats / objectMode entries', async () => {
      const opts = { cwd: FIXTURES_DIR, stats: true };
      const entries = await new Promise<any[]>((resolve, reject) => {
        const out: any[] = [];
        const s = fg.stream('a.ts', opts);
        s.on('data', (e: any) => out.push(e));
        s.on('error', reject);
        s.on('end', () => resolve(out));
      });
      expect(entries.length).toBe(1);
      expect(entries[0].name).toBe('a.ts');
      expect(entries[0].path).toBe('a.ts');
      expect(typeof entries[0].stats?.size).toBe('number');
      expect(entries[0].stats.size).toBeGreaterThan(0);
    });

    await it('async API with objectMode returns name/path/dirent shape', async () => {
      const entries = await fg('a.ts', { cwd: FIXTURES_DIR, objectMode: true });
      expect(entries.length).toBe(1);
      const e = entries[0] as any;
      expect(e.name).toBe('a.ts');
      expect(e.path).toBe('a.ts');
      // dirent is a fs.Dirent-like object
      expect(typeof e.dirent.isFile).toBe('function');
      expect(e.dirent.isFile()).toBe(true);
    });

  });
};
