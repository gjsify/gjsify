// SPDX-License-Identifier: MIT
// Reference: acorn upstream test corpus (refs not vendored — acorn maintains
// its tests as test262-style fixtures; this port exercises representative
// ES2024 syntax through the public `parse` API).
// Original: Copyright (c) Marijn Haverbeke and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { parse, parseExpressionAt, tokenizer, Parser } from 'acorn';

const PARSE_OPTS = { ecmaVersion: 2024 as const, sourceType: 'module' as const };

export default async () => {
  await describe('acorn parse — ES2024 surface', async () => {

    await it('parses an empty program', async () => {
      const ast = parse('', PARSE_OPTS) as any;
      expect(ast.type).toBe('Program');
      expect(ast.body).toStrictEqual([]);
      expect(ast.sourceType).toBe('module');
    });

    await it('parses a numeric literal expression statement', async () => {
      const ast = parse('42;', PARSE_OPTS) as any;
      expect(ast.body.length).toBe(1);
      expect(ast.body[0].type).toBe('ExpressionStatement');
      expect(ast.body[0].expression.type).toBe('Literal');
      expect(ast.body[0].expression.value).toBe(42);
    });

    await it('parses an arrow function with destructured params', async () => {
      const ast = parse('const f = ({ a, b = 1 }, [c, ...rest]) => a + b + c;', PARSE_OPTS) as any;
      const decl = ast.body[0];
      expect(decl.type).toBe('VariableDeclaration');
      expect(decl.kind).toBe('const');
      const arrow = decl.declarations[0].init;
      expect(arrow.type).toBe('ArrowFunctionExpression');
      expect(arrow.params.length).toBe(2);
      expect(arrow.params[0].type).toBe('ObjectPattern');
      expect(arrow.params[1].type).toBe('ArrayPattern');
      const restEl = arrow.params[1].elements[1];
      expect(restEl.type).toBe('RestElement');
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
      const ast = parse(src, PARSE_OPTS) as any;
      const cls = ast.body[0];
      expect(cls.type).toBe('ClassDeclaration');
      expect(cls.id.name).toBe('Box');
      const body = cls.body.body;
      expect(body.length).toBe(5);
      const staticField = body[0];
      expect(staticField.type).toBe('PropertyDefinition');
      expect(staticField.static).toBe(true);
      expect(staticField.key.type).toBe('PrivateIdentifier');
      expect(staticField.key.name).toBe('count');
      const getter = body[3];
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
      const ast = parse(src, PARSE_OPTS) as any;
      const fn = ast.body[0];
      expect(fn.type).toBe('FunctionDeclaration');
      expect(fn.async).toBe(true);
      const forStmt = fn.body.body[1];
      expect(forStmt.type).toBe('ForOfStatement');
      expect(forStmt.await).toBe(true);
    });

    await it('parses optional chaining, nullish coalescing and logical assignment', async () => {
      const src = `const v = (x?.y?.z ?? defaults.value); a ??= b; c ||= d; e &&= f;`;
      const ast = parse(src, PARSE_OPTS) as any;
      const init = ast.body[0].declarations[0].init;
      expect(init.type).toBe('LogicalExpression');
      expect(init.operator).toBe('??');
      const chain = init.left;
      expect(chain.type).toBe('ChainExpression');
      const opAssign = ast.body[1].expression;
      expect(opAssign.type).toBe('AssignmentExpression');
      expect(opAssign.operator).toBe('??=');
      expect(ast.body[2].expression.operator).toBe('||=');
      expect(ast.body[3].expression.operator).toBe('&&=');
    });

    await it('parses tagged template literals', async () => {
      const ast = parse('html`<p>${name}</p>`;', PARSE_OPTS) as any;
      const expr = ast.body[0].expression;
      expect(expr.type).toBe('TaggedTemplateExpression');
      expect(expr.tag.name).toBe('html');
      expect(expr.quasi.type).toBe('TemplateLiteral');
      expect(expr.quasi.quasis.length).toBe(2);
      expect(expr.quasi.expressions.length).toBe(1);
    });

    await it('parses an import declaration with named + default specifiers', async () => {
      const ast = parse('import def, { a, b as c } from "mod";', PARSE_OPTS) as any;
      const imp = ast.body[0];
      expect(imp.type).toBe('ImportDeclaration');
      expect(imp.source.value).toBe('mod');
      expect(imp.specifiers.length).toBe(3);
      expect(imp.specifiers[0].type).toBe('ImportDefaultSpecifier');
      expect(imp.specifiers[1].type).toBe('ImportSpecifier');
      expect(imp.specifiers[1].imported.name).toBe('a');
      expect(imp.specifiers[2].imported.name).toBe('b');
      expect(imp.specifiers[2].local.name).toBe('c');
    });

    await it('parseExpressionAt extracts an expression from an offset', async () => {
      const src = '/* lead */ 1 + 2 * 3';
      const expr = parseExpressionAt(src, 11, PARSE_OPTS) as any;
      expect(expr.type).toBe('BinaryExpression');
      expect(expr.operator).toBe('+');
      expect(expr.right.type).toBe('BinaryExpression');
      expect(expr.right.operator).toBe('*');
    });

    await it('Parser.parse static entry parses programs', async () => {
      const ast = Parser.parse('const x = 1;', PARSE_OPTS) as any;
      expect(ast.type).toBe('Program');
      expect(ast.body[0].declarations[0].id.name).toBe('x');
    });

    await it('tokenizer iterates over tokens', async () => {
      const tokens: any[] = [];
      for (const tok of tokenizer('let a = 1', PARSE_OPTS) as any) {
        tokens.push(tok);
      }
      // The iterator yields all real tokens but stops before EOF.
      expect(tokens.length).toBe(4);
      expect(tokens[0].value).toBe('let');
      expect(tokens[1].value).toBe('a');
      expect(tokens[2].value).toBe('=');
      expect(tokens[3].value).toBe(1);
    });

  });
};
