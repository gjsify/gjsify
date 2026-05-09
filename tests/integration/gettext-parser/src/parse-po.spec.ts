// SPDX-License-Identifier: MIT
// Reference: gettext-parser README + node_modules/gettext-parser/lib/poparser.js
// Original: Copyright (c) Andris Reinman. MIT.
// Test cases authored for @gjsify/unit — fixtures generated at prebuild time
// (see scripts/build-fixtures.mjs) because gettext-parser does not ship its
// upstream test/fixtures/ directory in the npm tarball.

import { describe, it, expect } from '@gjsify/unit';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { po } from 'gettext-parser';

const fixturesUrl = new URL('../fixtures/', import.meta.url);

export default async () => {
  await describe('gettext-parser po.parse', async () => {

    await it('parses utf-8 PO file from disk', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const buf = await readFile(path);
      const parsed = po.parse(buf);

      expect(parsed.charset).toBe('utf-8');
      expect(parsed.headers['Content-Type']).toBe('text/plain; charset=utf-8');
      expect(parsed.headers['Language']).toBe('de');
    });

    await it('maps msgid → msgstr correctly', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const buf = await readFile(path);
      const parsed = po.parse(buf);

      const ctx = parsed.translations[''];
      expect(ctx['hello'].msgstr[0]).toBe('hallo');
      expect(ctx['world'].msgstr[0]).toBe('welt');
    });

    await it('preserves non-ASCII characters', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const buf = await readFile(path);
      const parsed = po.parse(buf);

      const ctx = parsed.translations[''];
      expect(ctx['tree'].msgstr[0]).toBe('Bäume');
    });

    await it('parses plural forms (msgid_plural + msgstr[0]/[1])', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const buf = await readFile(path);
      const parsed = po.parse(buf);

      const entry = parsed.translations['']['%d apple'];
      expect(entry.msgid).toBe('%d apple');
      expect(entry.msgid_plural).toBe('%d apples');
      expect(entry.msgstr[0]).toBe('%d Apfel');
      expect(entry.msgstr[1]).toBe('%d Äpfel');
    });

    await it('parses msgctxt — same msgid in different contexts', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const buf = await readFile(path);
      const parsed = po.parse(buf);

      // msgctxt becomes a key in `translations`
      expect(parsed.translations['menu']['File'].msgstr[0]).toBe('Datei');
      expect(parsed.translations['button']['File'].msgstr[0]).toBe('Akte');
    });

    await it('accepts a string input as well as Buffer', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const buf = await readFile(path);
      const fromString = po.parse(buf.toString('utf8'));
      const fromBuf = po.parse(buf);
      expect(fromString.translations['']['hello'].msgstr[0]).toBe(
        fromBuf.translations['']['hello'].msgstr[0],
      );
    });

  });
};
