// SPDX-License-Identifier: MIT
// Reference: gettext-parser README + node_modules/gettext-parser/lib/mocompiler.js
// Original: Copyright (c) Andris Reinman. MIT.
// Round-trips a translation table through the binary MO compiler — the most
// buffer-heavy code path in gettext-parser. Exercises @gjsify/buffer
// allocUnsafe + writeUInt32LE + write(string,offset,encoding) sequences.

import { describe, it, expect } from '@gjsify/unit';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { po, mo } from 'gettext-parser';

const fixturesUrl = new URL('../fixtures/', import.meta.url);

export default async () => {
  await describe('gettext-parser mo.compile (round-trip)', async () => {

    await it('po → mo.compile → mo.parse preserves translations', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const original = await readFile(path);
      const parsed = po.parse(original);
      const moBuf = mo.compile(parsed);

      expect(Buffer.isBuffer(moBuf)).toBeTruthy();
      // MO header is 28 bytes; any compiled file must exceed that.
      expect(moBuf.length > 28).toBeTruthy();

      const reparsed = mo.parse(moBuf);
      expect(reparsed.translations['']['hello'].msgstr[0]).toBe('hallo');
      expect(reparsed.translations['']['world'].msgstr[0]).toBe('welt');
      expect(reparsed.translations['']['tree'].msgstr[0]).toBe('Bäume');
    });

    await it('mo.compile output starts with the gettext magic number', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const original = await readFile(path);
      const parsed = po.parse(original);
      const moBuf = mo.compile(parsed);

      expect(moBuf.readUInt32LE(0)).toBe(0x950412de);
      // Format revision (offset 4) is 0.
      expect(moBuf.readUInt32LE(4)).toBe(0);
    });

    await it('preserves plural strings (NUL-separated) in MO round-trip', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const original = await readFile(path);
      const parsed = po.parse(original);
      const moBuf = mo.compile(parsed);
      const reparsed = mo.parse(moBuf);

      const entry = reparsed.translations['']['%d apple'];
      expect(entry.msgid_plural).toBe('%d apples');
      expect(entry.msgstr).toStrictEqual(['%d Apfel', '%d Äpfel']);
    });

    await it('preserves msgctxt (EOT-separated msgid) in MO round-trip', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const original = await readFile(path);
      const parsed = po.parse(original);
      const moBuf = mo.compile(parsed);
      const reparsed = mo.parse(moBuf);

      expect(reparsed.translations['menu']['File'].msgstr[0]).toBe('Datei');
      expect(reparsed.translations['button']['File'].msgstr[0]).toBe('Akte');
    });

    await it('disk-written .mo fixture matches in-memory compile output', async () => {
      const poPath = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const moPath = fileURLToPath(new URL('utf8.mo', fixturesUrl));
      const poBuf = await readFile(poPath);
      const moOnDisk = await readFile(moPath);
      const parsed = po.parse(poBuf);
      const moInMemory = mo.compile(parsed);
      // Both buffers must parse to identical translation tables.
      const a = mo.parse(moOnDisk);
      const b = mo.parse(moInMemory);
      expect(a.translations).toStrictEqual(b.translations);
      expect(a.headers).toStrictEqual(b.headers);
    });

  });
};
