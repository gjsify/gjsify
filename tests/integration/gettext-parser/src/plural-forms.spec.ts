// SPDX-License-Identifier: MIT
// Reference: gettext-parser README + node_modules/gettext-parser/lib/poparser.js
// Original: Copyright (c) Andris Reinman. MIT.
// Validates Plural-Forms header parsing — the metadata that downstream
// gettext consumers rely on to decide which msgstr index to use.

import { describe, it, expect } from '@gjsify/unit';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { po, mo } from 'gettext-parser';

const fixturesUrl = new URL('../fixtures/', import.meta.url);

export default async () => {
  await describe('gettext-parser Plural-Forms', async () => {

    await it('exposes Plural-Forms header from a .po file', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const buf = await readFile(path);
      const parsed = po.parse(buf);
      expect(parsed.headers['Plural-Forms']).toBe(
        'nplurals=2; plural=(n != 1);',
      );
    });

    await it('exposes Plural-Forms header from a .mo file', async () => {
      const path = fileURLToPath(new URL('utf8.mo', fixturesUrl));
      const buf = await readFile(path);
      const parsed = mo.parse(buf);
      expect(parsed.headers['Plural-Forms']).toBe(
        'nplurals=2; plural=(n != 1);',
      );
    });

    await it('parses nplurals=N count correctly', async () => {
      const headerLine = 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && (n%100<10 || n%100>=20) ? 1 : 2);';
      const match = /nplurals=(\d+)/.exec(headerLine);
      expect(match).toBeTruthy();
      expect(parseInt(match![1], 10)).toBe(3);
    });

    await it('round-trips Plural-Forms through po.compile', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const buf = await readFile(path);
      const parsed = po.parse(buf);
      const compiled = po.compile(parsed);
      const reparsed = po.parse(compiled);
      expect(reparsed.headers['Plural-Forms']).toBe(parsed.headers['Plural-Forms']);
    });

    await it('round-trips Plural-Forms through mo.compile', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const buf = await readFile(path);
      const parsed = po.parse(buf);
      const moBuf = mo.compile(parsed);
      const reparsed = mo.parse(moBuf);
      expect(reparsed.headers['Plural-Forms']).toBe(parsed.headers['Plural-Forms']);
    });

    await it('correctly indexes plural msgstr slots [0] and [1]', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const buf = await readFile(path);
      const parsed = po.parse(buf);
      const entry = parsed.translations['']['%d apple'];
      expect(entry.msgstr.length).toBe(2);
      expect(entry.msgstr[0]).toBe('%d Apfel');
      expect(entry.msgstr[1]).toBe('%d Äpfel');
    });

  });
};
