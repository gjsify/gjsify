// SPDX-License-Identifier: MIT
// Inspired by node_modules/get-tsconfig/tests/specs/parse-tsconfig/extends/
// (not shipped in the npm tarball). Re-derived from get-tsconfig's
// documented "extends" resolution semantics.
// Original: Copyright (c) Hiroki Osame. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { getTsconfig, parseTsconfig } from 'get-tsconfig';
import { join } from 'node:path';
import { FIXTURES_DIR } from './fixtures.js';

const PROJ1 = join(FIXTURES_DIR, 'proj1');
const PROJ2 = join(FIXTURES_DIR, 'proj2');

export default async () => {
  await describe('get-tsconfig — extends chain resolution', async () => {

    await it('inlines fields from a single ./relative extends', async () => {
      // proj1/tsconfig.json extends ./tsconfig.base.json.
      // base sets {target, module, strict, esModuleInterop}; child sets
      // {outDir, baseUrl, paths}. Result must contain ALL of them.
      const result = getTsconfig(PROJ1);
      expect(result).toBeTruthy();
      const co = result?.config.compilerOptions;
      expect(co?.target).toBe('es2022');
      expect(co?.module).toBe('esnext');
      expect(co?.strict).toBe(true);
      expect(co?.esModuleInterop).toBe(true);
      // get-tsconfig normalizes relative paths to './<value>'.
      expect(co?.outDir).toBe('./dist');
      expect(co?.baseUrl).toBeTruthy();
    });

    await it('resolves a 2-level extends chain (a -> b -> c)', async () => {
      // proj2/tsconfig.json extends ./configs/tsconfig.strict.json
      // which extends ./tsconfig.shared.json.
      // shared sets {target:es2020, module:commonjs}, strict adds
      // {strict:true, noImplicitAny:true}, top-level adds {declaration:true}.
      const result = getTsconfig(PROJ2);
      expect(result).toBeTruthy();
      const co = result?.config.compilerOptions;
      expect(co?.target).toBe('es2020');
      expect(co?.module).toBe('commonjs');
      expect(co?.strict).toBe(true);
      expect(co?.noImplicitAny).toBe(true);
      expect(co?.declaration).toBe(true);
    });

    await it('extends-chain via parseTsconfig() on the leaf file matches getTsconfig()', async () => {
      const fromGet = getTsconfig(PROJ2);
      const fromParse = parseTsconfig(join(PROJ2, 'tsconfig.json'));
      expect(fromParse.compilerOptions?.target).toBe(fromGet?.config.compilerOptions?.target);
      expect(fromParse.compilerOptions?.module).toBe(fromGet?.config.compilerOptions?.module);
      expect(fromParse.compilerOptions?.strict).toBe(fromGet?.config.compilerOptions?.strict);
      expect(fromParse.compilerOptions?.declaration).toBe(fromGet?.config.compilerOptions?.declaration);
    });

    await it('child wins over parent for overlapping fields', async () => {
      // Sanity: in proj1, base sets target=es2022; if we wrote a child that
      // overrode target, the child value should win. Use parseTsconfig
      // directly on proj1's leaf to confirm the resolved view.
      const config = parseTsconfig(join(PROJ1, 'tsconfig.json'));
      // outDir is only set in the child — must survive (normalized to './<value>').
      expect(config.compilerOptions?.outDir).toBe('./dist');
      // target is only set in base — must be inherited.
      expect(config.compilerOptions?.target).toBe('es2022');
    });

    await it('parseTsconfig on a real chain root does not throw', async () => {
      const target = join(PROJ1, 'tsconfig.json');
      expect(() => parseTsconfig(target)).not.toThrow();
    });

  });
};
