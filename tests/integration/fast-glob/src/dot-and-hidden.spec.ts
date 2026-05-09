// SPDX-License-Identifier: MIT
// Inspired by fast-glob's `dot`, `onlyFiles`, and `markDirectories` options.
// Original: Copyright (c) Denis Malinochkin. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import fg from 'fast-glob';
import { FIXTURES_DIR } from './fixtures.js';

const sorted = (arr: string[]) => [...arr].sort();

export default async () => {
  await describe('fast-glob dot files & directory listing', async () => {

    await it('hides dot files by default', async () => {
      const files = await fg('**/*', { cwd: FIXTURES_DIR });
      for (const f of files) {
        // No path segment may begin with a dot
        for (const seg of f.split('/')) {
          expect(seg.startsWith('.')).toBe(false);
        }
      }
    });

    await it('includes dot files with dot: true', async () => {
      const files = await fg('**/*', { cwd: FIXTURES_DIR, dot: true });
      expect(files).toContain('.dotfile');
      expect(files).toContain('sub/.dotsub/hidden.ts');
    });

    await it('onlyFiles: true (default) excludes directories', async () => {
      const files = await fg('**/*', { cwd: FIXTURES_DIR });
      expect(files).not.toContain('sub');
      expect(files).not.toContain('sub/deeper');
    });

    await it('onlyFiles: false includes directory entries', async () => {
      const files = await fg('**/*', { cwd: FIXTURES_DIR, onlyFiles: false });
      expect(files).toContain('sub');
      expect(files).toContain('sub/deeper');
    });

    await it('markDirectories: true appends a trailing slash to directory entries', async () => {
      const files = await fg('**/*', {
        cwd: FIXTURES_DIR,
        onlyFiles: false,
        markDirectories: true,
      });
      expect(files).toContain('sub/');
      expect(files).toContain('sub/deeper/');
      // Files keep no trailing slash
      expect(files).toContain('a.ts');
    });

    await it('onlyDirectories: true returns only directories', async () => {
      const files = await fg('**/*', { cwd: FIXTURES_DIR, onlyDirectories: true });
      // symlink-to-sub is followed by default (followSymbolicLinks:true)
      // and counts as a directory entry.
      expect(sorted(files)).toStrictEqual([
        'sub',
        'sub/deeper',
        'symlink-to-sub',
        'symlink-to-sub/deeper',
      ]);
    });

    await it('onlyDirectories: true + followSymbolicLinks: false drops symlink dirs', async () => {
      const files = await fg('**/*', {
        cwd: FIXTURES_DIR,
        onlyDirectories: true,
        followSymbolicLinks: false,
      });
      expect(sorted(files)).toStrictEqual(['sub', 'sub/deeper']);
    });

    await it('onlyDirectories: true + dot: true includes hidden directories', async () => {
      const files = await fg('**/*', {
        cwd: FIXTURES_DIR,
        onlyDirectories: true,
        dot: true,
      });
      expect(files).toContain('sub/.dotsub');
    });

  });
};
