// SPDX-License-Identifier: MIT
// Reference: gettext-parser README + node_modules/gettext-parser/lib/moparser.js
// Original: Copyright (c) Andris Reinman. MIT.
// Validates binary MO file parsing — exercises @gjsify/buffer DataView /
// little-endian / big-endian access on the gettext .mo on-disk format
// (see https://www.gnu.org/software/gettext/manual/html_node/MO-Files.html).
// Fixtures synthesised at prebuild time (scripts/build-fixtures.mjs).

import { describe, it, expect } from '@gjsify/unit';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { mo } from 'gettext-parser';

const fixturesUrl = new URL('../fixtures/', import.meta.url);

const MO_MAGIC_LE = 0x950412de;
const MO_MAGIC_BE = 0xde120495;

export default async () => {
  await describe('gettext-parser mo.parse', async () => {

    await it('reads .mo magic number (little-endian on x86_64)', async () => {
      const path = fileURLToPath(new URL('utf8.mo', fixturesUrl));
      const buf = await readFile(path);
      // First 4 bytes are the magic number, native endian.
      const magic = buf.readUInt32LE(0);
      // gettext-parser writes LE on every platform.
      expect(magic === MO_MAGIC_LE || magic === MO_MAGIC_BE).toBeTruthy();
      expect(magic).toBe(MO_MAGIC_LE);
    });

    await it('parses utf-8 .mo file → translations table', async () => {
      const path = fileURLToPath(new URL('utf8.mo', fixturesUrl));
      const buf = await readFile(path);
      const parsed = mo.parse(buf);

      expect(parsed.charset).toBe('utf-8');
      expect(parsed.headers['Content-Type']).toBe('text/plain; charset=utf-8');
      expect(parsed.translations['']['hello'].msgstr[0]).toBe('hallo');
      expect(parsed.translations['']['world'].msgstr[0]).toBe('welt');
      expect(parsed.translations['']['tree'].msgstr[0]).toBe('Bäume');
    });

    await it('parses plural strings from .mo (NUL-separated)', async () => {
      const path = fileURLToPath(new URL('utf8.mo', fixturesUrl));
      const buf = await readFile(path);
      const parsed = mo.parse(buf);

      const entry = parsed.translations['']['%d apple'];
      expect(entry.msgid).toBe('%d apple');
      expect(entry.msgid_plural).toBe('%d apples');
      expect(entry.msgstr).toStrictEqual(['%d Apfel', '%d Äpfel']);
    });

    await it('parses msgctxt entries (EOT-separated msgid)', async () => {
      const path = fileURLToPath(new URL('utf8.mo', fixturesUrl));
      const buf = await readFile(path);
      const parsed = mo.parse(buf);

      expect(parsed.translations['menu']['File'].msgstr[0]).toBe('Datei');
      expect(parsed.translations['button']['File'].msgstr[0]).toBe('Akte');
    });

    await it('returns falsy on a non-mo buffer', async () => {
      const buf = Buffer.from('not a mo file');
      const result = mo.parse(buf);
      // moparser returns `false` when magic doesn't match.
      expect(result).toBeFalsy();
    });

  });
};
