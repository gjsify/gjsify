// SPDX-License-Identifier: MIT
// Reference: acorn parser test corpus (`refs/` not vendored — acorn ships
// its acceptance tests as test262 fixtures upstream).
// Original: Copyright (c) Marijn Haverbeke and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { parse } from 'acorn';

export default async () => {
  await describe('acorn parse — strict / module sourceType', async () => {

    await it('module sourceType implies strict — `with` is rejected', async () => {
      expect(() => parse('with (x) {}', { ecmaVersion: 2024, sourceType: 'module' })).toThrow();
    });

    await it('module sourceType allows top-level await', async () => {
      const ast = parse('await fetch("/x");', {
        ecmaVersion: 2024,
        sourceType: 'module',
      }) as any;
      const stmt = ast.body[0];
      expect(stmt.type).toBe('ExpressionStatement');
      expect(stmt.expression.type).toBe('AwaitExpression');
    });

    await it('script sourceType rejects top-level await', async () => {
      expect(() => parse('await fetch("/x");', {
        ecmaVersion: 2024,
        sourceType: 'script',
      })).toThrow();
    });

    await it('explicit "use strict" directive forbids octal literals', async () => {
      expect(() => parse('"use strict"; const a = 0123;', {
        ecmaVersion: 2024,
        sourceType: 'script',
      })).toThrow();
    });

    await it('non-strict script accepts octal literals', async () => {
      const ast = parse('const a = 0123;', {
        ecmaVersion: 2024,
        sourceType: 'script',
      }) as any;
      expect(ast.body[0].declarations[0].init.value).toBe(83);
    });

    await it('module sourceType: duplicate exports are rejected', async () => {
      expect(() => parse(
        'export const a = 1; export const a = 2;',
        { ecmaVersion: 2024, sourceType: 'module' },
      )).toThrow();
    });

    await it('locations: 1-based line, 0-based column', async () => {
      const ast = parse('let x = 1;\nlet y = 2;', {
        ecmaVersion: 2024,
        sourceType: 'module',
        locations: true,
      }) as any;
      const first = ast.body[0];
      expect(first.loc.start.line).toBe(1);
      expect(first.loc.start.column).toBe(0);
      const second = ast.body[1];
      expect(second.loc.start.line).toBe(2);
      expect(second.loc.start.column).toBe(0);
    });

    await it('export-from with `as` re-export', async () => {
      const ast = parse('export { x as y } from "mod";', {
        ecmaVersion: 2024,
        sourceType: 'module',
      }) as any;
      const exp = ast.body[0];
      expect(exp.type).toBe('ExportNamedDeclaration');
      expect(exp.source.value).toBe('mod');
      expect(exp.specifiers[0].local.name).toBe('x');
      expect(exp.specifiers[0].exported.name).toBe('y');
    });

    await it('dynamic `import()` is parsed as ImportExpression', async () => {
      const ast = parse('const m = await import("./x.js");', {
        ecmaVersion: 2024,
        sourceType: 'module',
      }) as any;
      const init = ast.body[0].declarations[0].init;
      expect(init.type).toBe('AwaitExpression');
      expect(init.argument.type).toBe('ImportExpression');
      expect(init.argument.source.value).toBe('./x.js');
    });

    await it('import attributes (with) are accepted at ecmaVersion latest', async () => {
      const ast = parse('import data from "./d.json" with { type: "json" };', {
        ecmaVersion: 'latest',
        sourceType: 'module',
      }) as any;
      const imp = ast.body[0];
      expect(imp.type).toBe('ImportDeclaration');
      expect(Array.isArray(imp.attributes)).toBe(true);
      expect(imp.attributes[0].key.name).toBe('type');
      expect(imp.attributes[0].value.value).toBe('json');
    });

  });
};
