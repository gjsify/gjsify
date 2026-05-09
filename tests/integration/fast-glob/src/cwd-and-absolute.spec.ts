// SPDX-License-Identifier: MIT
// Inspired by fast-glob's documented `cwd` and `absolute` option semantics.
// Original: Copyright (c) Denis Malinochkin. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import * as path from 'node:path';
import fg from 'fast-glob';
import { FIXTURES_DIR } from './fixtures.js';

const sorted = (arr: string[]) => [...arr].sort();

export default async () => {
  await describe('fast-glob cwd & absolute', async () => {

    await it('returns paths relative to cwd by default', async () => {
      const files = await fg('**/*.ts', { cwd: FIXTURES_DIR });
      for (const f of files) {
        expect(path.isAbsolute(f)).toBe(false);
      }
      expect(files).toContain('sub/c.ts');
    });

    await it('returns absolute paths when absolute: true', async () => {
      const files = await fg('**/*.ts', { cwd: FIXTURES_DIR, absolute: true });
      for (const f of files) {
        expect(path.isAbsolute(f)).toBe(true);
        expect(f.startsWith(FIXTURES_DIR.replace(/\/$/, ''))).toBe(true);
      }
    });

    await it('honors deep cwd (sub/) — returns paths relative to that cwd', async () => {
      const subCwd = path.join(FIXTURES_DIR, 'sub');
      const files = await fg('**/*.ts', { cwd: subCwd });
      expect(sorted(files)).toStrictEqual(['c.ts', 'deeper/e.ts']);
    });

    await it('honors deep cwd with absolute: true', async () => {
      const subCwd = path.join(FIXTURES_DIR, 'sub');
      const files = await fg('**/*.ts', { cwd: subCwd, absolute: true });
      expect(sorted(files)).toStrictEqual(sorted([
        path.join(subCwd, 'c.ts'),
        path.join(subCwd, 'deeper', 'e.ts'),
      ]));
    });

    await it('async and sync agree on cwd-relative results', async () => {
      const opts = { cwd: FIXTURES_DIR };
      const a = sorted(await fg('sub/**/*.ts', opts));
      const s = sorted(fg.sync('sub/**/*.ts', opts));
      expect(a).toStrictEqual(s);
      expect(a).toStrictEqual(['sub/c.ts', 'sub/deeper/e.ts']);
    });

    await it('absolute pattern with no cwd locates files via absolute match', async () => {
      const absPattern = path.join(FIXTURES_DIR, '**/*.md').replace(/\\/g, '/');
      const files = await fg(absPattern);
      expect(files.length).toBe(1);
      expect(path.basename(files[0])).toBe('c.md');
    });

  });
};
