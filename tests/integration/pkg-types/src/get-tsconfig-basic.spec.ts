// SPDX-License-Identifier: MIT
// Inspired by node_modules/get-tsconfig/tests/ (not shipped in the npm
// tarball — published "files" filter strips out tests). Re-derived from
// get-tsconfig's documented public API: getTsconfig, parseTsconfig,
// findTsconfig.
// Original: Copyright (c) Hiroki Osame. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { getTsconfig, parseTsconfig, findTsconfig } from 'get-tsconfig';
import { join } from 'node:path';
import { FIXTURES_DIR } from './fixtures.js';

const PROJ1 = join(FIXTURES_DIR, 'proj1');
const PROJ1_NESTED = join(PROJ1, 'src', 'nested');
const PROJ2 = join(FIXTURES_DIR, 'proj2');

export default async () => {
  await describe('get-tsconfig — getTsconfig()', async () => {

    await it('finds and returns tsconfig.json from a project root', async () => {
      const result = getTsconfig(PROJ1);
      expect(result).toBeTruthy();
      expect(result?.path.endsWith('tsconfig.json')).toBeTruthy();
      expect(result?.config).toBeTruthy();
    });

    await it('walks up from a nested directory to find tsconfig.json', async () => {
      const result = getTsconfig(PROJ1_NESTED);
      expect(result).toBeTruthy();
      // Path is in proj1, not proj1/src/nested.
      expect(result?.path.includes('proj1')).toBeTruthy();
      expect(result?.path.endsWith('tsconfig.json')).toBeTruthy();
    });

    await it('returns null when no tsconfig is found above the path', async () => {
      // /tmp typically has no tsconfig.json above it.
      const result = getTsconfig('/tmp/__no_tsconfig_here__');
      expect(result).toBeNull();
    });

    await it('parses compilerOptions correctly after extends-resolution', async () => {
      const result = getTsconfig(PROJ1);
      expect(result).toBeTruthy();
      // proj1 extends ./tsconfig.base.json which sets target/module/strict.
      expect(result?.config.compilerOptions?.target).toBe('es2022');
      expect(result?.config.compilerOptions?.module).toBe('esnext');
      expect(result?.config.compilerOptions?.strict).toBe(true);
      // Local overrides remain. get-tsconfig normalizes paths to ./<value>.
      expect(result?.config.compilerOptions?.outDir).toBe('./dist');
    });

  });

  await describe('get-tsconfig — parseTsconfig()', async () => {

    await it('parses a tsconfig.json by absolute path', async () => {
      const config = parseTsconfig(join(PROJ1, 'tsconfig.json'));
      expect(config).toBeTruthy();
      // get-tsconfig normalizes relative paths to './<value>'.
      expect(config.compilerOptions?.outDir).toBe('./dist');
    });

    await it('throws on a non-existent file', async () => {
      expect(() => parseTsconfig('/tmp/__not-there__/tsconfig.json')).toThrow();
    });

    await it('parses a base config without extends', async () => {
      const config = parseTsconfig(join(PROJ1, 'tsconfig.base.json'));
      expect(config.compilerOptions?.target).toBe('es2022');
      expect(config.compilerOptions?.strict).toBe(true);
    });

  });

  await describe('get-tsconfig — findTsconfig()', async () => {

    await it('returns a path string when found', async () => {
      const found = findTsconfig(PROJ1);
      expect(typeof found).toBe('string');
      expect(found?.endsWith('tsconfig.json')).toBeTruthy();
    });

    await it('walks up from a nested dir', async () => {
      const found = findTsconfig(PROJ2);
      expect(typeof found).toBe('string');
      expect(found?.includes('proj2')).toBeTruthy();
    });

  });
};
