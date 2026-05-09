// SPDX-License-Identifier: MIT
// Inspired by node_modules/minify-xml/test/ (not shipped in the npm
// tarball — published "files" filter strips out tests). Re-derived from
// minify-xml's documented public API: minify(), defaultOptions.
// Original: Copyright (c) Daniel Schreckling. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { minify, defaultOptions } from 'minify-xml';

export default async () => {
  await describe('minify-xml — basic minification', async () => {

    await it('exports minify as a function and defaultOptions as an object', async () => {
      expect(typeof minify).toBe('function');
      expect(typeof defaultOptions).toBe('object');
      expect(defaultOptions.removeComments).toBe(true);
    });

    await it('removes XML comments by default', async () => {
      const input = '<root><!-- comment --><child/></root>';
      const out = minify(input);
      expect(out.includes('<!--')).toBeFalsy();
      expect(out.includes('comment')).toBeFalsy();
      expect(out.includes('<child')).toBeTruthy();
    });

    await it('removes whitespace between tags', async () => {
      const input = '<root>   <a/>   <b/>   </root>';
      const out = minify(input);
      // After minification there should be NO whitespace runs between tags.
      expect(/>\s+</.test(out)).toBe(false);
    });

    await it('collapses whitespace inside opening tags', async () => {
      const input = '<root  attr  =  "value"   ></root>';
      const out = minify(input);
      // Should not contain the doubled-space sequences anymore.
      expect(out.includes('  ')).toBe(false);
      expect(out.includes('attr=')).toBe(true);
    });

    await it('collapses empty elements <tag></tag> -> <tag/>', async () => {
      const input = '<root><empty></empty></root>';
      const out = minify(input);
      expect(out.includes('<empty/>')).toBe(true);
      expect(out.includes('</empty>')).toBe(false);
    });

    await it('returns a string for any string input', async () => {
      expect(typeof minify('<a/>')).toBe('string');
      expect(typeof minify('<root><a/></root>')).toBe('string');
      expect(typeof minify('plain text without tags')).toBe('string');
    });

    await it('preserves text content', async () => {
      const input = '<root><msg>hello world</msg></root>';
      const out = minify(input);
      expect(out.includes('hello world')).toBe(true);
    });

    await it('preserves CDATA sections (default)', async () => {
      const input = '<root><![CDATA[ raw <data> here ]]></root>';
      const out = minify(input);
      // Default is ignoreCData: true → CDATA contents should be untouched.
      expect(out.includes('<![CDATA[')).toBe(true);
      expect(out.includes('raw <data> here')).toBe(true);
    });

    await it('handles XML prolog correctly', async () => {
      const input = '<?xml version  =  "1.0"   encoding  =  "UTF-8"  ?><root/>';
      const out = minify(input);
      expect(out.startsWith('<?xml')).toBe(true);
      expect(out.includes('version="1.0"')).toBe(true);
      expect(out.endsWith('<root/>')).toBe(true);
    });

    await it('shortens overall length for whitespace-heavy input', async () => {
      const input = '<root>   <a>   text   </a>   <b/>   <!-- comment -->   </root>';
      const out = minify(input);
      expect(out.length).toBeLessThan(input.length);
    });

  });
};
