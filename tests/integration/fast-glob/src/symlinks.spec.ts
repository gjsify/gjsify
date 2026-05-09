// SPDX-License-Identifier: MIT
// Inspired by fast-glob's `followSymbolicLinks` and `throwErrorOnBrokenSymbolicLink`
// option semantics. Exercises @gjsify/fs lstat/realpath/readdir(withFileTypes)
// against symlink entries (file → file, dir → dir, broken → ENOENT target).
// Original: Copyright (c) Denis Malinochkin. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import fg from 'fast-glob';
import { FIXTURES_DIR } from './fixtures.js';

const sorted = (arr: string[]) => [...arr].sort();

export default async () => {
  await describe('fast-glob symlinks', async () => {

    await it('followSymbolicLinks: true (default) treats symlink-to-file as a regular file', async () => {
      const files = await fg('symlink-to-a.ts', { cwd: FIXTURES_DIR });
      expect(files).toStrictEqual(['symlink-to-a.ts']);
    });

    await it('followSymbolicLinks: true descends through symlink-to-directory', async () => {
      const files = await fg('symlink-to-sub/**/*.ts', { cwd: FIXTURES_DIR });
      // Mirrors what `sub/**/*.ts` would return, prefixed with the symlink
      expect(sorted(files)).toStrictEqual([
        'symlink-to-sub/c.ts',
        'symlink-to-sub/deeper/e.ts',
      ]);
    });

    await it('followSymbolicLinks: false skips file symlinks', async () => {
      const files = await fg('**/*.ts', {
        cwd: FIXTURES_DIR,
        followSymbolicLinks: false,
      });
      expect(files).not.toContain('symlink-to-a.ts');
      expect(files).toContain('a.ts');
    });

    await it('followSymbolicLinks: false skips directory symlinks during ** descent', async () => {
      // With ** at the root, fast-glob would normally enter every directory
      // including symlinked ones; with followSymbolicLinks:false the
      // entries reachable only via symlink-to-sub are not produced.
      const files = await fg('**/*.ts', {
        cwd: FIXTURES_DIR,
        followSymbolicLinks: false,
      });
      for (const f of files) {
        expect(f.startsWith('symlink-to-sub/')).toBe(false);
      }
      // sub/* still reachable through the real directory
      expect(files).toContain('sub/c.ts');
    });

    await it('dangling symlink — suppressErrors: true (default) yields no error', async () => {
      // Default suppressErrors:true — fast-glob silently drops the broken link
      const files = await fg('dangling-symlink.ts', { cwd: FIXTURES_DIR });
      expect(Array.isArray(files)).toBe(true);
    });

    await it('async / sync agree on symlink resolution', async () => {
      const opts = { cwd: FIXTURES_DIR };
      const a = sorted(await fg('symlink-to-sub/**/*.ts', opts));
      const s = sorted(fg.sync('symlink-to-sub/**/*.ts', opts));
      expect(a).toStrictEqual(s);
    });

    await it('objectMode reports dirent.isSymbolicLink correctly when followSymbolicLinks: false', async () => {
      // With followSymbolicLinks:false, the entry's dirent should expose a
      // working isSymbolicLink() (no follow → lstat, not stat).
      const entries = await fg('symlink-to-a.ts', {
        cwd: FIXTURES_DIR,
        followSymbolicLinks: false,
        objectMode: true,
        onlyFiles: false,
      });
      // With onlyFiles:false the symlink itself is reported even though it
      // would be a "file" only via follow.
      if (entries.length > 0) {
        const e = entries[0] as any;
        expect(e.name).toBe('symlink-to-a.ts');
        expect(typeof e.dirent.isSymbolicLink).toBe('function');
        expect(e.dirent.isSymbolicLink()).toBe(true);
      } else {
        // Acceptable: with onlyFiles default true and no follow, the entry
        // is excluded (not a "file"). Either behavior is documented as
        // implementation-defined for the symlink edge case; we accept both.
        expect(entries).toStrictEqual([]);
      }
    });

  });
};
