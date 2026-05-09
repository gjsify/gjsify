// SPDX-License-Identifier: MIT
// Inspired by node_modules/pkg-types/test/ (not shipped in the npm tarball).
// Re-derived from pkg-types' documented public API: writePackageJSON,
// writeTSConfig, definePackageJSON, defineTSConfig.
// Original: Copyright (c) Anthony Fu / unjs contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import {
  readPackageJSON,
  writePackageJSON,
  readTSConfig,
  writeTSConfig,
  definePackageJSON,
  defineTSConfig,
} from 'pkg-types';
import { join } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { FIXTURES_DIR } from './fixtures.js';

const WRITE_TARGET = join(FIXTURES_DIR, 'write-target');

export default async () => {
  await describe('pkg-types — definePackageJSON / defineTSConfig (identity helpers)', async () => {

    await it('definePackageJSON returns its input untouched', async () => {
      const input = { name: 'foo', version: '1.0.0' };
      expect(definePackageJSON(input)).toBe(input);
    });

    await it('defineTSConfig returns its input untouched', async () => {
      const input = { compilerOptions: { strict: true } };
      expect(defineTSConfig(input)).toBe(input);
    });

  });

  await describe('pkg-types — writePackageJSON round-trip', async () => {

    await it('writes a package.json and reads it back identically', async () => {
      const target = join(WRITE_TARGET, 'package.json');
      const input = definePackageJSON({
        name: 'roundtrip-pkg',
        version: '2.0.0',
        scripts: { test: 'echo ok' },
        dependencies: { foo: '^1.0.0' },
      });
      await writePackageJSON(target, input);

      const read = await readPackageJSON(target);
      expect(read.name).toBe('roundtrip-pkg');
      expect(read.version).toBe('2.0.0');
      expect(read.scripts?.test).toBe('echo ok');
      expect(read.dependencies?.foo).toBe('^1.0.0');
    });

    await it('overwrites an existing package.json with new content', async () => {
      const dir = join(FIXTURES_DIR, 'write-overwrite');
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const target = join(dir, 'package.json');
      await writeFile(target, JSON.stringify({ name: 'old', version: '0.0.1' }) + '\n');

      await writePackageJSON(target, { name: 'new', version: '0.0.2' });

      const read = await readPackageJSON(target);
      expect(read.name).toBe('new');
      expect(read.version).toBe('0.0.2');
    });

    await it('round-trips nested objects and arrays', async () => {
      const dir = join(FIXTURES_DIR, 'write-nested');
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const target = join(dir, 'package.json');
      const pkg = {
        name: 'nested',
        version: '0.0.0',
        keywords: ['a', 'b', 'c'],
        author: { name: 'Tester', email: 'test@example.com' },
        bin: { 'my-cli': './cli.mjs' },
      };
      await writePackageJSON(target, pkg);
      const read = await readPackageJSON(target);
      expect(read.keywords).toStrictEqual(['a', 'b', 'c']);
      expect((read.author as { name: string })?.name).toBe('Tester');
      expect((read.bin as Record<string, string>)?.['my-cli']).toBe('./cli.mjs');
    });

  });

  await describe('pkg-types — writeTSConfig round-trip', async () => {

    await it('writes a tsconfig.json and reads it back identically', async () => {
      const dir = join(FIXTURES_DIR, 'write-tsc');
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const target = join(dir, 'tsconfig.json');
      const tsc = defineTSConfig({
        compilerOptions: {
          target: 'es2022',
          module: 'esnext',
          strict: true,
        },
        include: ['src'],
      });
      await writeTSConfig(target, tsc);

      const read = await readTSConfig(target);
      expect(read.compilerOptions?.target).toBe('es2022');
      expect(read.compilerOptions?.module).toBe('esnext');
      expect(read.compilerOptions?.strict).toBe(true);
      expect(read.include).toStrictEqual(['src']);
    });

  });
};
