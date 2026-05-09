// SPDX-License-Identifier: MIT
// Reference: @rollup/pluginutils public API.
// Original: Copyright (c) 2019 RollupJS Plugin Contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Exercises dataToEsm() — turns plain objects into tree-shakable ES Module
// source. Covers compact mode, named exports, indent control, primitive
// + special-value handling. Pure JS — no GNOME deps.

import { describe, it, expect } from '@gjsify/unit';
import { dataToEsm } from '@rollup/pluginutils';

export default async () => {
  await describe('@rollup/pluginutils dataToEsm', async () => {

    await it('emits named exports for top-level keys with default export wrapper', async () => {
      const out = dataToEsm({ a: 1, b: 'two' });
      expect(out).toContain('export var a = 1;');
      expect(out).toContain('export var b = "two";');
      expect(out).toContain('export default {');
      expect(out).toContain('a: a');
      expect(out).toContain('b: b');
    });

    await it('preferConst switches the declaration kind to const', async () => {
      const out = dataToEsm({ a: 1 }, { preferConst: true });
      expect(out).toContain('export const a = 1;');
      expect(out).not.toContain('export var a');
    });

    await it('compact: true strips whitespace + newlines', async () => {
      const out = dataToEsm({ a: 1, b: 2 }, { compact: true });
      expect(out).toBe('export var a=1;export var b=2;export default{a:a,b:b};');
    });

    await it('objectShorthand collapses {a: a} to {a}', async () => {
      const out = dataToEsm({ a: 1 }, { compact: true, objectShorthand: true });
      expect(out).toBe('export var a=1;export default{a};');
    });

    await it('quotes keys that are not legal identifiers (no named export)', async () => {
      const out = dataToEsm({ '1abc': 'x' }, { compact: true });
      // '1abc' is not a legal identifier so it gets serialized as a quoted
      // string property in the default export and no named export is emitted.
      expect(out).toBe('export default{"1abc":"x"};');
      expect(out).not.toContain('export var');
    });

    await it('top-level array yields a single default export', async () => {
      // Compact-mode primitives that start with one of [ { - / get no space
      // after `default` (the leading bracket disambiguates).
      const out = dataToEsm([1, 2, 3], { compact: true });
      expect(out).toBe('export default[1,2,3];');
    });

    await it('top-level primitives yield a single default export', async () => {
      // Strings/numbers/null/true must keep a space after `default` because
      // their leading char is not in the [ { - / set.
      expect(dataToEsm('hello', { compact: true })).toBe('export default "hello";');
      expect(dataToEsm(42, { compact: true })).toBe('export default 42;');
      expect(dataToEsm(null, { compact: true })).toBe('export default null;');
      expect(dataToEsm(true, { compact: true })).toBe('export default true;');
    });

    await it('namedExports: false collapses everything into the default export', async () => {
      // Object literal starts with `{` so compact mode skips the space.
      const out = dataToEsm({ a: 1, b: 2 }, { compact: true, namedExports: false });
      expect(out).toBe('export default{a:1,b:2};');
      expect(out).not.toContain('export var');
    });

    await it('serializes Date instances via new Date(<ms>)', async () => {
      const d = new Date(1700000000000);
      const out = dataToEsm({ ts: d }, { compact: true });
      expect(out).toContain('export var ts=new Date(1700000000000);');
    });

    await it('serializes RegExp via toString()', async () => {
      const out = dataToEsm({ re: /foo/gi }, { compact: true });
      expect(out).toContain('export var re=/foo/gi;');
    });

    await it('emits special numeric tokens (NaN, Infinity, -Infinity, -0)', async () => {
      const out = dataToEsm(
        { a: NaN, b: Infinity, c: -Infinity, d: -0 },
        { compact: true },
      );
      expect(out).toContain('a=NaN');
      expect(out).toContain('b=Infinity');
      expect(out).toContain('c=-Infinity');
      expect(out).toContain('d=-0');
    });

    await it('emits bigint with the n suffix', async () => {
      const out = dataToEsm({ big: 9007199254740993n }, { compact: true });
      expect(out).toContain('export var big=9007199254740993n;');
    });

    await it('serializes nested objects with the configured indent', async () => {
      const out = dataToEsm({ nested: { a: 1, b: 2 } }, { indent: '  ' });
      // Two-space indent, top-level export, nested braces follow same indent.
      expect(out).toContain('export var nested = {\n  a: 1,\n  b: 2\n};');
    });

    await it('escapes U+2028 and U+2029 in serialized strings', async () => {
      const out = dataToEsm({ s: 'a b c' }, { compact: true });
      // String must not contain the raw line separators.
      expect(out).not.toContain(' ');
      expect(out).not.toContain(' ');
      expect(out).toContain('\\u2028');
      expect(out).toContain('\\u2029');
    });
  });
};
