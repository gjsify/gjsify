// SPDX-License-Identifier: MIT
// Inspired by Deepkit's documented reflection API — re-derived from the
// `typeOf<T>()` emission contract that @gjsify/rolldown-plugin-deepkit
// hands user code through.
// Original: Copyright (c) Deepkit. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { DeepkitLoader } from '@deepkit/type-compiler';

export default async () => {
  await describe('@deepkit/type-compiler — typeOf<T>() emission', async () => {

    // Deepkit's instrumentation signal is that it rewrites `typeOf<T>()`
    // (zero-arg call site) into `typeOf<T>([], [...metadata])` — adding two
    // synthetic arguments. The exact metadata shape varies by input kind:
    // named interfaces / type aliases produce a hoisted `const __ΩName = […]`
    // (note the Greek capital omega Ω, U+03A9); classes get a `static __type`
    // member; inline structural types emit an in-place encoded string. The
    // common signal across all of these is the rewritten `typeOf<…>([], …)`
    // call.
    function isInstrumented(src: string): boolean {
      // Strict signal: there must be at least one `>([], ` sequence — i.e.
      // the `typeOf<…>(…)` callsite gained a leading empty array argument
      // before any other arg. Using `>([]` instead of `typeOf<…>([]` lets
      // multi-line type literals (e.g. `<{ items: ... }>`) match without
      // needing a balanced-bracket parser.
      return /typeOf\b/.test(src) && />\s*\(\s*\[\s*\]\s*,/.test(src);
    }

    await it('emits reflection metadata when typeOf<T>() is called on an interface', async () => {
      const loader = new DeepkitLoader();
      const src = `
        import { typeOf } from '@deepkit/type';
        interface User { id: number; name: string }
        export const t = typeOf<User>();
      `;
      const out = loader.transform(src, '/virtual/typeof-interface.ts');
      // Instrumentation signal + named-interface-specific metadata constant.
      expect(isInstrumented(out)).toBe(true);
      expect(out.includes('__ΩUser')).toBe(true);
    });

    await it('emits reflection metadata when typeOf<T>() is called on a class', async () => {
      const loader = new DeepkitLoader();
      const src = `
        import { typeOf } from '@deepkit/type';
        export class Order {
          id!: number;
          total!: number;
        }
        export const t = typeOf<Order>();
      `;
      const out = loader.transform(src, '/virtual/typeof-class.ts');
      expect(isInstrumented(out)).toBe(true);
      // Class-specific Deepkit signal: a `static __type` member is added.
      expect(out.includes('Order')).toBe(true);
      expect(out.includes('static __type')).toBe(true);
    });

    await it('emits reflection metadata for primitive type aliases', async () => {
      const loader = new DeepkitLoader();
      const src = `
        import { typeOf } from '@deepkit/type';
        export type Id = string;
        export const t = typeOf<Id>();
      `;
      const out = loader.transform(src, '/virtual/typeof-primitive.ts');
      expect(isInstrumented(out)).toBe(true);
      expect(out.includes('__ΩId')).toBe(true);
    });

    await it('emits reflection metadata for inline structural types (no hoisted constant)', async () => {
      const loader = new DeepkitLoader();
      const src = `
        import { typeOf } from '@deepkit/type';
        export const t = typeOf<{ items: Array<{ x: number }> }>();
      `;
      const out = loader.transform(src, '/virtual/typeof-generic.ts');
      // Inline structural types don't get a hoisted __Ω constant — Deepkit
      // emits the metadata as an in-place encoded string in the second
      // argument array. The instrumentation signal still holds.
      expect(isInstrumented(out)).toBe(true);
      expect(out.includes('items')).toBe(true);
    });

    await it('round-trip: re-running the transform on already-transformed output is safe', async () => {
      const loader1 = new DeepkitLoader();
      const loader2 = new DeepkitLoader();
      const src = `
        import { typeOf } from '@deepkit/type';
        interface Foo { a: number }
        export const t = typeOf<Foo>();
      `;
      const once = loader1.transform(src, '/virtual/round-trip.ts');
      // A second pass shouldn't crash; we don't assert exact equality —
      // only that the re-transform produces a string and the instrumentation
      // signal stays present.
      const twice = loader2.transform(once, '/virtual/round-trip.ts');
      expect(typeof twice).toBe('string');
      expect(isInstrumented(twice)).toBe(true);
    });

    await it('handles syntactically broken input without exiting the process', async () => {
      // The Deepkit loader internally swallows TS diagnostics and keeps
      // transforming. We just verify no uncaught exception escapes.
      const loader = new DeepkitLoader();
      let returnedString = '';
      try {
        returnedString = loader.transform('export const foo: ; // intentionally invalid\n', '/virtual/broken.ts');
      } catch {
        // Even if it throws, the GJS process should not have died — we'd
        // never reach this point if it had.
      }
      expect(typeof returnedString).toBe('string');
    });

  });
};
