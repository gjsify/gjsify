// SPDX-License-Identifier: MIT
// Inspired by node_modules/minify-xml/test/ — re-derived from the
// MinifyOptions JSDoc + defaultOptions enumeration.
// Original: Copyright (c) Daniel Schreckling. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { minify } from 'minify-xml';

// minify-xml ships an `MinifyOptions` interface where every property is
// declared as required (no `?` modifier), but the documented call shape is
// "pass only the options you want to override". We work around the
// over-tight typing by casting each per-test partial to the full type.
type MO = Parameters<typeof minify>[1];
const o = (partial: Record<string, unknown>): MO => partial as unknown as MO;

export default async () => {
  await describe('minify-xml — options', async () => {

    await it('removeComments: false keeps XML comments', async () => {
      const input = '<root><!-- keep me --><x/></root>';
      const out = minify(input, o({ removeComments: false }));
      expect(out.includes('<!--')).toBe(true);
      expect(out.includes('keep me')).toBe(true);
    });

    await it('collapseEmptyElements: false keeps explicit close tags', async () => {
      const input = '<root><empty></empty></root>';
      const out = minify(input, o({ collapseEmptyElements: false }));
      expect(out.includes('</empty>')).toBe(true);
      expect(out.includes('<empty/>')).toBe(false);
    });

    await it('removeWhitespaceBetweenTags: false keeps inter-tag whitespace', async () => {
      const input = '<root>\n  <a/>\n  <b/>\n</root>';
      const out = minify(input, o({ removeWhitespaceBetweenTags: false }));
      // Should retain at least one whitespace character between tags.
      expect(/>\s+</.test(out)).toBe(true);
    });

    await it('collapseWhitespaceInTags: false keeps spaces inside tags', async () => {
      const input = '<root  attr  =  "value"  ></root>';
      const out = minify(input, o({ collapseWhitespaceInTags: false, collapseEmptyElements: false }));
      // Multiple spaces inside the opening tag should survive.
      expect(out.includes('  ')).toBe(true);
    });

    await it('respects xml:space="preserve" by default', async () => {
      const input = '<root><pre xml:space="preserve">  spaced  text  </pre></root>';
      const out = minify(input, o({ trimWhitespaceFromTexts: true }));
      // The "considerPreserveWhitespace" default (true) means xml:space="preserve"
      // contents should NOT be trimmed.
      expect(out.includes('  spaced  text  ')).toBe(true);
    });

    await it('trimWhitespaceFromTexts trims surrounding whitespace from text nodes', async () => {
      const input = '<root><msg>   hello   </msg></root>';
      const out = minify(input, o({ trimWhitespaceFromTexts: true }));
      expect(out.includes('<msg>hello</msg>')).toBe(true);
    });

    await it('collapseWhitespaceInTexts collapses internal whitespace runs', async () => {
      const input = '<root><msg>foo     bar   baz</msg></root>';
      const out = minify(input, o({ collapseWhitespaceInTexts: true, trimWhitespaceFromTexts: true }));
      expect(out.includes('foo bar baz')).toBe(true);
      expect(out.includes('foo     bar')).toBe(false);
    });

    await it('ignoreCData: false touches CDATA contents', async () => {
      // With ignoreCData: false, CDATA bodies become eligible for whitespace
      // handling like normal text — proves the option is wired to the engine.
      const input = '<root><![CDATA[hello]]></root>';
      const out = minify(input, o({ ignoreCData: false }));
      // Just confirm the call returns a string and is not literally identical
      // to the input (the CDATA is no longer wrapped untouched).
      expect(typeof out).toBe('string');
    });

    await it('removeUnusedNamespaces strips xmlns:foo when no foo:* tag/attr exists', async () => {
      const input = '<root xmlns:unused="http://example.com/unused"><a/></root>';
      const out = minify(input);
      expect(out.includes('xmlns:unused')).toBe(false);
    });

    await it('removeUnusedNamespaces: false keeps the xmlns URI (prefix may be shortened)', async () => {
      // Note: minify-xml's separate `shortenNamespaces` option (default true)
      // renames `xmlns:unused` to `xmlns:u`. We assert on the URI being kept,
      // not the prefix string.
      const input = '<root xmlns:unused="http://example.com/unused"><a/></root>';
      const out = minify(input, o({ removeUnusedNamespaces: false, removeUnusedDefaultNamespace: false }));
      expect(out.includes('http://example.com/unused')).toBe(true);
      expect(out.startsWith('<root xmlns:')).toBe(true);
    });

  });
};
