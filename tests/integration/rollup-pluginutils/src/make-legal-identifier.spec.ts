// SPDX-License-Identifier: MIT
// Reference: @rollup/pluginutils public API.
// Original: Copyright (c) 2019 RollupJS Plugin Contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Exercises makeLegalIdentifier() — turns arbitrary strings into bundle-safe
// JS identifiers. Pure JS — exercises regex + Set membership.

import { describe, it, expect } from '@gjsify/unit';
import { makeLegalIdentifier } from '@rollup/pluginutils';

export default async () => {
  await describe('@rollup/pluginutils makeLegalIdentifier', async () => {

    await it('passes through valid identifiers unchanged', async () => {
      expect(makeLegalIdentifier('foo')).toBe('foo');
      expect(makeLegalIdentifier('foo_bar')).toBe('foo_bar');
      expect(makeLegalIdentifier('$jq')).toBe('$jq');
      expect(makeLegalIdentifier('_underscore')).toBe('_underscore');
      expect(makeLegalIdentifier('camelCase')).toBe('camelCase');
      expect(makeLegalIdentifier('CONST123')).toBe('CONST123');
    });

    await it('camelCases hyphen-segments (kebab → camel)', async () => {
      expect(makeLegalIdentifier('foo-bar')).toBe('fooBar');
      expect(makeLegalIdentifier('foo-bar-baz')).toBe('fooBarBaz');
      expect(makeLegalIdentifier('rollup-plugin-utils')).toBe('rollupPluginUtils');
    });

    await it('replaces other illegal characters with underscores', async () => {
      expect(makeLegalIdentifier('foo.bar')).toBe('foo_bar');
      expect(makeLegalIdentifier('foo bar')).toBe('foo_bar');
      expect(makeLegalIdentifier('foo/bar')).toBe('foo_bar');
      expect(makeLegalIdentifier('foo+bar')).toBe('foo_bar');
      expect(makeLegalIdentifier('foo:bar')).toBe('foo_bar');
      expect(makeLegalIdentifier('@scope/pkg')).toBe('_scope_pkg');
    });

    await it('prefixes leading-digit identifiers with an underscore', async () => {
      expect(makeLegalIdentifier('1foo')).toBe('_1foo');
      expect(makeLegalIdentifier('123')).toBe('_123');
      expect(makeLegalIdentifier('9lives')).toBe('_9lives');
    });

    await it('prefixes reserved words with an underscore', async () => {
      expect(makeLegalIdentifier('class')).toBe('_class');
      expect(makeLegalIdentifier('return')).toBe('_return');
      expect(makeLegalIdentifier('await')).toBe('_await');
      expect(makeLegalIdentifier('yield')).toBe('_yield');
      expect(makeLegalIdentifier('default')).toBe('_default');
    });

    await it('prefixes built-in globals with an underscore', async () => {
      expect(makeLegalIdentifier('undefined')).toBe('_undefined');
      expect(makeLegalIdentifier('NaN')).toBe('_NaN');
      expect(makeLegalIdentifier('Infinity')).toBe('_Infinity');
      expect(makeLegalIdentifier('Object')).toBe('_Object');
      expect(makeLegalIdentifier('Array')).toBe('_Array');
      expect(makeLegalIdentifier('Promise')).toBe('_Promise');
    });

    await it('returns "_" for empty input', async () => {
      expect(makeLegalIdentifier('')).toBe('_');
    });

    await it('replaces non-ASCII characters with underscores', async () => {
      // Source identifiers from package names like "café" or "naïve" become
      // underscored — only [$_a-zA-Z0-9] survives.
      expect(makeLegalIdentifier('café')).toBe('caf_');
      expect(makeLegalIdentifier('naïve')).toBe('na_ve');
    });
  });
};
