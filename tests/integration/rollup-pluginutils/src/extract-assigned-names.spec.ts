// SPDX-License-Identifier: MIT
// Reference: @rollup/pluginutils public API.
// Original: Copyright (c) 2019 RollupJS Plugin Contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Exercises extractAssignedNames() — given an acorn pattern node (Identifier,
// ObjectPattern, ArrayPattern, AssignmentPattern, RestElement,
// MemberExpression), returns the list of bindings that pattern introduces.
// Pure JS — depends on the acorn parser already validated by the `acorn`
// integration suite.

import { describe, it, expect } from '@gjsify/unit';
import { parse } from 'acorn';
import { extractAssignedNames } from '@rollup/pluginutils';

const PARSE_OPTS = { ecmaVersion: 2024 as const, sourceType: 'module' as const };

// Helper: parse `let <pattern> = ...;` and return the pattern node.
function patternFromLet(src: string): any {
  const ast: any = parse(`let ${src} = 0;`, PARSE_OPTS);
  return ast.body[0].declarations[0].id;
}

export default async () => {
  await describe('@rollup/pluginutils extractAssignedNames', async () => {

    await it('extracts a single Identifier', async () => {
      const id = patternFromLet('foo');
      expect(extractAssignedNames(id)).toStrictEqual(['foo']);
    });

    await it('extracts names from an ObjectPattern', async () => {
      const pat = patternFromLet('{ a, b, c }');
      expect(extractAssignedNames(pat)).toStrictEqual(['a', 'b', 'c']);
    });

    await it('extracts renamed properties from an ObjectPattern', async () => {
      const pat = patternFromLet('{ a: x, b: y }');
      expect(extractAssignedNames(pat)).toStrictEqual(['x', 'y']);
    });

    await it('extracts names from an ArrayPattern', async () => {
      const pat = patternFromLet('[a, b, c]');
      expect(extractAssignedNames(pat)).toStrictEqual(['a', 'b', 'c']);
    });

    await it('skips holes in an ArrayPattern', async () => {
      const pat = patternFromLet('[a, , c]');
      expect(extractAssignedNames(pat)).toStrictEqual(['a', 'c']);
    });

    await it('extracts the RestElement target', async () => {
      const pat = patternFromLet('[a, ...rest]');
      expect(extractAssignedNames(pat)).toStrictEqual(['a', 'rest']);
    });

    await it('extracts the rest property of an ObjectPattern', async () => {
      const pat = patternFromLet('{ a, ...rest }');
      expect(extractAssignedNames(pat)).toStrictEqual(['a', 'rest']);
    });

    await it('extracts identifier from AssignmentPattern (default values)', async () => {
      const pat = patternFromLet('{ a = 1, b = "x" }');
      expect(extractAssignedNames(pat)).toStrictEqual(['a', 'b']);
    });

    await it('handles deeply nested patterns', async () => {
      const pat = patternFromLet('{ a: [{ b }, c], d: { e = 1 } }');
      expect(extractAssignedNames(pat)).toStrictEqual(['b', 'c', 'e']);
    });

    await it('returns [] for a MemberExpression target', async () => {
      // Build the AST for `foo.bar = 1;` and extract from the assignment LHS.
      const ast: any = parse('foo.bar = 1;', PARSE_OPTS);
      const lhs = ast.body[0].expression.left;
      expect(lhs.type).toBe('MemberExpression');
      expect(extractAssignedNames(lhs)).toStrictEqual([]);
    });
  });
};
