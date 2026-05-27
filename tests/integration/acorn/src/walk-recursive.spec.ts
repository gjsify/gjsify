// SPDX-License-Identifier: MIT
// Reference: acorn-walk upstream (recursive walker — `refs/` not vendored).
// Original: Copyright (c) Marijn Haverbeke and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { parse } from 'acorn';
import type { AnyNode } from 'acorn';
import { recursive, base, make } from 'acorn-walk';

const PARSE_OPTS = { ecmaVersion: 2024 as const, sourceType: 'module' as const };

// Utility: navigate acorn AST nodes without `any` — all nodes share the
// `type` discriminant and further fields vary by node kind.
function node(n: AnyNode | null | undefined): Record<string, AnyNode | AnyNode[] | string | number | boolean | null | undefined> {
    return n as unknown as Record<string, AnyNode | AnyNode[] | string | number | boolean | null | undefined>;
}

export default async () => {
    await describe('acorn-walk recursive walker', async () => {
        await it('recursive: visitors must explicitly continue the walk', async () => {
            const ast = parse('function f() { 1; 2; } 3;', PARSE_OPTS);
            const seen: string[] = [];
            recursive(ast, null, {
                Program(n, st, c) {
                    for (const stmt of node(n as AnyNode).body as AnyNode[]) c(stmt, st);
                },
                FunctionDeclaration(n) {
                    // intentionally do NOT recurse into the body
                    seen.push(`fn:${node(node(n as AnyNode).id as AnyNode).name}`);
                },
                ExpressionStatement(n, st, c) {
                    c(node(n as AnyNode).expression as AnyNode, st);
                },
                Literal(n) {
                    seen.push(`lit:${node(n as AnyNode).value}`);
                },
            });
            // function body NOT walked → only "3" outside the function recorded
            expect(seen).toStrictEqual(['fn:f', 'lit:3']);
        });

        await it('recursive: falls back to `base` for unhandled types', async () => {
            const ast = parse('a + (b * c)', PARSE_OPTS);
            const idents: string[] = [];
            recursive(ast, null, {
                Identifier(n) {
                    idents.push((n as Extract<AnyNode, { type: 'Identifier' }>).name);
                },
            });
            expect(idents.sort()).toStrictEqual(['a', 'b', 'c']);
        });

        await it('make() composes a custom walker on top of `base`', async () => {
            // Track function nesting depth via custom override.
            const ast = parse('function a() { function b() { function c() {} } }', PARSE_OPTS);
            let maxDepth = 0;
            const visitors = make<{ depth: number }>({
                FunctionDeclaration(n, st, c) {
                    st.depth++;
                    if (st.depth > maxDepth) maxDepth = st.depth;
                    c(node(n as AnyNode).body as AnyNode, st);
                    st.depth--;
                },
            });
            recursive(ast, { depth: 0 }, visitors);
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
            recursive(ast, methods, {
                Program(n, st, c) {
                    for (const s of node(n as AnyNode).body as AnyNode[]) c(s, st);
                },
                ClassDeclaration(n, st, c) {
                    c(node(n as AnyNode).body as AnyNode, st);
                },
                ClassBody(n, st, c) {
                    for (const m of node(n as AnyNode).body as AnyNode[]) c(m, st);
                },
                MethodDefinition(n, st: string[]) {
                    st.push(node(node(n as AnyNode).key as AnyNode).name as string);
                },
            });
            expect(methods).toStrictEqual(['constructor', 'inc', 'dec']);
        });
    });
};
