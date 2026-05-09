// SPDX-License-Identifier: MIT
// Inspired by node_modules/cosmiconfig/dist/defaults.js
// (`getDefaultSearchPlaces`) and the public README "By default cosmiconfig
// will check the current directory for the following" list. Verifies the
// search-up walk + the conventional places (`<name>rc`, `.config/<name>rc`,
// `<name>.config.{js,mjs,cjs,ts}`) that map a module name to a search set.
// Original: Copyright (c) David Clark / cosmiconfig contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import {
  cosmiconfig,
  getDefaultSearchPlaces,
  getDefaultSearchPlacesSync,
} from 'cosmiconfig';
import { project } from './fixtures.js';

export default async () => {
  await describe('cosmiconfig — module name → search rules', async () => {

    await it('getDefaultSearchPlaces(name) returns the documented entries', () => {
      const places = getDefaultSearchPlaces('foo');
      // The list must include the canonical patterns from the README.
      // We assert *contains* (set membership) rather than equality to
      // keep us tolerant to upstream additions across patch releases.
      const expected = [
        'package.json',
        '.foorc',
        '.foorc.json',
        '.foorc.yaml',
        '.foorc.yml',
        '.foorc.js',
        '.foorc.ts',
        '.foorc.mjs',
        '.foorc.cjs',
        '.config/foorc',
        '.config/foorc.json',
        '.config/foorc.yaml',
        '.config/foorc.yml',
        '.config/foorc.js',
        '.config/foorc.ts',
        '.config/foorc.mjs',
        '.config/foorc.cjs',
        'foo.config.js',
        'foo.config.ts',
        'foo.config.mjs',
        'foo.config.cjs',
      ];
      for (const entry of expected) {
        expect(places.includes(entry)).toBe(true);
      }
    });

    await it('getDefaultSearchPlacesSync(name) — sync omits .mjs only', () => {
      const places = getDefaultSearchPlacesSync('foo');
      // Sync loader cannot do dynamic ESM import — .mjs is excluded.
      expect(places.includes('.foorc.mjs')).toBe(false);
      expect(places.includes('foo.config.mjs')).toBe(false);
      // .cjs and .js still present.
      expect(places.includes('.foorc.cjs')).toBe(true);
      expect(places.includes('.foorc.js')).toBe(true);
    });

    await it('search() walks UP from a nested dir with searchStrategy:"project"', async () => {
      // Cosmiconfig v9's default searchStrategy is 'none' — walk-up is
      // opt-in via 'project' (stop at the project root, identified by
      // package.json or .git) or 'global' (walk to $HOME).
      // projectG/{package.json,.foorc.json} sit at the top, search starts
      // at deep/inner. The 'project' strategy walks up until it sees
      // package.json — projectG is the root.
      const explorer = cosmiconfig('foo', { searchStrategy: 'project' });
      const result = await explorer.search(project('projectG/deep/inner'));
      expect(result).toBeTruthy();
      expect(result?.config).toStrictEqual({ source: 'walk-up', value: 7 });
      expect(result?.filepath.endsWith('projectG/.foorc.json')).toBe(true);
    });

    await it('searchStrategy:"none" (default) disables the walk-up', async () => {
      const explorer = cosmiconfig('foo'); // default = 'none'
      const result = await explorer.search(project('projectG/deep/inner'));
      // Nothing in deep/inner — strategy:'none' must not climb up.
      expect(result).toBeNull();
    });

    await it('finds .config/<name>rc subdirectory entries', async () => {
      const explorer = cosmiconfig('foo');
      const result = await explorer.search(project('projectH'));
      expect(result).toBeTruthy();
      expect(result?.config).toStrictEqual({ source: 'dotconfig-subdir', value: 8 });
      // Must resolve to the .config/foorc.json file specifically.
      expect(result?.filepath.endsWith('.config/foorc.json')).toBe(true);
    });

    await it('custom searchPlaces overrides the defaults', async () => {
      // Restrict to only '.foorc.json' — the package.json field must be
      // ignored even when present.
      const explorer = cosmiconfig('foo', { searchPlaces: ['.foorc.json'] });
      const result = await explorer.search(project('projectC'));
      // projectC has no .foorc.json (only package.json#foo) — result null.
      expect(result).toBeNull();
    });

  });
};
