// SPDX-License-Identifier: MIT
// Inspired by node_modules/cosmiconfig/dist/Explorer.js — exercises
// load-cache + search-cache contracts (clearLoadCache / clearSearchCache /
// clearCaches), as documented in the README under "Caching".
// Original: Copyright (c) David Clark / cosmiconfig contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { cosmiconfig } from 'cosmiconfig';
import { writeFile } from 'node:fs/promises';
import { project } from './fixtures.js';

export default async () => {
  await describe('cosmiconfig — caching + cache clearing', async () => {

    await it('load() returns the SAME object on a cache hit', async () => {
      const explorer = cosmiconfig('foo');
      const filepath = project('projectJ') + '/.foorc.json';
      const a = await explorer.load(filepath);
      const b = await explorer.load(filepath);
      // Cosmiconfig caches by filepath — references must be identical.
      expect(a === b).toBe(true);
    });

    await it('clearLoadCache() forces re-read from disk', async () => {
      const explorer = cosmiconfig('foo');
      const filepath = project('projectJ') + '/.foorc.json';
      const a = await explorer.load(filepath);
      explorer.clearLoadCache();
      const b = await explorer.load(filepath);
      expect(a === b).toBe(false);
      // Value content must still match.
      expect(b?.config).toStrictEqual(a?.config);
    });

    await it('search() caches by directory', async () => {
      const explorer = cosmiconfig('foo');
      const dir = project('projectA');
      const a = await explorer.search(dir);
      const b = await explorer.search(dir);
      expect(a === b).toBe(true);
    });

    await it('clearSearchCache() forces re-walk', async () => {
      const explorer = cosmiconfig('foo');
      const dir = project('projectA');
      const a = await explorer.search(dir);
      explorer.clearSearchCache();
      const b = await explorer.search(dir);
      expect(a === b).toBe(false);
      expect(b?.config).toStrictEqual(a?.config);
    });

    await it('clearCaches() clears both load + search caches', async () => {
      const explorer = cosmiconfig('foo');
      const dir = project('projectA');
      const filepath = dir + '/.foorc.json';
      const sa = await explorer.search(dir);
      const la = await explorer.load(filepath);
      explorer.clearCaches();
      const sb = await explorer.search(dir);
      const lb = await explorer.load(filepath);
      expect(sa === sb).toBe(false);
      expect(la === lb).toBe(false);
    });

    await it('cache:false disables both caches', async () => {
      const explorer = cosmiconfig('foo', { cache: false });
      const dir = project('projectA');
      const a = await explorer.search(dir);
      const b = await explorer.search(dir);
      expect(a === b).toBe(false);
    });

    await it('clearLoadCache picks up disk changes after rewrite', async () => {
      // Stronger test: rewrite the file content and verify the cleared
      // cache surfaces the new value. Restore at the end so other suites
      // can rely on the canonical fixture content.
      const explorer = cosmiconfig('foo');
      const filepath = project('projectJ') + '/.foorc.json';
      const original = await explorer.load(filepath);
      const originalText = JSON.stringify({ source: 'cache-target', value: 10 }) + '\n';
      try {
        await writeFile(filepath, JSON.stringify({ source: 'cache-target', value: 999 }) + '\n');
        explorer.clearLoadCache();
        const updated = await explorer.load(filepath);
        expect(updated?.config).toStrictEqual({ source: 'cache-target', value: 999 });
        expect(original?.config).toStrictEqual({ source: 'cache-target', value: 10 });
      } finally {
        await writeFile(filepath, originalText);
      }
    });

  });
};
