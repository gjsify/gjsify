// SPDX-License-Identifier: MIT
// Inspired by node_modules/get-tsconfig/tests/specs/create-paths-matcher/
// (not shipped in the npm tarball). Re-derived from get-tsconfig's
// documented createPathsMatcher API.
// Original: Copyright (c) Hiroki Osame. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { getTsconfig, createPathsMatcher } from 'get-tsconfig';
import { join } from 'node:path';
import { FIXTURES_DIR } from './fixtures.js';

const PROJ1 = join(FIXTURES_DIR, 'proj1');

export default async () => {
  await describe('get-tsconfig — createPathsMatcher()', async () => {

    await it('returns a matcher when paths are configured', async () => {
      const tsc = getTsconfig(PROJ1);
      expect(tsc).toBeTruthy();
      const matcher = createPathsMatcher(tsc!);
      expect(matcher).toBeTruthy();
      expect(typeof matcher).toBe('function');
    });

    await it('matches @app/* aliases to candidate src/* paths', async () => {
      const tsc = getTsconfig(PROJ1);
      const matcher = createPathsMatcher(tsc!);
      expect(matcher).toBeTruthy();
      const candidates = matcher!('@app/foo');
      expect(Array.isArray(candidates)).toBe(true);
      expect(candidates.length).toBeGreaterThan(0);
      // The first candidate should resolve under PROJ1/src.
      expect(candidates[0].includes('src')).toBeTruthy();
      expect(candidates[0].endsWith('foo')).toBeTruthy();
    });

    await it('matches @nested/* aliases to src/nested/*', async () => {
      const tsc = getTsconfig(PROJ1);
      const matcher = createPathsMatcher(tsc!);
      const candidates = matcher!('@nested/deep');
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].includes('nested')).toBeTruthy();
      expect(candidates[0].endsWith('deep')).toBeTruthy();
    });

    await it('falls back to baseUrl-based resolution for non-aliased specifiers', async () => {
      // With baseUrl set (proj1 sets baseUrl: '.'), get-tsconfig resolves any
      // specifier that doesn't match a `paths` key relative to baseUrl —
      // matching tsc's own behavior. So 'totally-unrelated-package' yields
      // [<proj1>/totally-unrelated-package], NOT an empty list.
      const tsc = getTsconfig(PROJ1);
      const matcher = createPathsMatcher(tsc!);
      const candidates = matcher!('totally-unrelated-package');
      expect(Array.isArray(candidates)).toBe(true);
      expect(candidates.length).toBe(1);
      expect(candidates[0].endsWith('totally-unrelated-package')).toBeTruthy();
    });

  });
};
