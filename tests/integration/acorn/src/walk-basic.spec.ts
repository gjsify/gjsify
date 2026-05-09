// SPDX-License-Identifier: MIT
// Reference: acorn-walk upstream (`refs/` not vendored — acorn-walk's tests
// live in test/run.js / test/tests-walk.js).
// Original: Copyright (c) Marijn Haverbeke and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { parse } from 'acorn';
import { simple, ancestor, full, findNodeAt, findNodeAround } from 'acorn-walk';

const PARSE_OPTS = { ecmaVersion: 2024 as const, sourceType: 'module' as const };

export default async () => {
  await describe('acorn-walk simple/ancestor/full', async () => {

    await it('simple: counts node visits per type', async () => {
      const ast = parse(
        'function f(a, b) { return a + b; } f(1, 2); const x = 3;',
        PARSE_OPTS,
      );
      const counts: Record<string, number> = {};
      const idNames: string[] = [];
      simple(ast as any, {
        Identifier(node) { counts.Identifier = (counts.Identifier || 0) + 1; idNames.push((node as any).name); },
        Literal(_node) { counts.Literal = (counts.Literal || 0) + 1; },
        FunctionDeclaration(_node) { counts.FunctionDeclaration = (counts.FunctionDeclaration || 0) + 1; },
      });
      // The default `base.Identifier = ignore` walker only re-dispatches as
      // type "Identifier" from a few positions (function params, call callees).
      // Verify the visitor at least fires and observes the expected names.
      expect(counts.Identifier).toBeGreaterThan(0);
      expect(idNames).toContain('a');
      expect(idNames).toContain('b');
      expect(idNames).toContain('f');
      // Literals fire for each numeric literal.
      expect(counts.Literal).toBe(3);
      expect(counts.FunctionDeclaration).toBe(1);
    });

    await it('simple: state is threaded through visitor calls', async () => {
      const ast = parse('1; 2; 3;', PARSE_OPTS);
      const state = { sum: 0 };
      simple(ast as any, {
        Literal(node, st: { sum: number }) { st.sum += node.value as number; },
      }, undefined, state);
      expect(state.sum).toBe(6);
    });

    await it('ancestor: provides ancestor chain', async () => {
      const ast = parse('function outer() { function inner() { return 1; } }', PARSE_OPTS);
      let innerAncestors: string[] = [];
      ancestor(ast as any, {
        FunctionDeclaration(node, _st, ancestors: any[]) {
          if ((node as any).id?.name === 'inner') {
            innerAncestors = ancestors.map((a: any) => a.type);
          }
        },
      });
      // chain ends at the visited node itself
      expect(innerAncestors[innerAncestors.length - 1]).toBe('FunctionDeclaration');
      expect(innerAncestors).toContain('Program');
      expect(innerAncestors.filter((t) => t === 'FunctionDeclaration').length).toBe(2);
    });

    await it('full: visits every node and reports its type', async () => {
      const ast = parse('a + b', PARSE_OPTS);
      const types: string[] = [];
      full(ast as any, (_node, _st, type) => {
        types.push(type);
      });
      expect(types).toContain('Program');
      expect(types).toContain('ExpressionStatement');
      expect(types).toContain('BinaryExpression');
      // 2 identifiers
      expect(types.filter((t) => t === 'Identifier').length).toBe(2);
    });

    await it('findNodeAt locates a node at a given offset', async () => {
      const src = 'const xx = 42;';
      const ast = parse(src, PARSE_OPTS);
      // Identifier nodes have `base.Identifier = ignore`, so type-string
      // filtering against "Identifier" doesn't dispatch — use a predicate
      // (or omit the filter) to find them by range.
      const found = findNodeAt(ast as any, src.indexOf('xx'), src.indexOf('xx') + 2);
      expect(found).toBeDefined();
      expect((found!.node as any).type).toBe('Identifier');
      expect((found!.node as any).name).toBe('xx');
    });

    await it('findNodeAround finds the innermost matching node', async () => {
      const src = 'function f() { return 1 + 2; }';
      const ast = parse(src, PARSE_OPTS);
      const offset = src.indexOf('1');
      const found = findNodeAround(ast as any, offset, 'BinaryExpression');
      expect(found).toBeDefined();
      expect((found!.node as any).type).toBe('BinaryExpression');
      expect((found!.node as any).operator).toBe('+');
    });

  });
};
