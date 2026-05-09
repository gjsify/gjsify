// SPDX-License-Identifier: MIT
// Inspired by node_modules/cosmiconfig/dist/Explorer.js + the README
// "transform" section — verifies the optional transform callback is
// applied to the loaded result before it leaves the explorer.
// Original: Copyright (c) David Clark / cosmiconfig contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { cosmiconfig, cosmiconfigSync } from 'cosmiconfig';
import { project } from './fixtures.js';

export default async () => {
  await describe('cosmiconfig — transform option', async () => {

    await it('async transform sees and replaces the loaded value', async () => {
      const explorer = cosmiconfig('foo', {
        transform: async (result) => {
          if (!result) return result;
          return {
            ...result,
            config: { ...result.config, transformed: true, valueDoubled: result.config.value * 2 },
          };
        },
      });
      const result = await explorer.search(project('projectI'));
      expect(result?.config).toStrictEqual({
        source: 'transform-input',
        value: 9,
        transformed: true,
        valueDoubled: 18,
      });
    });

    await it('sync transform on cosmiconfigSync runs synchronously', () => {
      const explorer = cosmiconfigSync('foo', {
        transform: (result) => {
          if (!result) return result;
          return { ...result, config: { ...result.config, sync: true } };
        },
      });
      const result = explorer.search(project('projectI'));
      expect(result?.config).toStrictEqual({
        source: 'transform-input',
        value: 9,
        sync: true,
      });
    });

    await it('transform receives null when nothing is found', async () => {
      let received: unknown = 'not-called';
      const explorer = cosmiconfig('foo', {
        searchStrategy: 'none',
        transform: async (result) => {
          received = result;
          return result;
        },
      });
      // projectD has no .foorc.* (only foo.config.mjs) — skip and use a
      // dir we know is empty of cosmiconfig matches: projectG/deep/inner
      // with searchStrategy:'none'.
      const result = await explorer.search(project('projectG/deep/inner'));
      expect(result).toBeNull();
      expect(received).toBeNull();
    });

  });
};
