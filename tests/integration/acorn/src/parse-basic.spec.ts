// SPDX-License-Identifier: MIT
// Reference: acorn upstream test corpus (refs not vendored — acorn maintains
// its tests as test262-style fixtures; this port exercises representative
// ES2024 syntax through the public `parse` API).
// Original: Copyright (c) Marijn Haverbeke and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { parse, parseExpressionAt, tokenizer, Parser } from 'acorn';
import type { Program, AnyNode } from 'acorn';

const PARSE_OPTS = { ecmaVersion: 2024 as const, sourceType: 'module' as const };

// Utility: navigate acorn AST nodes without `any` — all nodes share the
// `type` discriminant and further fields vary by node kind.
// Using `AnyNode` (the union of all acorn node types) for intermediate values.
function node(
    n: AnyNode | Program | null | undefined,
): Record<string, AnyNode | AnyNode[] | string | number | boolean | null | undefined> {
    return n as unknown as Record<string, AnyNode | AnyNode[] | string | number | boolean | null | undefined>;
}

export default async () => {
    await describe('acorn parse — ES2024 surface', async () => {
        await it('parses an empty program', async () => {
            const ast: Program = parse('', PARSE_OPTS);
            expect(ast.type).toBe('Program');
            expect(ast.body).toStrictEqual([]);
            expect(ast.sourceType).toBe('module');
        });

        await it('parses a numeric literal expression statement', async () => {
            const ast: Program = parse('42;', PARSE_OPTS);
            expect(ast.body.length).toBe(1);
            expect(ast.body[0].type).toBe('ExpressionStatement');
            expect(node(ast.body[0] as AnyNode).expression).toBeTruthy();
            const exprStmt = node(ast.body[0] as AnyNode).expression as AnyNode;
            expect(exprStmt.type).toBe('Literal');
            expect(node(exprStmt).value).toBe(42);
        });

        await it('parses an arrow function with destructured params', async () => {
            const ast: Program = parse('const f = ({ a, b = 1 }, [c, ...rest]) => a + b + c;', PARSE_OPTS);
            const decl = node(ast.body[0] as AnyNode);
            expect(ast.body[0].type).toBe('VariableDeclaration');
            expect(decl.kind).toBe('const');
            const declarations = decl.declarations as AnyNode[];
            const arrow = node(node(declarations[0]).init as AnyNode);
            expect((node(declarations[0]).init as AnyNode).type).toBe('ArrowFunctionExpression');
            const params = arrow.params as AnyNode[];
            expect(params.length).toBe(2);
            expect(params[0].type).toBe('ObjectPattern');
            expect(params[1].type).toBe('ArrayPattern');
            const elements = node(params[1]).elements as AnyNode[];
            expect(elements[1].type).toBe('RestElement');
        });

        await it('parses a class with static, private and getter members', async () => {
            const src = `
        class Box {
          static #count = 0;
          #value;
          constructor(v) { this.#value = v; Box.#count++; }
          get value() { return this.#value; }
          static get count() { return Box.#count; }
        }
      `;
            const ast: Program = parse(src, PARSE_OPTS);
            const cls = node(ast.body[0] as AnyNode);
            expect(ast.body[0].type).toBe('ClassDeclaration');
            expect(node(cls.id as AnyNode).name).toBe('Box');
            const body = node(cls.body as AnyNode).body as AnyNode[];
            expect(body.length).toBe(5);
            const staticField = node(body[0]);
            expect(staticField.type).toBe('PropertyDefinition');
            expect(staticField.static).toBe(true);
            expect(node(staticField.key as AnyNode).type).toBe('PrivateIdentifier');
            expect(node(staticField.key as AnyNode).name).toBe('count');
            const getter = node(body[3]);
            expect(getter.type).toBe('MethodDefinition');
            expect(getter.kind).toBe('get');
        });

        await it('parses async/await + for-await-of', async () => {
            const src = `
        async function consume(stream) {
          let total = 0;
          for await (const chunk of stream) total += chunk.length;
          return total;
        }
      `;
            const ast: Program = parse(src, PARSE_OPTS);
            const fn = node(ast.body[0] as AnyNode);
            expect(ast.body[0].type).toBe('FunctionDeclaration');
            expect(fn.async).toBe(true);
            const fnBody = node(fn.body as AnyNode).body as AnyNode[];
            const forStmt = node(fnBody[1]);
            expect(forStmt.type).toBe('ForOfStatement');
            expect(forStmt.await).toBe(true);
        });

        await it('parses optional chaining, nullish coalescing and logical assignment', async () => {
            const src = `const v = (x?.y?.z ?? defaults.value); a ??= b; c ||= d; e &&= f;`;
            const ast: Program = parse(src, PARSE_OPTS);
            const declarations = node(ast.body[0] as AnyNode).declarations as AnyNode[];
            const init = node(node(declarations[0]).init as AnyNode);
            expect((node(declarations[0]).init as AnyNode).type).toBe('LogicalExpression');
            expect(init.operator).toBe('??');
            const chain = node(init.left as AnyNode);
            expect(chain.type).toBe('ChainExpression');
            const opAssign = node(node(ast.body[1] as AnyNode).expression as AnyNode);
            expect(opAssign.type).toBe('AssignmentExpression');
            expect(opAssign.operator).toBe('??=');
            expect(node(node(ast.body[2] as AnyNode).expression as AnyNode).operator).toBe('||=');
            expect(node(node(ast.body[3] as AnyNode).expression as AnyNode).operator).toBe('&&=');
        });

        await it('parses tagged template literals', async () => {
            const ast: Program = parse('html`<p>${name}</p>`;', PARSE_OPTS);
            const expr = node(node(ast.body[0] as AnyNode).expression as AnyNode);
            expect((node(ast.body[0] as AnyNode).expression as AnyNode).type).toBe('TaggedTemplateExpression');
            expect(node(expr.tag as AnyNode).name).toBe('html');
            const quasi = node(expr.quasi as AnyNode);
            expect((expr.quasi as AnyNode).type).toBe('TemplateLiteral');
            expect((quasi.quasis as AnyNode[]).length).toBe(2);
            expect((quasi.expressions as AnyNode[]).length).toBe(1);
        });

        await it('parses an import declaration with named + default specifiers', async () => {
            const ast: Program = parse('import def, { a, b as c } from "mod";', PARSE_OPTS);
            const imp = node(ast.body[0] as AnyNode);
            expect(ast.body[0].type).toBe('ImportDeclaration');
            expect(node(imp.source as AnyNode).value).toBe('mod');
            const specifiers = imp.specifiers as AnyNode[];
            expect(specifiers.length).toBe(3);
            expect(specifiers[0].type).toBe('ImportDefaultSpecifier');
            expect(specifiers[1].type).toBe('ImportSpecifier');
            expect(node(node(specifiers[1]).imported as AnyNode).name).toBe('a');
            expect(node(node(specifiers[2]).imported as AnyNode).name).toBe('b');
            expect(node(node(specifiers[2]).local as AnyNode).name).toBe('c');
        });

        await it('parseExpressionAt extracts an expression from an offset', async () => {
            const src = '/* lead */ 1 + 2 * 3';
            const expr = node(parseExpressionAt(src, 11, PARSE_OPTS));
            expect(parseExpressionAt(src, 11, PARSE_OPTS).type).toBe('BinaryExpression');
            expect(expr.operator).toBe('+');
            expect(node(expr.right as AnyNode).type).toBe('BinaryExpression');
            expect(node(expr.right as AnyNode).operator).toBe('*');
        });

        await it('Parser.parse static entry parses programs', async () => {
            const ast: Program = Parser.parse('const x = 1;', PARSE_OPTS);
            expect(ast.type).toBe('Program');
            const declarations = node(ast.body[0] as AnyNode).declarations as AnyNode[];
            expect(node(node(declarations[0]).id as AnyNode).name).toBe('x');
        });

        await it('tokenizer iterates over tokens', async () => {
            const tokens: AnyNode[] = [];
            for (const tok of tokenizer('let a = 1', PARSE_OPTS)) {
                tokens.push(tok as unknown as AnyNode);
            }
            // The iterator yields all real tokens but stops before EOF.
            expect(tokens.length).toBe(4);
            expect(node(tokens[0]).value).toBe('let');
            expect(node(tokens[1]).value).toBe('a');
            expect(node(tokens[2]).value).toBe('=');
            expect(node(tokens[3]).value).toBe(1);
        });
    });
};
