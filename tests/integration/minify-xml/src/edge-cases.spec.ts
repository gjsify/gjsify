// SPDX-License-Identifier: MIT
// Inspired by node_modules/minify-xml/test/ — pillar-stress edge cases
// for the lookbehind-heavy RegExp engine that minify-xml relies on.
// Original: Copyright (c) Daniel Schreckling. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { minify } from 'minify-xml';

export default async () => {
  await describe('minify-xml — edge cases & GJS RegExp parity', async () => {

    await it('handles deeply nested elements without recursion errors', async () => {
      let xml = '';
      for (let i = 0; i < 100; i++) xml += `<level${i}>`;
      xml += 'text';
      for (let i = 99; i >= 0; i--) xml += `</level${i}>`;
      const out = minify(xml);
      expect(typeof out).toBe('string');
      expect(out.includes('text')).toBe(true);
      expect(out.includes('<level0>')).toBe(true);
      expect(out.includes('<level99>')).toBe(true);
    });

    await it('handles attributes with single quotes', async () => {
      const input = "<root attr='value with spaces'/>";
      const out = minify(input);
      expect(out.includes('value with spaces')).toBe(true);
    });

    await it('handles attributes containing > characters', async () => {
      // > is legal inside attribute values per XML spec.
      const input = '<root attr="a>b>c"><child/></root>';
      const out = minify(input);
      expect(out.includes('a>b>c')).toBe(true);
      expect(out.includes('<child')).toBe(true);
    });

    await it('handles XML entities in text content', async () => {
      const input = '<root>&lt;hello&gt; &amp; &quot;world&quot;</root>';
      const out = minify(input);
      expect(out.includes('&lt;hello&gt;')).toBe(true);
      expect(out.includes('&amp;')).toBe(true);
      expect(out.includes('&quot;world&quot;')).toBe(true);
    });

    await it('handles processing instructions', async () => {
      const input = '<?xml version="1.0"?><?xml-stylesheet href="style.xsl"?><root/>';
      const out = minify(input);
      expect(out.includes('<?xml-stylesheet')).toBe(true);
      expect(out.includes('href="style.xsl"')).toBe(true);
    });

    await it('handles mixed content (text + elements)', async () => {
      const input = '<root>before<inner/>middle<other/>after</root>';
      const out = minify(input);
      expect(out.includes('before')).toBe(true);
      expect(out.includes('middle')).toBe(true);
      expect(out.includes('after')).toBe(true);
    });

    await it('handles a Blueprint-style GTK XML resource', async () => {
      // Representative shape of @gjsify/vite-plugin-blueprint output —
      // the ultimate consumer of minify-xml in the gjsify infrastructure.
      const input = `<?xml version="1.0" encoding="UTF-8"?>
<!-- generated -->
<interface>
  <requires lib="gtk" version="4.0" />
  <template class="MyWindow" parent="GtkApplicationWindow">
    <property name="title">Demo</property>
    <child>
      <object class="GtkLabel">
        <property name="label">Hello</property>
      </object>
    </child>
  </template>
</interface>`;
      const out = minify(input);
      expect(out.length).toBeLessThan(input.length);
      expect(out.includes('class="MyWindow"')).toBe(true);
      expect(out.includes('<!--')).toBe(false);
      expect(out.includes('Hello')).toBe(true);
    });

    await it('idempotent: minify(minify(x)) === minify(x) for representative input', async () => {
      const input = '<root><a/>   <b attr="x"/>   <!-- c --></root>';
      const once = minify(input);
      const twice = minify(once);
      expect(twice).toBe(once);
    });

    await it('handles unicode content correctly', async () => {
      const input = '<root><msg>Hello 世界 🌍 Привет</msg></root>';
      const out = minify(input);
      expect(out.includes('世界')).toBe(true);
      expect(out.includes('🌍')).toBe(true);
      expect(out.includes('Привет')).toBe(true);
    });

    await it('handles CDATA containing XML-like markup', async () => {
      const input = '<root><![CDATA[<not><real><xml/></real></not>]]></root>';
      const out = minify(input);
      expect(out.includes('<![CDATA[')).toBe(true);
      expect(out.includes('<not>')).toBe(true);
      expect(out.includes('</not>')).toBe(true);
    });

    await it('handles empty input', async () => {
      expect(minify('')).toBe('');
    });

    await it('handles single self-closing element', async () => {
      expect(minify('<root/>')).toBe('<root/>');
    });

  });
};
