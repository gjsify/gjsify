// SPDX-License-Identifier: MIT
// Reference: acorn parser test corpus (`refs/` not vendored — acorn ships
// its acceptance tests as test262 fixtures upstream).
// Original: Copyright (c) Marijn Haverbeke and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { parse } from 'acorn';
import type { AnyNode, Program } from 'acorn';

// Utility: navigate acorn AST nodes without `any` — all nodes share the
// `type` discriminant and further fields vary by node kind.
function node(n: AnyNode | Program | null | undefined): Record<string, AnyNode | AnyNode[] | string | number | boolean | null | undefined> {
    return n as unknown as Record<string, AnyNode | AnyNode[] | string | number | boolean | null | undefined>;
}

export default async () => {
    await describe('acorn parse — strict / module sourceType', async () => {
        await it('module sourceType implies strict — `with` is rejected', async () => {
            expect(() => parse('with (x) {}', { ecmaVersion: 2024, sourceType: 'module' })).toThrow();
        });

        await it('module sourceType allows top-level await', async () => {
            const ast: Program = parse('await fetch("/x");', {
                ecmaVersion: 2024,
                sourceType: 'module',
            });
            const stmt = node(ast.body[0] as AnyNode);
            expect(ast.body[0].type).toBe('ExpressionStatement');
            expect(node(stmt.expression as AnyNode).type).toBe('AwaitExpression');
        });

        await it('script sourceType rejects top-level await', async () => {
            expect(() =>
                parse('await fetch("/x");', {
                    ecmaVersion: 2024,
                    sourceType: 'script',
                }),
            ).toThrow();
        });

        await it('explicit "use strict" directive forbids octal literals', async () => {
            expect(() =>
                parse('"use strict"; const a = 0123;', {
                    ecmaVersion: 2024,
                    sourceType: 'script',
                }),
            ).toThrow();
        });

        await it('non-strict script accepts octal literals', async () => {
            const ast: Program = parse('const a = 0123;', {
                ecmaVersion: 2024,
                sourceType: 'script',
            });
            const declarations = node(ast.body[0] as AnyNode).declarations as AnyNode[];
            expect(node(node(declarations[0]).init as AnyNode).value).toBe(83);
        });

        await it('module sourceType: duplicate exports are rejected', async () => {
            expect(() =>
                parse('export const a = 1; export const a = 2;', { ecmaVersion: 2024, sourceType: 'module' }),
            ).toThrow();
        });

        await it('locations: 1-based line, 0-based column', async () => {
            const ast: Program = parse('let x = 1;\nlet y = 2;', {
                ecmaVersion: 2024,
                sourceType: 'module',
                locations: true,
            });
            const first = node(ast.body[0] as AnyNode);
            const firstLoc = node(first.loc as AnyNode);
            const firstStart = node(firstLoc.start as AnyNode);
            expect(firstStart.line).toBe(1);
            expect(firstStart.column).toBe(0);
            const second = node(ast.body[1] as AnyNode);
            const secondLoc = node(second.loc as AnyNode);
            const secondStart = node(secondLoc.start as AnyNode);
            expect(secondStart.line).toBe(2);
            expect(secondStart.column).toBe(0);
        });

        await it('export-from with `as` re-export', async () => {
            const ast: Program = parse('export { x as y } from "mod";', {
                ecmaVersion: 2024,
                sourceType: 'module',
            });
            const exp = node(ast.body[0] as AnyNode);
            expect(ast.body[0].type).toBe('ExportNamedDeclaration');
            expect(node(exp.source as AnyNode).value).toBe('mod');
            const specifiers = exp.specifiers as AnyNode[];
            expect(node(node(specifiers[0]).local as AnyNode).name).toBe('x');
            expect(node(node(specifiers[0]).exported as AnyNode).name).toBe('y');
        });

        await it('dynamic `import()` is parsed as ImportExpression', async () => {
            const ast: Program = parse('const m = await import("./x.js");', {
                ecmaVersion: 2024,
                sourceType: 'module',
            });
            const declarations = node(ast.body[0] as AnyNode).declarations as AnyNode[];
            const init = node(node(declarations[0]).init as AnyNode);
            expect((node(declarations[0]).init as AnyNode).type).toBe('AwaitExpression');
            expect(node(init.argument as AnyNode).type).toBe('ImportExpression');
            expect(node(node(init.argument as AnyNode).source as AnyNode).value).toBe('./x.js');
        });

        await it('import attributes (with) are accepted at ecmaVersion latest', async () => {
            const ast: Program = parse('import data from "./d.json" with { type: "json" };', {
                ecmaVersion: 'latest',
                sourceType: 'module',
            });
            const imp = node(ast.body[0] as AnyNode);
            expect(ast.body[0].type).toBe('ImportDeclaration');
            const attributes = imp.attributes as AnyNode[];
            expect(Array.isArray(attributes)).toBe(true);
            expect(node(node(attributes[0]).key as AnyNode).name).toBe('type');
            expect(node(node(attributes[0]).value as AnyNode).value).toBe('json');
        });
    });
};
