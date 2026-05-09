// SPDX-License-Identifier: MIT
// Reference: @rollup/pluginutils public API.
// Original: Copyright (c) 2019 RollupJS Plugin Contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Exercises attachScopes() — walks an acorn AST via estree-walker, attaches
// Scope objects to nodes that introduce a new lexical scope. Confirms scope
// chain (block / function / catch / for) and Scope.contains() lookup.
//
// Pillars: pure JS, depends on the acorn parser already validated by the
// `acorn` integration suite.

import { describe, it, expect } from '@gjsify/unit';
import { parse } from 'acorn';
import { attachScopes, type AttachedScope } from '@rollup/pluginutils';

const PARSE_OPTS = { ecmaVersion: 2024 as const, sourceType: 'module' as const };

function parseModule(src: string): any {
  return parse(src, PARSE_OPTS);
}

export default async () => {
  await describe('@rollup/pluginutils attachScopes', async () => {

    await it('returns a root Scope and registers top-level vars', async () => {
      const ast = parseModule('var foo = 1; const bar = 2; let baz = 3;');
      const root = attachScopes(ast, 'scope');
      expect(typeof root.contains).toBe('function');
      expect(root.contains('foo')).toBe(true);
      expect(root.contains('bar')).toBe(true);
      expect(root.contains('baz')).toBe(true);
      expect(root.contains('absent')).toBe(false);
    });

    await it('records FunctionDeclaration + ClassDeclaration names', async () => {
      const ast = parseModule(`
        function foo() {}
        class Bar {}
      `);
      const root = attachScopes(ast, 'scope');
      expect(root.contains('foo')).toBe(true);
      expect(root.contains('Bar')).toBe(true);
    });

    await it('attaches a child scope to a FunctionDeclaration with params', async () => {
      const ast = parseModule(`function add(a, b) { return a + b; }`);
      attachScopes(ast, 'scope');
      const fnNode = ast.body[0];
      const fnScope = (fnNode as any).scope as AttachedScope;
      expect(fnScope).toBeDefined();
      expect(fnScope.contains('a')).toBe(true);
      expect(fnScope.contains('b')).toBe(true);
      // Function name is in the parent (root) scope, reachable via contains().
      expect(fnScope.contains('add')).toBe(true);
    });

    await it('block-scopes let/const but not var', async () => {
      const ast = parseModule(`{ var v = 1; let l = 2; const c = 3; }`);
      const root = attachScopes(ast, 'scope');
      const blockNode = ast.body[0];
      const blockScope = (blockNode as any).scope as AttachedScope;
      expect(blockScope).toBeDefined();
      // var hoists out to the parent scope.
      expect(root.contains('v')).toBe(true);
      // let/const stay in the block scope.
      expect(blockScope.contains('l')).toBe(true);
      expect(blockScope.contains('c')).toBe(true);
      // l/c should NOT exist in the root scope (block-scoped).
      expect(root.declarations.l).toBeFalsy();
      expect(root.declarations.c).toBeFalsy();
    });

    await it('creates a new scope for catch clauses with the param bound', async () => {
      const ast = parseModule(`try {} catch (err) { let inner = 1; }`);
      attachScopes(ast, 'scope');
      const tryStmt: any = ast.body[0];
      const catchNode: any = tryStmt.handler;
      const catchScope = catchNode.scope as AttachedScope;
      expect(catchScope).toBeDefined();
      expect(catchScope.contains('err')).toBe(true);
    });

    await it('creates a fresh scope for FunctionExpression name', async () => {
      const ast = parseModule(`const f = function namedFn(a) { return a; };`);
      attachScopes(ast, 'scope');
      const decl: any = ast.body[0];
      const fn: any = decl.declarations[0].init;
      const fnScope = fn.scope as AttachedScope;
      expect(fnScope).toBeDefined();
      expect(fnScope.contains('namedFn')).toBe(true);
      expect(fnScope.contains('a')).toBe(true);
    });

    await it('honours a custom propertyName', async () => {
      const ast = parseModule(`function f(){}`);
      attachScopes(ast, '__myScope');
      const fn: any = ast.body[0];
      expect(fn.__myScope).toBeDefined();
      expect(fn.scope).toBeUndefined();
    });

    await it('parent scope lookups bubble up to ancestors', async () => {
      const ast = parseModule(`
        const top = 1;
        function outer() {
          function inner() {
            return top;
          }
        }
      `);
      attachScopes(ast, 'scope');
      const outerFn: any = ast.body[1];
      const innerFn: any = outerFn.body.body[0];
      const innerScope: AttachedScope = innerFn.scope;
      expect(innerScope.contains('top')).toBe(true);
    });

    await it('creates a fresh scope for for-loop initializers', async () => {
      const ast = parseModule(`for (let i = 0; i < 10; i++) { let j = i; }`);
      attachScopes(ast, 'scope');
      const forStmt: any = ast.body[0];
      const forScope: AttachedScope = forStmt.scope;
      expect(forScope).toBeDefined();
      // The loop body's `j` is in a nested block scope under the for-scope.
    });
  });
};
