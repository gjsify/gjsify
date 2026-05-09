// SPDX-License-Identifier: MIT
// Reference: @rollup/pluginutils public API (LICENSE: refs is not vendored —
// upstream tests live at https://github.com/rollup/plugins/tree/master/packages/pluginutils/test).
// Original: Copyright (c) 2019 RollupJS Plugin Contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Exercises createFilter() — resolves include/exclude patterns against
// process.cwd(), defers to picomatch for glob matching. Also stresses
// node:path resolve() + sep handling (Win32 paths normalized to posix).

import { describe, it, expect } from '@gjsify/unit';
import { resolve } from 'node:path';
import { createFilter } from '@rollup/pluginutils';

export default async () => {
  await describe('@rollup/pluginutils createFilter', async () => {

    await it('returns true for any string when include/exclude are omitted', async () => {
      const filter = createFilter();
      expect(filter('foo.js')).toBe(true);
      expect(filter('/abs/path/file.ts')).toBe(true);
      expect(filter('relative/path.json')).toBe(true);
    });

    await it('rejects strings containing NUL bytes (virtual modules)', async () => {
      const filter = createFilter();
      expect(filter('\0commonjs-helpers')).toBe(false);
      expect(filter('plain.js\0suffix')).toBe(false);
    });

    await it('returns false for non-string ids', async () => {
      const filter = createFilter();
      expect(filter(undefined)).toBe(false);
      expect(filter(null)).toBe(false);
      expect(filter(123)).toBe(false);
      expect(filter({})).toBe(false);
    });

    await it('matches a single basic glob pattern', async () => {
      const filter = createFilter('*.js');
      const cwd = process.cwd();
      expect(filter(resolve(cwd, 'foo.js'))).toBe(true);
      expect(filter(resolve(cwd, 'foo.ts'))).toBe(false);
    });

    await it('matches an array of patterns', async () => {
      const filter = createFilter(['*.js', '*.ts']);
      const cwd = process.cwd();
      expect(filter(resolve(cwd, 'a.js'))).toBe(true);
      expect(filter(resolve(cwd, 'b.ts'))).toBe(true);
      expect(filter(resolve(cwd, 'c.json'))).toBe(false);
    });

    await it('honours exclude patterns', async () => {
      const filter = createFilter('*.js', '*.spec.js');
      const cwd = process.cwd();
      expect(filter(resolve(cwd, 'app.js'))).toBe(true);
      expect(filter(resolve(cwd, 'app.spec.js'))).toBe(false);
    });

    await it('returns false when only an exclude pattern matches', async () => {
      // No include + matching exclude => filter returns false.
      const filter = createFilter(null, '*.spec.js');
      const cwd = process.cwd();
      expect(filter(resolve(cwd, 'app.spec.js'))).toBe(false);
      // No include and no matching exclude => filter falls through to true
      // because !includeMatchers.length is the final return.
      expect(filter(resolve(cwd, 'app.js'))).toBe(true);
    });

    await it('matches recursive ** globs', async () => {
      const filter = createFilter('**/*.ts');
      const cwd = process.cwd();
      expect(filter(resolve(cwd, 'src/a.ts'))).toBe(true);
      expect(filter(resolve(cwd, 'src/nested/deep/b.ts'))).toBe(true);
      expect(filter(resolve(cwd, 'src/a.js'))).toBe(false);
    });

    await it('matches brace-expansion globs', async () => {
      const filter = createFilter('**/*.{js,ts}');
      const cwd = process.cwd();
      expect(filter(resolve(cwd, 'src/a.js'))).toBe(true);
      expect(filter(resolve(cwd, 'src/a.ts'))).toBe(true);
      expect(filter(resolve(cwd, 'src/a.json'))).toBe(false);
    });

    await it('treats absolute include patterns as already resolved', async () => {
      const abs = resolve('/tmp/project/src/*.js');
      const filter = createFilter(abs);
      expect(filter(resolve('/tmp/project/src/index.js'))).toBe(true);
      expect(filter(resolve('/tmp/project/src/index.ts'))).toBe(false);
      expect(filter(resolve('/tmp/other/src/index.js'))).toBe(false);
    });

    await it('options.resolve picks a different base directory', async () => {
      const filter = createFilter('*.js', null, { resolve: '/tmp/proj' });
      expect(filter('/tmp/proj/foo.js')).toBe(true);
      expect(filter('/tmp/other/foo.js')).toBe(false);
    });

    await it('options.resolve = false leaves patterns unresolved (virtual ids)', async () => {
      const filter = createFilter('virtual:*', null, { resolve: false });
      expect(filter('virtual:my-module')).toBe(true);
      expect(filter('real-module')).toBe(false);
    });

    await it('accepts RegExp patterns directly', async () => {
      const filter = createFilter(/\.tsx?$/);
      expect(filter('/abs/foo.ts')).toBe(true);
      expect(filter('/abs/foo.tsx')).toBe(true);
      expect(filter('/abs/foo.js')).toBe(false);
    });

    await it('mixes RegExp and glob patterns in the same array', async () => {
      const filter = createFilter([/\.tsx?$/, '**/*.json']);
      const cwd = process.cwd();
      expect(filter('/abs/file.ts')).toBe(true);
      expect(filter(resolve(cwd, 'a/b/c.json'))).toBe(true);
      expect(filter('/abs/file.js')).toBe(false);
    });

    await it('include patterns that start with ** stay unresolved', async () => {
      const filter = createFilter('**/*.svelte');
      expect(filter('/some/abs/path/Component.svelte')).toBe(true);
      expect(filter('/some/abs/path/Component.vue')).toBe(false);
    });
  });
};
