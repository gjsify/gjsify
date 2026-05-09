// SPDX-License-Identifier: MIT
// Reference: acorn-walk upstream (recursive walker — `refs/` not vendored).
// Original: Copyright (c) Marijn Haverbeke and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { parse } from 'acorn';
import { recursive, base, make } from 'acorn-walk';

const PARSE_OPTS = { ecmaVersion: 2024 as const, sourceType: 'module' as const };

export default async () => {
  await describe('acorn-walk recursive walker', async () => {

    await it('recursive: visitors must explicitly continue the walk', async () => {
      const ast = parse('function f() { 1; 2; } 3;', PARSE_OPTS);
      const seen: string[] = [];
      recursive(ast as any, null, {
        Program(node, st, c) {
          for (const stmt of (node as any).body) c(stmt, st);
        },
        FunctionDeclaration(node) {
          // intentionally do NOT recurse into the body
          seen.push(`fn:${(node as any).id.name}`);
        },
        ExpressionStatement(node, _st, c) {
          c((node as any).expression, _st);
        },
        Literal(node) {
          seen.push(`lit:${(node as any).value}`);
        },
      });
      // function body NOT walked → only "3" outside the function recorded
      expect(seen).toStrictEqual(['fn:f', 'lit:3']);
    });

    await it('recursive: falls back to `base` for unhandled types', async () => {
      const ast = parse('a + (b * c)', PARSE_OPTS);
      const idents: string[] = [];
      recursive(ast as any, null, {
        Identifier(node) { idents.push((node as any).name); },
      });
      expect(idents.sort()).toStrictEqual(['a', 'b', 'c']);
    });

    await it('make() composes a custom walker on top of `base`', async () => {
      // Track function nesting depth via custom override.
      const ast = parse('function a() { function b() { function c() {} } }', PARSE_OPTS);
      let maxDepth = 0;
      const visitors = make<{ depth: number }>({
        FunctionDeclaration(node, st, c) {
          st.depth++;
          if (st.depth > maxDepth) maxDepth = st.depth;
          c((node as any).body, st);
          st.depth--;
        },
      });
      recursive(ast as any, { depth: 0 }, visitors);
      expect(maxDepth).toBe(3);
    });

    await it('base contains the documented default walkers', async () => {
      expect(typeof base.Program).toBe('function');
      expect(typeof base.BlockStatement).toBe('function');
      expect(typeof base.Expression).toBe('function');
      expect(typeof base.Statement).toBe('function');
    });

    await it('recursive: shared mutable state collects results', async () => {
      const ast = parse(
        `class Box {
          constructor(x) { this.x = x; }
          inc() { this.x++; }
          dec() { this.x--; }
        }`,
        PARSE_OPTS,
      );
      const methods: string[] = [];
      recursive(ast as any, methods, {
        Program(node, st, c) { for (const s of (node as any).body) c(s, st); },
        ClassDeclaration(node, st, c) { c((node as any).body, st); },
        ClassBody(node, st, c) { for (const m of (node as any).body) c(m, st); },
        MethodDefinition(node, st: string[]) {
          st.push((node as any).key.name);
        },
      });
      expect(methods).toStrictEqual(['constructor', 'inc', 'dec']);
    });

  });
};
