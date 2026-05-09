// SPDX-License-Identifier: MIT
// Inspired by node_modules/cosmiconfig/dist/loaders.js + the public README
// "search()" behaviour ("rc files in JSON or YAML format" / "package.json
// property"). The published cosmiconfig tarball excludes its own test
// fixtures and test files, so this is a re-derivation against the
// documented public API.
// Original: Copyright (c) David Clark / cosmiconfig contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { cosmiconfig, cosmiconfigSync } from 'cosmiconfig';
import { project } from './fixtures.js';

export default async () => {
  await describe('cosmiconfig — JSON loaders', async () => {

    await it('loads .foorc.json (JSON rc-file) via search()', async () => {
      const explorer = cosmiconfig('foo');
      const result = await explorer.search(project('projectA'));
      expect(result).toBeTruthy();
      expect(result?.config).toStrictEqual({ source: 'json-rc', value: 1 });
      expect(result?.filepath.endsWith('.foorc.json')).toBe(true);
    });

    await it('loads .foorc.json directly via load()', async () => {
      const explorer = cosmiconfig('foo');
      const filepath = project('projectA') + '/.foorc.json';
      const result = await explorer.load(filepath);
      expect(result).toBeTruthy();
      expect(result?.config).toStrictEqual({ source: 'json-rc', value: 1 });
      expect(result?.filepath).toBe(filepath);
    });

    await it('finds a config in package.json[<moduleName>]', async () => {
      const explorer = cosmiconfig('foo');
      const result = await explorer.search(project('projectC'));
      expect(result).toBeTruthy();
      expect(result?.config).toStrictEqual({ source: 'pkg-field', value: 3 });
      expect(result?.filepath.endsWith('package.json')).toBe(true);
    });

    await it('respects packageProp override', async () => {
      // projectC's package.json has the field under "foo" — point packageProp
      // at the same key explicitly to verify override path.
      const explorer = cosmiconfig('foo', { packageProp: 'foo' });
      const result = await explorer.search(project('projectC'));
      expect(result?.config).toStrictEqual({ source: 'pkg-field', value: 3 });
    });

    await it('returns null when no config is found', async () => {
      // Search a directory that has neither config nor package.json field.
      // We use the suite root (fixtures/) — no .foorc, no foo field anywhere.
      // searchStrategy:'none' restricts to the given dir, no walk-up.
      const explorer = cosmiconfig('definitely-no-such-tool-name-xyz', {
        searchStrategy: 'none',
      });
      const result = await explorer.search(project('projectA'));
      // projectA has only .foorc.json which is ours — not the bogus tool.
      expect(result).toBeNull();
    });

    await it('cosmiconfigSync — loads .foorc.json synchronously', () => {
      const explorer = cosmiconfigSync('foo');
      const result = explorer.search(project('projectA'));
      expect(result).toBeTruthy();
      expect(result?.config).toStrictEqual({ source: 'json-rc', value: 1 });
    });

    await it('cosmiconfigSync — load() reads JSON synchronously', () => {
      const explorer = cosmiconfigSync('foo');
      const filepath = project('projectA') + '/.foorc.json';
      const result = explorer.load(filepath);
      expect(result?.config).toStrictEqual({ source: 'json-rc', value: 1 });
    });

  });
};
