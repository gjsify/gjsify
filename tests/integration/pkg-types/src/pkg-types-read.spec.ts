// SPDX-License-Identifier: MIT
// Inspired by node_modules/pkg-types/test/ (not shipped in the npm tarball —
// the published "files" filter strips out tests). Re-derived from pkg-types'
// documented public API (readPackageJSON, resolvePackageJSON, findFile,
// findNearestFile, readTSConfig).
// Original: Copyright (c) Anthony Fu / unjs contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import {
  readPackageJSON,
  resolvePackageJSON,
  readTSConfig,
  resolveTSConfig,
  findFile,
  findNearestFile,
} from 'pkg-types';
import { join } from 'node:path';
import { FIXTURES_DIR } from './fixtures.js';

const PROJ1 = join(FIXTURES_DIR, 'proj1');
const PROJ1_NESTED = join(PROJ1, 'src', 'nested');
const PROJ2 = join(FIXTURES_DIR, 'proj2');

export default async () => {
  await describe('pkg-types — readPackageJSON / resolvePackageJSON', async () => {

    await it('reads a package.json from a directory path', async () => {
      const pkg = await readPackageJSON(PROJ1);
      expect(pkg.name).toBe('proj1');
      expect(pkg.version).toBe('1.2.3');
      expect(pkg.type).toBe('module');
    });

    await it('reads a package.json by absolute file path', async () => {
      const pkg = await readPackageJSON(join(PROJ1, 'package.json'));
      expect(pkg.name).toBe('proj1');
    });

    await it('preserves dependencies + scripts shape', async () => {
      const pkg = await readPackageJSON(PROJ1);
      expect(pkg.scripts?.build).toBe('tsc');
      expect(pkg.dependencies?.['left-pad']).toBe('1.3.0');
      expect(pkg.devDependencies?.typescript).toBe('^6.0.0');
    });

    await it('resolves the nearest package.json walking upward', async () => {
      // start from the deeply nested file — resolver must walk up to PROJ1.
      const resolved = await resolvePackageJSON(PROJ1_NESTED);
      expect(resolved.endsWith('proj1/package.json') || resolved.endsWith('proj1\\package.json')).toBeTruthy();
    });

    await it('reads a different project on its own (proj2)', async () => {
      const pkg = await readPackageJSON(PROJ2);
      expect(pkg.name).toBe('proj2');
      expect(pkg.private).toBe(true);
    });

  });

  await describe('pkg-types — readTSConfig / resolveTSConfig', async () => {

    await it('reads a tsconfig.json from a directory path', async () => {
      const tsc = await readTSConfig(PROJ1);
      expect(tsc.extends).toBe('./tsconfig.base.json');
      expect(tsc.compilerOptions?.outDir).toBe('dist');
      expect(tsc.compilerOptions?.baseUrl).toBe('.');
    });

    await it('preserves include / exclude arrays', async () => {
      const tsc = await readTSConfig(PROJ1);
      expect(tsc.include).toStrictEqual(['src/**/*']);
      expect(tsc.exclude).toStrictEqual(['dist']);
    });

    await it('resolves a tsconfig.json walking upward', async () => {
      const resolved = await resolveTSConfig(PROJ1_NESTED);
      expect(resolved.endsWith('tsconfig.json')).toBeTruthy();
    });

  });

  await describe('pkg-types — findFile / findNearestFile', async () => {

    await it('finds package.json from a deep directory', async () => {
      const found = await findNearestFile('package.json', { startingFrom: PROJ1_NESTED });
      expect(found.endsWith('package.json')).toBeTruthy();
    });

    await it('throws when the target file does not exist anywhere on the path', async () => {
      let threw = false;
      try {
        await findFile('definitely-not-a-real-file-xyz.json', { startingFrom: PROJ1_NESTED });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

  });
};
