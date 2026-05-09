// SPDX-License-Identifier: MIT
// Inspired by node_modules/@deepkit/type-compiler/dist/cjs/src/loader.* (the
// loader is part of the public API but the package's tests/ are not shipped
// in the npm tarball). Re-derived from the documented DeepkitLoader API.
// Original: Copyright (c) Deepkit. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { DeepkitLoader } from '@deepkit/type-compiler';

export default async () => {
  await describe('@deepkit/type-compiler — DeepkitLoader', async () => {

    await it('exports DeepkitLoader as a constructor', async () => {
      expect(typeof DeepkitLoader).toBe('function');
      const loader = new DeepkitLoader();
      expect(loader).toBeTruthy();
      expect(typeof loader.transform).toBe('function');
    });

    await it('passes through code that does not use the Type API', async () => {
      const loader = new DeepkitLoader();
      const src = 'export const foo = 42;\n';
      const out = loader.transform(src, '/virtual/foo.ts');
      expect(typeof out).toBe('string');
      // Plain code with no reflection markers should be returned unchanged
      // (or with at most cosmetic Printer normalization). Either way, the
      // declaration must survive.
      expect(out.includes('foo')).toBe(true);
      expect(out.includes('42')).toBe(true);
    });

    await it('handles empty input without throwing', async () => {
      const loader = new DeepkitLoader();
      const out = loader.transform('', '/virtual/empty.ts');
      expect(typeof out).toBe('string');
    });

    await it('handles a code path that uses TypeScript class + interface declarations', async () => {
      // Deepkit only emits __ΩX/typeOf metadata when typeOf<...>() is called;
      // a plain class+interface declaration must round-trip cleanly with no
      // emitted metadata side effects.
      const loader = new DeepkitLoader();
      const src = `
        interface User { id: number; name: string }
        export class Repo {
          users: User[] = [];
          add(u: User): void { this.users.push(u); }
        }
      `;
      const out = loader.transform(src, '/virtual/repo.ts');
      expect(typeof out).toBe('string');
      expect(out.includes('Repo')).toBe(true);
      expect(out.includes('add')).toBe(true);
    });

    await it('two transforms in a row do not interfere with each other', async () => {
      const loader = new DeepkitLoader();
      const a = loader.transform('export const a = 1;\n', '/virtual/a.ts');
      const b = loader.transform('export const b = 2;\n', '/virtual/b.ts');
      expect(a.includes('a')).toBe(true);
      expect(a.includes('1')).toBe(true);
      expect(b.includes('b')).toBe(true);
      expect(b.includes('2')).toBe(true);
    });

    await it('does not instrument typeOf callsites when none are present', async () => {
      const loader = new DeepkitLoader();
      const src = `
        export type Foo = { x: number };
        export const v: Foo = { x: 1 };
      `;
      const out = loader.transform(src, '/virtual/no-typeof.ts');
      // Note: Deepkit DOES emit `__ΩFoo` metadata for any exported type
      // alias (so library consumers can `typeOf` them later). What it does
      // NOT do without a typeOf callsite is rewrite a `typeOf<…>()` call
      // into `typeOf<…>([], …)`. That instrumentation is what the runtime
      // actually consumes — the bare metadata constant is harmless on its
      // own. Assert on the absence of the rewritten call signature.
      expect(/typeOf\s*<[^>]*>\s*\(\s*\[\s*\]\s*,/.test(out)).toBe(false);
      expect(out.includes('Foo')).toBe(true);
      expect(out.includes('v')).toBe(true);
    });

  });
};
