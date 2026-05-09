// SPDX-License-Identifier: MIT
// Reference: acorn parser error reporting (`refs/` not vendored).
// Original: Copyright (c) Marijn Haverbeke and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { parse } from 'acorn';

const PARSE_OPTS = { ecmaVersion: 2024 as const, sourceType: 'module' as const };

function captureParseError(src: string, opts: any = PARSE_OPTS): any {
  try {
    parse(src, opts);
  } catch (err) {
    return err;
  }
  throw new Error('expected parse to throw');
}

export default async () => {
  await describe('acorn parse — error position info', async () => {

    await it('SyntaxError carries line / column / pos / raisedAt', async () => {
      const err = captureParseError('let x = ;');
      // acorn raises SyntaxError-derived errors
      expect(err instanceof SyntaxError).toBe(true);
      expect(typeof err.pos).toBe('number');
      expect(typeof err.loc).toBe('object');
      expect(typeof err.loc.line).toBe('number');
      expect(typeof err.loc.column).toBe('number');
      expect(err.loc.line).toBe(1);
      expect(err.loc.column).toBeGreaterThan(0);
    });

    await it('error message contains the (line:col) suffix', async () => {
      const err = captureParseError('let x = ;');
      expect(typeof err.message).toBe('string');
      expect(err.message.length).toBeGreaterThan(0);
      // acorn appends "(line:column)" to its messages
      expect(/\(\d+:\d+\)/.test(err.message)).toBe(true);
    });

    await it('multi-line source: error reports correct line', async () => {
      const src = 'const a = 1;\nconst b = 2;\nconst c = ;';
      const err = captureParseError(src);
      expect(err.loc.line).toBe(3);
    });

    await it('unterminated string literal reports the start column', async () => {
      const err = captureParseError('const s = "hello;');
      expect(err instanceof SyntaxError).toBe(true);
      expect(err.loc.line).toBe(1);
      expect(typeof err.loc.column).toBe('number');
    });

    await it('reserved word misuse in module mode', async () => {
      const err = captureParseError('const await = 1;');
      expect(err instanceof SyntaxError).toBe(true);
      expect(typeof err.loc.column).toBe('number');
    });

    await it('throws a plain Error subclass with stack trace', async () => {
      const err = captureParseError('}}}');
      expect(err instanceof Error).toBe(true);
      expect(typeof err.stack).toBe('string');
      expect((err.stack as string).length).toBeGreaterThan(0);
    });

  });
};
