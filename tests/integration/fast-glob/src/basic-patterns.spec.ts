// SPDX-License-Identifier: MIT
// Inspired by node_modules/fast-glob/__tests__/ (not shipped in the npm
// tarball — published "files" filter strips out tests). Re-derived from
// fast-glob's documented public API.
// Original: Copyright (c) Denis Malinochkin. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import fg from 'fast-glob';
import { FIXTURES_DIR } from './fixtures.js';

const sorted = (arr: string[]) => [...arr].sort();

export default async () => {
  await describe('fast-glob basic patterns', async () => {

    await it('matches *.ts at the top level (cwd-relative)', async () => {
      const files = await fg('*.ts', { cwd: FIXTURES_DIR });
      expect(sorted(files)).toStrictEqual(['a.ts', 'excluded.ts', 'symlink-to-a.ts']);
    });

    await it('matches **/*.ts recursively', async () => {
      const files = await fg('**/*.ts', { cwd: FIXTURES_DIR });
      // sub/.dotsub/hidden.ts not included by default (dot files hidden).
      // symlink-to-sub is followed by default (followSymbolicLinks:true).
      expect(sorted(files)).toStrictEqual([
        'a.ts',
        'excluded.ts',
        'sub/c.ts',
        'sub/deeper/e.ts',
        'symlink-to-a.ts',
        'symlink-to-sub/c.ts',
        'symlink-to-sub/deeper/e.ts',
      ]);
    });

    await it('matches **/*.{ts,js}', async () => {
      const files = await fg('**/*.{ts,js}', { cwd: FIXTURES_DIR });
      expect(sorted(files)).toStrictEqual([
        'a.ts',
        'b.js',
        'excluded.ts',
        'sub/c.ts',
        'sub/d.js',
        'sub/deeper/e.ts',
        'symlink-to-a.ts',
        'symlink-to-sub/c.ts',
        'symlink-to-sub/d.js',
        'symlink-to-sub/deeper/e.ts',
      ]);
    });

    await it('honors negative patterns via !**/excluded.ts', async () => {
      const files = await fg(['**/*.ts', '!**/excluded.ts'], { cwd: FIXTURES_DIR });
      expect(sorted(files)).toStrictEqual([
        'a.ts',
        'sub/c.ts',
        'sub/deeper/e.ts',
        'symlink-to-a.ts',
        'symlink-to-sub/c.ts',
        'symlink-to-sub/deeper/e.ts',
      ]);
    });

    await it('honors the ignore option', async () => {
      const files = await fg('**/*.ts', { cwd: FIXTURES_DIR, ignore: ['**/excluded.ts'] });
      expect(sorted(files)).toStrictEqual([
        'a.ts',
        'sub/c.ts',
        'sub/deeper/e.ts',
        'symlink-to-a.ts',
        'symlink-to-sub/c.ts',
        'symlink-to-sub/deeper/e.ts',
      ]);
    });

    await it('returns [] for a pattern matching nothing', async () => {
      const files = await fg('**/*.tsx', { cwd: FIXTURES_DIR });
      expect(files).toStrictEqual([]);
    });

    await it('exposes isDynamicPattern() static', async () => {
      expect(fg.isDynamicPattern('**/*.ts')).toBe(true);
      expect(fg.isDynamicPattern('a.ts')).toBe(false);
      expect(fg.isDynamicPattern('a/b/c.ts')).toBe(false);
    });

    await it('exposes escapePath() — escapes glob meta chars', async () => {
      // escapePath() prefixes meta chars with a backslash so they match
      // literally when used inside a larger pattern.
      expect(fg.escapePath('a*.ts')).toBe('a\\*.ts');
      expect(fg.escapePath('a{b}.ts')).toBe('a\\{b\\}.ts');
      expect(fg.escapePath('plain.ts')).toBe('plain.ts');
    });

  });
};
